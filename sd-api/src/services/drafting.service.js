/**
 * "What can I draft from?" — the inventory behind the composer panel.
 *
 * Read-only against `scholars` (curation-owned), `source_texts` (harvest), and
 * the Scholar Documents portal's `scholar_documents` and
 * `scholar_document_extractions` (owned by ngo-admin-backend). Nothing here
 * writes, and nothing here may: a second writer on the portal's collection
 * was tried and reverted on 2026-09-11.
 *
 * ── Why this ships before any model call ───────────────────────────────────
 * Measured on 2026-09-11: 4 of 65 Legacy scholars hold enough licensed text to
 * draft from. This panel is what turns that number, because it tells the other
 * 61 the one thing that would change their answer — upload a paper you hold
 * the rights to. Without it the upload surface is a form nobody has a reason
 * to use (2 uploads platform-wide), and the agent has no material.
 */

const crypto = require("crypto");

const { COLLECTIONS, getCollections } = require("../db/mongo");
const { ApiError } = require("../lib/api-error");
const { ORIGIN, USE, summarise } = require("../lib/draftEligibility");
const { rolloutAllows } = require("../lib/rollout");
const { env } = require("../config/env");
const composer = require("../lib/draftComposer");
const { assessDraftReadability, simplificationNote, VERDICT } = require("../lib/draftReadability");
const vertex = require("../lib/vertex");

/* Harvested sources are keyed by a slug of the display name, not by
   profile_id. Measured: slugify(name.display) matches `scholar_slug` for 458
   of 500 scholars. The 8% miss is a known gap in the harvest, not something
   to paper over with a fuzzier match that would attach one person's papers to
   another's inventory. */
function sourceTextsSlug(scholar) {
  const name = scholar?.name?.display || scholar?.name?.full || "";
  return String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const HARVESTED_PROJECTION = {
  source_id: 1, title: 1, allowed_use: 1, license_type: 1, word_count: 1,
  source_url: 1, host: 1, extractor: 1, kind: 1,
};

/* The Scholar Documents portal's own field names. `classification` decides
   whether a document was ever eligible for extraction; `personal_sensitive`
   never is, and is not shown here at all. */
const CONTRIBUTED_PROJECTION = {
  document_id: 1, title: 1, document_type: 1, classification: 1, status: 1,
  consent: 1, page_count: 1, createdAt: 1,
};

/* One extraction run per (document, profile version); the newest row is the
   one a reviewer would have acted on. Transcription is projected because the
   word count has to be counted from it — no other field carries it. */
const EXTRACTION_PROJECTION = {
  document_id: 1, status: 1, "review.status": 1, "pages.transcription": 1, createdAt: 1,
};

function transcriptionWords(row) {
  let n = 0;
  for (const page of row?.pages || []) {
    const t = page?.transcription;
    if (typeof t !== "string" || !t) continue;
    n += t.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  }
  return n;
}

/* Nobody has hundreds of papers in the harvest; a cap keeps a bad slug
   collision from paging through the whole collection. */
const MAX_SOURCES = 200;

async function listDraftSources({ profileId }) {
  if (!profileId) throw new TypeError("listDraftSources requires a profile id");

  const { db } = await getCollections();

  const scholar = await db
    .collection("scholars")
    .findOne({ profile_id: profileId }, { projection: { profile_id: 1, name: 1, status: 1 } });
  if (!scholar) throw new ApiError(404, "No scholar record is linked to this session.");

  const slug = sourceTextsSlug(scholar);

  const [harvested, contributed] = await Promise.all([
    slug
      ? db.collection("source_texts").find({ scholar_slug: slug }, { projection: HARVESTED_PROJECTION }).limit(MAX_SOURCES).toArray()
      : [],
    db.collection("scholar_documents")
      .find(
        { profile_id: profileId, status: "available", classification: { $ne: "personal_sensitive" } },
        { projection: CONTRIBUTED_PROJECTION },
      )
      .sort({ createdAt: -1 })
      .limit(MAX_SOURCES)
      .toArray(),
  ]);

  /* Latest extraction per document. Read-only against the portal's results. */
  const extractionByDoc = new Map();
  if (contributed.length) {
    const rows = await db
      .collection("scholar_document_extractions")
      .find({ document_id: { $in: contributed.map((d) => d.document_id) } }, { projection: EXTRACTION_PROJECTION })
      .sort({ createdAt: -1 })
      .toArray();
    for (const row of rows) {
      if (!extractionByDoc.has(row.document_id)) {
        extractionByDoc.set(row.document_id, {
          status: row.status,
          reviewStatus: row.review?.status || "unreviewed",
          words: transcriptionWords(row),
        });
      }
    }
  }

  const sources = [
    ...harvested.map((h) => ({ ...h, origin: ORIGIN.HARVESTED })),
    ...contributed.map((d) => ({
      origin: ORIGIN.CONTRIBUTED,
      document_id: d.document_id,
      title: d.title || d.document_type || "Uploaded document",
      document_type: d.document_type,
      status: d.status,
      consent: d.consent,
      extraction: extractionByDoc.get(d.document_id) || null,
      uploadedAt: d.createdAt || null,
    })),
  ];

  const summary = summarise({ scholar, sources });

  /* The rollout sits behind the Legacy gate: a scholar outside the pilot
     still sees everything we hold and why, with the button withheld. */
  const rollout = rolloutAllows({ mode: env.drafting.rollout, pilotProfiles: env.drafting.pilotProfiles, profileId });
  if (summary.eligible && !rollout.ok) {
    summary.eligible = false;
    summary.gateReason = rollout.reason;
  }

  return {
    profileId,
    rollout: rollout.mode,
    scholarName: scholar.name?.display || scholar.name?.full || null,
    /* Stated so a scholar with no harvested rows knows whether that is "we
       found nothing" or "we never looked" — an empty slug means the latter. */
    harvestLookup: slug ? { slug, matched: harvested.length } : { slug: null, matched: 0 },
    ...summary,
  };
}

/* ── The drafter ─────────────────────────────────────────────────────────── */

/**
 * The text of one draftable source. Harvested rows carry it on `text`; a
 * contributed upload's text lives on its latest accepted extraction row, page
 * by page. Both reads are against collections this service may only read.
 */
async function loadSourceText(db, source) {
  if (source.origin === ORIGIN.CONTRIBUTED) {
    const row = await db
      .collection("scholar_document_extractions")
      .find(
        { document_id: source.id, status: { $ne: "failed" }, "review.status": "accepted" },
        { projection: { "pages.global_page": 1, "pages.transcription": 1, createdAt: 1 } },
      )
      .sort({ createdAt: -1 })
      .limit(1)
      .next();
    if (!row) return "";
    return (row.pages || [])
      .slice()
      .sort((a, b) => (a.global_page || 0) - (b.global_page || 0))
      .map((p) => (typeof p.transcription === "string" ? p.transcription.trim() : ""))
      .filter(Boolean)
      .join("\n\n");
  }

  const row = await db
    .collection("source_texts")
    .findOne({ source_id: source.id }, { projection: { text: 1 } });
  return typeof row?.text === "string" ? row.text : "";
}

/**
 * How many model calls one draft may cost.
 *
 * A first-person draft earns one retry with a sterner prompt; a draft that
 * measures too hard for its reader earns one with a simplification note. Three
 * calls covers both once, with the voice retry taking priority because a voice
 * failure is refused outright and a readability failure is handed over with a
 * warning.
 */
const MAX_ATTEMPTS = 3;

/**
 * Draft an article from one of the scholar's own sources.
 *
 * ── The boundary is re-checked here, not trusted from the panel ────────────
 * The inventory the panel showed is recomputed and the requested source must
 * be in its `draftable` list. A source id the scholar was shown as "can be
 * cited" and then posted anyway is refused with the same sentence the panel
 * displays. The eligibility rules live in one file and this is the second of
 * the two places they are applied; the first is display.
 *
 * ── Nothing is saved to the story ──────────────────────────────────────────
 * The draft is returned to the composer, which puts it in the editor. The
 * scholar reads it, changes it, and saves it through the same route every
 * other story takes. A machine-written paragraph never reaches
 * `scholar_editorials` without the scholar's hand on it.
 *
 * ── Every run is recorded ──────────────────────────────────────────────────
 * `scholar_draft_runs` is this service's own collection (not in the shared
 * ownership manifest, because no other service reads it). One row per model
 * call: who, from what, with which prompt version and model, at what token
 * cost, with what warnings. It is how a bad draft under a real name is traced
 * back to the prompt that produced it.
 */
async function draftFromSource({ profileId, origin, sourceId, audience }) {
  if (!profileId) throw new TypeError("draftFromSource requires a profile id");
  if (!vertex.isConfigured()) {
    throw new ApiError(503, `Drafting is not available on this deployment. ${vertex.describeMissingConfig()}`);
  }

  const inventory = await listDraftSources({ profileId });
  if (!inventory.eligible) {
    throw new ApiError(403, inventory.gateReason);
  }

  const wantedOrigin = origin === ORIGIN.CONTRIBUTED ? ORIGIN.CONTRIBUTED : ORIGIN.HARVESTED;
  const all = [...inventory.draftable, ...inventory.citable, ...inventory.unusable];
  const source = all.find((s) => s.id === String(sourceId) && s.origin === wantedOrigin);
  if (!source) {
    throw new ApiError(404, "That source is not in your inventory.");
  }
  if (source.use !== USE.DRAFTABLE) {
    throw new ApiError(403, `This source can't be drafted from: ${source.reason}.`);
  }

  const { db } = await getCollections();
  const rawText = await loadSourceText(db, source);
  const prepared = composer.prepareSourceText(rawText);
  if (prepared.words < 200) {
    /* The inventory counted words from metadata; the text itself is missing or
       thin. Say so rather than let the model invent a paper. */
    throw new ApiError(409, "We hold this source's title but not enough of its text to draft from.");
  }

  const chosenAudience = composer.normaliseAudience(audience);
  const scholar = { name: inventory.scholarName, field: null };
  const systemInstruction = composer.buildSystemInstruction();
  const startedAt = new Date();

  let draft = null;
  let generation = null;
  let readability = null;
  const attempts = [];
  let strictVoice = false;
  let readabilityNote = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const prompt = composer.buildDraftPrompt({
      scholar,
      source: { title: source.title, year: source.year, origin: source.origin },
      text: prepared.text,
      truncated: prepared.truncated,
      audience: chosenAudience,
      strictVoice,
      readabilityNote,
    });

    let result;
    try {
      result = await vertex.generateContent({
        prompt,
        systemInstruction,
        responseSchema: composer.RESPONSE_SCHEMA,
        temperature: attempt > 1 ? 0.2 : 0.4,
        maxOutputTokens: 4096,
      });
    } catch (error) {
      await recordRun(db, { profileId, source, chosenAudience, prepared, startedAt, attempts, error });
      throw new ApiError(502, `The drafting model did not respond: ${error.message}`);
    }

    let parsed;
    try {
      parsed = composer.parseDraftResponse(result.text, prepared.text);
    } catch (error) {
      attempts.push({ attempt, usage: result.usage, outcome: `unparseable: ${error.message}` });
      await recordRun(db, { profileId, source, chosenAudience, prepared, startedAt, attempts, error });
      throw new ApiError(502, `The drafting model returned something unusable: ${error.message}`);
    }

    generation = result;
    draft = parsed;

    if (parsed.violations.length > 0) {
      attempts.push({ attempt, usage: result.usage, outcome: "first_person", violations: parsed.violations.length });
      if (strictVoice) break; /* already retried for voice once; refuse below */
      strictVoice = true;
      continue;
    }

    readability = assessDraftReadability({ text: parsed.prose, audience: chosenAudience });
    attempts.push({
      attempt,
      usage: result.usage,
      outcome: readability.verdict === VERDICT.FAIL ? "too_hard" : "ok",
      readability: { verdict: readability.verdict, fkGrade: readability.fkGrade, drift: readability.drift },
    });
    if (readability.verdict === VERDICT.FAIL && !readabilityNote) {
      readabilityNote = simplificationNote(readability);
      continue;
    }
    break;
  }

  if (draft.violations.length > 0) {
    /* Two attempts, still speaking as the scholar. Refuse rather than hand
       over a draft that says "I" under a living person's name. */
    await recordRun(db, { profileId, source, chosenAudience, prepared, startedAt, attempts, generation, draft, readability, refused: true });
    throw new ApiError(
      422,
      "The draft kept writing in the first person, which we don't do on your behalf. Try again, or draft from a different source.",
    );
  }

  const runId = await recordRun(db, { profileId, source, chosenAudience, prepared, startedAt, attempts, generation, draft, readability });

  const warnings = [...draft.warnings];
  if (readability && readability.verdict !== VERDICT.PASS && readability.reason) {
    /* Not refused: the scholar is about to edit it, and knowing the measured
       level is what makes the edit purposeful. */
    warnings.push(`This draft ${readability.reason}.`);
  }
  if (prepared.truncated) {
    warnings.push(
      `Only the first ${prepared.words.toLocaleString()} of ${prepared.totalWords.toLocaleString()} words were used; the rest of the paper is not reflected here.`,
    );
  }

  return {
    runId,
    title: draft.title,
    subtitle: draft.deck,
    excerpt: draft.deck,
    bodyBlocks: draft.bodyBlocks,
    words: draft.words,
    warnings,
    readability: readability
      ? { verdict: readability.verdict, fkGrade: readability.fkGrade, targetGrade: readability.targetGrade, drift: readability.drift }
      : null,
    provenance: {
      origin: source.origin,
      sourceId: source.id,
      sourceTitle: source.title,
      sourceWords: prepared.totalWords,
      audience: chosenAudience,
      model: generation.modelVersion || vertex.resolveResourceName(),
      promptVersion: composer.PROMPT_VERSION,
    },
  };
}

async function recordRun(db, { profileId, source, chosenAudience, prepared, startedAt, attempts, generation = null, draft = null, readability = null, error = null, refused = false }) {
  const finishedAt = new Date();
  const doc = {
    profile_id: profileId,
    source: { origin: source.origin, id: source.id, title: source.title, words: prepared.totalWords, truncated: prepared.truncated },
    audience: chosenAudience,
    prompt_version: composer.PROMPT_VERSION,
    model_requested: vertex.resolveResourceName(),
    model_served: generation?.modelVersion || null,
    attempts,
    tokens: attempts.reduce(
      (acc, a) => ({ input: acc.input + (a.usage?.input || 0), output: acc.output + (a.usage?.output || 0) }),
      { input: 0, output: 0 },
    ),
    outcome: error ? "error" : refused ? "refused" : "delivered",
    error: error ? String(error.message || error).slice(0, 500) : null,
    draft_words: draft?.words ?? null,
    /* Measured, and acted on: a FAIL here means the simplification retry ran
       and the draft was still handed over with a warning. */
    readability: readability
      ? { verdict: readability.verdict, fk_grade: readability.fkGrade, target_grade: readability.targetGrade, drift: readability.drift, tolerance: readability.tolerance, reliable: readability.reliable }
      : null,
    draft_hash: draft ? crypto.createHash("sha256").update(JSON.stringify(draft.bodyBlocks)).digest("hex").slice(0, 32) : null,
    warnings: draft?.warnings || [],
    started_at: startedAt,
    finished_at: finishedAt,
    duration_ms: finishedAt - startedAt,
  };
  try {
    const { insertedId } = await db.collection(COLLECTIONS.draftRuns).insertOne(doc);
    return String(insertedId);
  } catch (writeError) {
    /* The audit row is important; the scholar's draft is more important. Log
       loudly, hand the draft over anyway. */
    console.error("[drafting] failed to record draft run:", writeError);
    return null;
  }
}

module.exports = { listDraftSources, draftFromSource, loadSourceText, sourceTextsSlug };
