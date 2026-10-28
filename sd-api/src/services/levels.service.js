/**
 * Reading levels as a service: write them, judge them, keep them on the
 * story, and let the scholar approve them for readers.
 *
 * A level is content, so writing or approving one is a version of the story
 * like any other write: guarded by the version the caller read, recorded in
 * the history with who did it. A level the scholar has not approved, or one
 * the article has moved on from, is never shown to the public.
 */

const { ApiError } = require("../lib/api-error");
const levels = require("../lib/levels");
const fidelity = require("../lib/fidelity");
const reach = require("../lib/reach");
const composer = require("../lib/draftComposer");
const { assessDraftReadability, placeReadability } = require("../lib/draftReadability");
const voiceJudge = require("../lib/agents/voiceJudge");
const bandJudge = require("../lib/agents/bandJudge");
const { AUDIENCES, normaliseAudience } = require("../lib/audiences");
const storyVersion = require("../lib/storyVersion");
const vertex = require("../lib/vertex");
const { traced } = require("../lib/tracing");
const { serializeMongoValue } = require("../lib/serialize");
const { passagesFor } = require("./passages.service");
const { getPolicy } = require("./policy.service");
const { routerFor } = require("./models.service");

/**
 * Write the story for other readers.
 *
 * @param {import("mongodb").Db} db
 * @param {object} storyDoc     the raw story document
 * @param {object} p
 * @param {string[]|null} [p.audiences]   bands to write; default every band but the story's own
 * @param {string} p.actor
 * @param {number|null} [p.baseVersion]
 * @param {Function} [p.generate]         a model call, for the worker to pass its traced one
 * @param {{voice?: Function, band?: Function, fidelity?: Function, reach?: Function}} [p.judges]   the voice, reading-level, fidelity and reach judges; their policy routes when not given
 * @param {Function} [p.onProgress]
 */
async function generateLevelsForDoc(db, storyDoc, { audiences = null, actor, baseVersion = null, generate = null, judges = null, onProgress = async () => {} }) {
  const editorial = require("./editorial.service");
  const gen = generate || traced("levels.generateContent", (req) => vertex.generateContent(req), { metadata: { storyId: String(storyDoc._id) } });

  const [author, provenance, sourcePassages] = await Promise.all([
    editorial.resolveStoryAuthor(db, storyDoc.profile_id),
    editorial.resolveStoryProvenance(db, storyDoc.provenance),
    passagesFor(db, storyDoc),
  ]);

  const mapped = editorial.mapStoryDocument(storyDoc, author, provenance);

  /* ── A story that is its own source ──────────────────────────────────────
     This used to refuse: "no source paper on record, so it cannot be written
     for other readers." A hand-written article has no paper, so it could
     never be offered to a younger reader — and offering research to younger
     readers is the whole point of the product. The refusal was protecting a
     guarantee (that a level stays faithful to the paper) at the cost of the
     mission.

     The guarantee survives in the form it can take here: the scholar's own
     paragraph becomes the passage behind its rewrite, so the fidelity judge
     still asks "did this keep what the original said". What it cannot ask is
     whether the original is faithful to a paper, because there is none. The
     level records `grounding: "self"` and never claims otherwise. */
  const selfGrounded = sourcePassages.length === 0;
  const passages = selfGrounded ? levels.selfPassages(mapped.bodyBlocks) : sourcePassages;
  if (!passages.length) {
    throw new ApiError(409, "This story has no paragraphs yet, so there is nothing to write for other readers.");
  }
  if (selfGrounded) mapped.bodyBlocks = levels.groundInSelf(mapped.bodyBlocks);
  const sourceAudience = normaliseAudience(storyDoc.provenance?.audience);
  /* A level is the same article for another reader, so it keeps the voice the
     article was written in. Stories drafted before voices existed are "about". */
  const voice = composer.normaliseVoice(storyDoc.provenance?.voice || composer.VOICE.ABOUT);
  const targets = levels.targetsFor(sourceAudience, audiences);
  if (!targets.length) throw new ApiError(400, "No reading level to write: every band asked for is the one the story is already written for.");
  const toRewrite = levels.levelPlan(mapped.bodyBlocks, { selfGrounded }).filter((p) => p.rewrite);
  if (!toRewrite.length) throw new ApiError(409, "Nothing in this story is still drawn from the paper, so there is nothing to rewrite for another reader.");

  const system = composer.buildSystemInstruction({ voice, scholarName: author?.name || null });
  const made = {};
  const calls = [];
  const policy = await getPolicy("drafting", { db });
  const router = judges?.voice && judges?.band && judges?.fidelity && judges?.reach ? null : await routerFor({ db });
  const judgeVoice = judges?.voice || router.bound("drafting.voice");
  const judgeBand = judges?.band || router.bound("drafting.band");
  const judgeFidelity = judges?.fidelity || router.bound("drafting.fidelity");
  const judgeReach = judges?.reach || router.bound("drafting.reach");

  for (const audience of targets) {
    /* `detail` is what the job's event log keeps beside the step, so the
       composer can say which band is being written. */
    await onProgress({ step: "draft_levels", message: `Writing it for ${AUDIENCES[audience].label.toLowerCase()}…`, detail: { audience }, audience });
    const rewrites = new Map();
    const warnings = [];

    const write = async (index, { voiceNote = null } = {}) => {
      const prompt = levels.buildLevelPrompt({ scholar: { name: author?.name }, title: mapped.title, block: mapped.bodyBlocks[index], passages, audience, sourceAudience, voice, strictVoice: Boolean(voiceNote), voiceNote, selfGrounded });
      const r = await gen({ prompt, systemInstruction: system, responseSchema: levels.LEVEL_SCHEMA, temperature: voiceNote ? 0.2 : 0.4, maxOutputTokens: 1024 });
      calls.push({ step: "draft_levels", audience, block: index + 1, usage: r.usage || null, model: r.modelVersion || null, strictVoice: Boolean(voiceNote) });
      return levels.parseLevelResponse(r.text).text;
    };
    for (const { index } of toRewrite) rewrites.set(index, { text: await write(index) });

    /* Whose voice: the level's paragraphs read together by the voice judge.
       One that speaks as the author — or, in their own account, refers to
       them — is written again with what the judge found, as often as the
       policy allows; one that still does is carried as the scholar wrote it,
       and the level says so. It must not cost the level. */
    let pending = [...rewrites.keys()];
    for (let round = 0; pending.length; round += 1) {
      const judged = await voiceJudge.judgeVoice({ paragraphs: pending.map((i, k) => ({ index: k + 1, text: rewrites.get(i).text })), voice, scholarName: author?.name || null, generate: judgeVoice });
      calls.push(...judged.calls.map((c) => ({ ...c, audience })));
      if (!judged.verdicts) {
        warnings.push("The voice of this level could not be checked just now. Read it for any sentence that speaks as you before approving it.");
        break;
      }
      const flagged = pending.map((i, k) => ({ i, v: judged.verdicts.get(k + 1) })).filter(({ v }) => v.speaksAsAuthor || v.namesAuthor);
      if (!flagged.length) break;
      if (round >= policy.sectionVoiceRetries) {
        for (const { i } of flagged) {
          rewrites.delete(i);
          warnings.push(`Block ${i + 1} was carried as written: the level writer kept writing as you for it.`);
        }
        break;
      }
      for (const { i, v } of flagged) {
        const voiceNote = [
          "A reviewer found your last attempt in the wrong voice.",
          ...(v.sentences.length ? [`These sentences: ${v.sentences.map((x) => `“${x.slice(0, 160)}”`).join(" ")}`] : []),
          ...(v.reason ? [`Why: ${v.reason}`] : []),
        ].join("\n");
        rewrites.set(i, { text: await write(i, { voiceNote }) });
      }
      pending = flagged.map(({ i }) => i);
    }
    if (!rewrites.size) throw new ApiError(502, `The level writer could not rewrite any paragraph for ${AUDIENCES[audience].label.toLowerCase()}; nothing was saved.`);

    /* Judge the rewritten paragraphs claim by claim, a few at a time: claims
       with quoted evidence add up, and one call for a whole article cut the
       judge's answer off mid-JSON. Paragraphs drawn from the paper go to the
       fidelity judge and paragraphs that go beyond it to the reach judge;
       each skips the other's kind. */
    const draft = levels.assembleLevel({ blocks: mapped.bodyBlocks, rewrites });
    const judgeIndexes = [...rewrites.keys()];
    for (let start = 0; start < judgeIndexes.length; start += fidelity.JUDGE_BATCH) {
      const batch = judgeIndexes.slice(start, start + fidelity.JUDGE_BATCH);
      const judgedF = await fidelity.judgeSection({ blocks: batch.map((i) => draft[i]), passages, generate: judgeFidelity });
      if (judgedF.call) calls.push({ ...judgedF.call, audience });
      const judgedR = await reach.judgeSection({ blocks: judgedF.blocks, passages, audience, generate: judgeReach });
      if (judgedR.call) calls.push({ ...judgedR.call, audience });
      batch.forEach((i, k) => { draft[i] = judgedR.blocks[k]; });
    }
    const paperIndexes = judgeIndexes.filter((i) => !draft[i].extension);
    const reachIndexes = judgeIndexes.filter((i) => draft[i].extension);
    const verdicts = paperIndexes.map((i) => draft[i].fidelity?.verdict || null);
    const reachVerdicts = reachIndexes.map((i) => draft[i].reach?.verdict || null);

    /* Whether the level reads right for its reader: an editor model rules,
       with the formula's measurement as evidence and as the number shown. */
    const prose = draft.filter((b) => b.type === "paragraph").map((b) => levels.plain(b.html)).join("\n\n");
    const measured = assessDraftReadability({ text: prose, audience });
    const ruling = await bandJudge.judgeBand({ text: prose, audience, measured, generate: judgeBand });
    calls.push(...ruling.calls.map((c) => ({ ...c, audience })));
    const readability = placeReadability(measured, ruling);
    if (readability.verdict !== "pass" && readability.reason) warnings.push(`This level ${readability.reason}.`);

    /* Stored: rewritten paragraphs normalised like any saved block; carried
       blocks copied from the story as stored, so pictures keep their shape. */
    let blocks = draft.map((b, i) => (rewrites.has(i) ? editorial.normalizeRawBodyBlocks([b])[0] : storyDoc.body_blocks[i]));
    /* The `self-N` ids were scaffolding for the prompt and the judge. They are
       not passages anyone can look up, so they must not reach storage, where
       the evidence rail would offer a reader a citation that resolves to
       nothing.

       Stripped from `provenance`, which is where a stored block keeps them —
       `sourceRefs` is the presented name and does not exist on the way in.
       Targeting the presented name is exactly the bug the e2e test caught: the
       strip ran, matched nothing, and the scaffolding was stored anyway. The
       level's own fidelity summary is unaffected; it is computed before this
       and lives on the level, not the block. */
    if (selfGrounded) blocks = blocks.map((b) => (b && b.provenance ? { ...b, provenance: null } : b));

    made[audience] = {
      audience,
      blocks,
      /* What this level was checked against: the paper, or the scholar's own
         paragraphs. Every surface that reports fidelity has to be able to say
         which, because they are not the same claim. */
      grounding: selfGrounded ? "self" : "source",
      readability: { verdict: readability.verdict, reason: readability.reason || null, judged: readability.judged, fkGrade: readability.fkGrade, targetGrade: readability.targetGrade, drift: readability.drift },
      fidelity: {
        paragraphs: verdicts.length,
        supported: verdicts.filter((v) => v === "supported").length,
        partial: verdicts.filter((v) => v === "partial").length,
        unsupported: verdicts.filter((v) => v === "unsupported").length,
      },
      reach: {
        paragraphs: reachVerdicts.length,
        follows: reachVerdicts.filter((v) => v === "follows").length,
        partial: reachVerdicts.filter((v) => v === "partial").length,
        overreach: reachVerdicts.filter((v) => v === "overreach").length,
      },
      generated_at: new Date(),
      model: calls[calls.length - 1]?.model || null,
      levels_version: levels.LEVELS_VERSION,
      source_version: storyVersion.versionOf(storyDoc),
      source_hashes: levels.sourceHashes(mapped.bodyBlocks),
      warnings,
      approved: false,
      approved_at: null,
      approved_by: null,
    };
  }

  const nextLevels = { ...(storyDoc.levels || {}), ...made };
  const { version } = await editorial.commitStoryWrite(db, {
    story: storyDoc,
    set: { levels: nextLevels, updated_by: actor },
    source: storyVersion.SOURCE.LEVELS,
    actor,
    note: `Written for ${targets.map((a) => AUDIENCES[a].label.toLowerCase()).join(", ")}`,
    baseVersion,
  });
  await editorial.refreshEvidenceAfterWrite(db, storyDoc._id);
  return { written: targets, version, calls };
}

async function generateLevels({ storyId, scholarId, profileId, user, audiences = null, baseVersion = null }) {
  const editorial = require("./editorial.service");
  const { getDb } = require("../db/mongo");
  const db = await getDb();
  const storyDoc = await editorial.findOwnedStory({ storyId, scholarId, profileId });
  const actor = user?.login_email || scholarId;
  const result = await generateLevelsForDoc(db, storyDoc, { audiences, actor, baseVersion: storyVersion.parseBaseVersion(baseVersion) });
  const story = await editorial.getEditorialStory({ storyId, scholarId, profileId });
  return serializeMongoValue({ ...story, written: result.written, calls: result.calls.length });
}

/** The scholar approves levels for readers. A stale level cannot be approved: rewrite it first. */
async function approveLevels({ storyId, scholarId, profileId, user, audiences = null, baseVersion = null }) {
  const editorial = require("./editorial.service");
  const { getDb } = require("../db/mongo");
  const db = await getDb();
  const storyDoc = await editorial.findOwnedStory({ storyId, scholarId, profileId });
  const have = storyDoc.levels || {};
  const wanted = (Array.isArray(audiences) && audiences.length ? audiences.map((a) => normaliseAudience(a)) : Object.keys(have)).filter((a) => have[a]);
  if (!wanted.length) throw new ApiError(400, "There are no reading levels to approve yet. Write them first.");

  const mapped = editorial.mapStoryDocument(storyDoc, null, null);
  const now = new Date();
  const actor = user?.login_email || scholarId;
  const next = { ...have };
  for (const a of wanted) {
    const st = levels.staleness(have[a], mapped.bodyBlocks);
    if (st.stale) throw new ApiError(409, `The ${AUDIENCES[a].label.toLowerCase()} level is out of date: ${st.reason}. Write it again before approving it.`);
    next[a] = { ...have[a], approved: true, approved_at: now, approved_by: actor };
  }
  await editorial.commitStoryWrite(db, {
    story: storyDoc,
    set: { levels: next, updated_by: actor },
    source: storyVersion.SOURCE.SCHOLAR,
    actor,
    note: `Approved the ${wanted.map((a) => AUDIENCES[a].label.toLowerCase()).join(", ")} level${wanted.length === 1 ? "" : "s"}`,
    baseVersion: storyVersion.parseBaseVersion(baseVersion),
  });
  await editorial.refreshEvidenceAfterWrite(db, storyDoc._id);
  const story = await editorial.getEditorialStory({ storyId, scholarId, profileId });
  return serializeMongoValue({ ...story, approved: wanted });
}

/**
 * The scholar discards reading levels they do not want.
 *
 * Named bands, or every band they have not approved — the ones the Studio
 * queue asks them about. A level that is live for readers may be discarded
 * too, and then readers stop seeing it; that is a change to what is
 * published, so it is a version of the story like any other write, recorded
 * in the history with who did it and which bands went.
 */
async function discardLevels({ storyId, scholarId, profileId, user, audiences = null, baseVersion = null }) {
  const editorial = require("./editorial.service");
  const { getDb } = require("../db/mongo");
  const db = await getDb();
  const storyDoc = await editorial.findOwnedStory({ storyId, scholarId, profileId });
  const have = storyDoc.levels || {};
  const { remove, live, missing } = levels.levelsToDiscard(have, audiences);
  if (missing.length) {
    throw new ApiError(404, `There is no ${missing.map((a) => AUDIENCES[a].label.toLowerCase()).join(" or ")} level on this story to discard.`);
  }
  if (!remove.length) {
    throw new ApiError(400, "There are no reading levels waiting on this story. Nothing to discard.");
  }

  const actor = user?.login_email || scholarId;
  const next = { ...have };
  for (const a of remove) delete next[a];
  const named = remove.map((a) => AUDIENCES[a].label.toLowerCase());
  await editorial.commitStoryWrite(db, {
    story: storyDoc,
    set: { levels: next, updated_by: actor },
    source: storyVersion.SOURCE.SCHOLAR,
    actor,
    note: `Discarded the ${named.join(", ")} level${remove.length === 1 ? "" : "s"}${live.length ? `, ${live.length} of which ${live.length === 1 ? "was" : "were"} live for readers` : ""}`,
    baseVersion: storyVersion.parseBaseVersion(baseVersion),
  });
  await editorial.refreshEvidenceAfterWrite(db, storyDoc._id);
  const story = await editorial.getEditorialStory({ storyId, scholarId, profileId });
  return serializeMongoValue({ ...story, discarded: remove, wasLive: live });
}

module.exports = { generateLevelsForDoc, generateLevels, approveLevels, discardLevels };
