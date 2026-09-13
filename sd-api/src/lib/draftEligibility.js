/**
 * What a scholar's sources can be used for: drafted from, cited, or neither.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * "Draft from my research" turns a scholar's own paper into a student article.
 * Whether that is allowed depends on what we hold and under what terms, and
 * the answer was measured before this file was written:
 *
 *   · 3,398 of 3,757 harvested sources are licensed `short_quotes`. Quoting six
 *     sentences from one is a citation; writing five paragraphs from it is
 *     republishing.
 *   · Every one of the 8,539 `scholar_passages` is `kind: "abstract"` — 150 to
 *     250 words. You cannot draft an article from an abstract without inventing
 *     everything past it.
 *   · Of 65 Legacy scholars, 4 hold ≥ 2,000 words of full-use text.
 *
 * So this is the legal boundary of the feature, written as code that can be
 * tested, rather than as a rule someone remembers. It is deliberately pure: it
 * classifies what it is handed and never fetches, so the same function can be
 * run against a hypothetical scholar in an admin preview.
 *
 * ── Silence over a guess ───────────────────────────────────────────────────
 * A source with no licence recorded is `unusable`, not `citable`. Unknown
 * provenance is worse than restricted provenance — you cannot defend what you
 * cannot characterise — and a classifier that defaults to "probably fine" is
 * the one that ends up in a takedown notice.
 */

const USE = {
  /** We may reproduce it at length: a draft can be built from it. */
  DRAFTABLE: "draftable",
  /** We may quote briefly and point at it, but not build on it. */
  CITABLE: "citable",
  /** We may not use the text at all — title and existence only. */
  UNUSABLE: "unusable",
};

const ORIGIN = {
  /** Fetched from the web by the enrichment pipeline; carries `allowed_use`. */
  HARVESTED: "harvested",
  /** Uploaded by the scholar through the portal, with consent recorded. */
  CONTRIBUTED: "contributed",
};

const THRESHOLDS = {
  /* p25 of scholars holding any full-use text is 3,521 words and p50 is
     6,160, so 2,000 admits nearly everyone who has a real paper — and, since
     an abstract is ~200 words, excludes abstracts by construction rather than
     by a special case. */
  MIN_DRAFT_WORDS: 2000,
  /* Below this there is nothing to quote either. */
  MIN_CITE_WORDS: 150,
};

/* Portal document types that are about the scholar rather than by them. A CV
   is evidence for the record; it is not something to write an article from. */
const NOT_A_PAPER = new Set(["identity", "cv", "credential", "correspondence"]);

/* Where a contributed document is on the portal's path to draftable. Only
   the two in-flight stages mean "wait"; the rest mean "act" or "done". */
const STAGE = {
  NO_CONSENT: "no_consent",
  NOT_AVAILABLE: "not_available",
  NOT_A_PAPER: "not_a_paper",
  AWAITING_EXTRACTION: "awaiting_extraction",
  EXTRACTION_FAILED: "extraction_failed",
  AWAITING_REVIEW: "awaiting_review",
  REJECTED: "rejected",
  TOO_THIN: "too_thin",
  READY: "ready",
};
const PENDING_STAGES = new Set([STAGE.AWAITING_EXTRACTION, STAGE.AWAITING_REVIEW]);

const FULL_USE = new Set(["full", "full_text"]);
const QUOTE_USE = new Set(["short_quotes"]);

/**
 * Classify one source.
 *
 * Accepts the shapes that actually exist rather than a cleaned one, so a
 * missing field can never become a permissive default on the way in.
 */
function classifySource(src) {
  if (!src || typeof src !== "object") {
    return result(USE.UNUSABLE, "no source", { words: 0 });
  }

  const origin = src.origin === ORIGIN.CONTRIBUTED ? ORIGIN.CONTRIBUTED : ORIGIN.HARVESTED;
  /* A contributed document's text lives on its extraction row, not on the
     document: the portal's extractor writes a verbatim per-page transcription
     there, and it is purged with the bytes. Nothing else may be counted. */
  const words = origin === ORIGIN.CONTRIBUTED
    ? finite(src.extraction?.words)
    : finite(src.word_count ?? src.words);
  const kind = clean(src.kind);
  const base = {
    id: clean(src.source_id) || clean(src.document_id) || clean(src.id) || null,
    title: clean(src.title) || "Untitled source",
    year: finite(src.source_year ?? src.year),
    origin,
    words,
  };

  /* An abstract is never draft material, whatever its licence says. */
  if (kind === "abstract") {
    return words >= THRESHOLDS.MIN_CITE_WORDS
      ? result(USE.CITABLE, "an abstract — enough to cite, not to build on", base)
      : result(USE.UNUSABLE, "an abstract too short to quote", base);
  }

  if (origin === ORIGIN.CONTRIBUTED) {
    /* The scholar's own upload, through the Scholar Documents portal. It is
       draftable only once every gate that portal runs has passed: consent on
       record, bytes accepted, text extracted, extraction accepted by a person.
       Each stop on that path gets its own sentence, because "not draftable"
       would be true at all of them and useless at every one. */
    if (!src.consent?.accepted_at) {
      return result(USE.UNUSABLE, "uploaded without recorded consent", base, STAGE.NO_CONSENT);
    }
    if (src.status && src.status !== "available") {
      return result(USE.UNUSABLE, `upload is ${String(src.status).replace(/_/g, " ")}`, base, STAGE.NOT_AVAILABLE);
    }
    if (NOT_A_PAPER.has(clean(src.document_type))) {
      return result(USE.UNUSABLE, `a ${clean(src.document_type)} document, not a paper`, base, STAGE.NOT_A_PAPER);
    }

    const ex = src.extraction || null;
    if (!ex || !ex.status) {
      return result(USE.UNUSABLE, "uploaded — text extraction hasn't run yet", base, STAGE.AWAITING_EXTRACTION);
    }
    if (ex.status === "failed") {
      return result(USE.UNUSABLE, "text extraction failed — a text-based PDF works better than a scan", base, STAGE.EXTRACTION_FAILED);
    }
    if (ex.reviewStatus === "rejected") {
      return result(USE.UNUSABLE, "extracted, but a reviewer declined it", base, STAGE.REJECTED);
    }
    if (ex.status === "needs_review" || ex.reviewStatus !== "accepted") {
      return result(USE.UNUSABLE, "extracted — awaiting a reviewer's acceptance", base, STAGE.AWAITING_REVIEW);
    }
    if (words < THRESHOLDS.MIN_CITE_WORDS) {
      return result(USE.UNUSABLE, "accepted, but almost no readable text was captured", base, STAGE.TOO_THIN);
    }
    if (words < THRESHOLDS.MIN_DRAFT_WORDS) {
      return result(USE.CITABLE, `${words.toLocaleString()} words — too short to draft from`, base, STAGE.TOO_THIN);
    }
    return result(USE.DRAFTABLE, "your own upload, extracted and accepted", base, STAGE.READY);
  }

  const use = clean(src.allowed_use);

  if (!use || use === "unknown") {
    return result(USE.UNUSABLE, "licence unknown — we won't guess", base);
  }
  if (use === "metadata_only") {
    return result(USE.UNUSABLE, "licence allows the title only", base);
  }
  if (QUOTE_USE.has(use)) {
    return words >= THRESHOLDS.MIN_CITE_WORDS
      ? result(USE.CITABLE, "licence allows short quotes only", base)
      : result(USE.UNUSABLE, "licence allows short quotes, and there is too little to quote", base);
  }
  if (FULL_USE.has(use)) {
    if (words < THRESHOLDS.MIN_CITE_WORDS) {
      return result(USE.UNUSABLE, "licensed in full, but almost no text was captured", base);
    }
    if (words < THRESHOLDS.MIN_DRAFT_WORDS) {
      return result(USE.CITABLE, `licensed in full but only ${words.toLocaleString()} words — too short to draft from`, base);
    }
    return result(USE.DRAFTABLE, `licensed in full (${clean(src.license_type) || use})`, base);
  }

  /* A licence value this file has never heard of is not a licence it can
     honour. Refuse rather than map it to the nearest friendly bucket. */
  return result(USE.UNUSABLE, `unrecognised licence "${use}"`, base);
}

/**
 * May this scholar use the feature at all?
 *
 * The perk is scoped to the Legacy Archive. That is `status: "legacy"` on the
 * curated record — 65 scholars — and nothing else; a separate flag would only
 * be warranted if the perk ever needed granting without Legacy membership.
 */
function legacyGate(scholar) {
  if (!scholar || typeof scholar !== "object") {
    return { eligible: false, reason: "no scholar record" };
  }
  if (scholar.status === "legacy") {
    return { eligible: true, reason: "Legacy Archive member" };
  }
  return {
    eligible: false,
    reason: "Drafting from your research is a Legacy Archive feature.",
  };
}

/**
 * Everything the composer panel needs, from a scholar and their sources.
 *
 * `draftable` is ordered richest-first because that is what a picker shows.
 * `nudge` is present only when nothing is draftable, and says the one thing
 * that would change that — this is the sentence that makes the upload
 * surface worth using.
 */
function summarise({ scholar, sources = [] }) {
  const gate = legacyGate(scholar);
  const classified = sources.map(classifySource);

  const draftable = classified
    .filter((s) => s.use === USE.DRAFTABLE)
    .sort((a, b) => b.words - a.words);
  const citable = classified.filter((s) => s.use === USE.CITABLE);
  const unusable = classified.filter((s) => s.use === USE.UNUSABLE);

  const pending = classified.filter((s) => s.pending);

  /* Asking for a paper while one is in flight tells a scholar their upload
     went nowhere. So: something pending → say where it is; nothing pending and
     nothing draftable → say what would change that. */
  const nudge =
    draftable.length > 0
      ? null
      : pending.length > 0
      ? pending.length === 1
        ? "Your paper is being checked. Once its text has been extracted and a reviewer has accepted it, it will appear here as ready to draft from."
        : `${pending.length} of your papers are being checked. Once their text has been extracted and a reviewer has accepted them, they will appear here as ready to draft from.`
      : citable.length > 0
      ? "We can cite your work but not draft from it — everything we hold is licensed for short quotes only. " +
        "Add a paper you hold the rights to (a preprint, an accepted manuscript, lecture notes) and it can be drafted from in full."
      : "We don't yet hold any of your work in a form we can draft from. " +
        "Add a paper you hold the rights to (a preprint, an accepted manuscript, lecture notes) to get started.";

  return {
    eligible: gate.eligible,
    gateReason: gate.reason,
    counts: { draftable: draftable.length, citable: citable.length, unusable: unusable.length, pending: pending.length },
    draftable,
    citable,
    unusable,
    nudge,
  };
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

function result(use, reason, base, stage = null) {
  return stage ? { ...base, use, reason, stage, pending: PENDING_STAGES.has(stage) } : { ...base, use, reason };
}

function clean(v) {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

function finite(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

module.exports = { USE, ORIGIN, STAGE, THRESHOLDS, classifySource, legacyGate, summarise };
