/**
 * Where each block came from, and whether it still does. Pure.
 *
 * ── The chip ────────────────────────────────────────────────────────────────
 * A drafted paragraph arrives citing the passages it was built from. That
 * citation is stored on the block as `source_refs`, with the text the block
 * had when it was drafted and the fact-checker's verdict on it. In the editor
 * it shows as a chip: "from Gupta 2011 · p3". The chip is the receipt for the
 * claim that this article was drawn from the scholar's own work.
 *
 * ── Why the chip can drop ───────────────────────────────────────────────────
 * The scholar edits. A paragraph rewritten from scratch is no longer the
 * paragraph the judge checked against p3, and a chip that survives that edit
 * is a receipt for something that no longer exists. So traceability is
 * measured, not assumed: the fraction of the drafted paragraph's content
 * words still present in the current text. Below the threshold the chip
 * drops and the gutter says "no longer traceable". The refs stay stored —
 * the history is the history — but nothing is claimed for the block.
 *
 * ── Why a token overlap and not an edit distance ────────────────────────────
 * Edits that keep the substance keep most of the words: fixing a sentence,
 * cutting a clause, reordering. Edits that change the substance replace the
 * words. Overlap of content tokens separates those two cheaply and in a way a
 * scholar can predict; an edit distance penalises a reordering it should not.
 */

const TRACE_THRESHOLD = 0.6;
const PROVENANCE_VERSION = "provenance-2026.1";

const STOP = new Set([
  "the", "and", "for", "that", "with", "this", "from", "which", "were", "was", "are", "has", "have", "had",
  "but", "not", "its", "their", "they", "than", "then", "when", "into", "also", "more", "most", "such",
  "about", "over", "under", "between", "these", "those", "there", "here", "where", "what", "who", "how",
]);

function normaliseText(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** Content tokens: lowercase words of three or more letters or digits, minus stop words. */
function tokenSet(text) {
  const out = new Set();
  for (const raw of normaliseText(text).toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length >= 3 && !STOP.has(raw)) out.add(raw);
  }
  return out;
}

/** Fraction of the drafted text's content tokens still present in the current text. */
function overlap(draftedText, currentText) {
  const drafted = tokenSet(draftedText);
  if (drafted.size === 0) return 0;
  const current = tokenSet(currentText);
  let kept = 0;
  for (const t of drafted) if (current.has(t)) kept += 1;
  return +(kept / drafted.size).toFixed(3);
}

/**
 * @returns {{traceable: boolean, overlap: number, reason: string|null}}
 */
function traceability({ draftedText, currentText, threshold = TRACE_THRESHOLD }) {
  const o = overlap(draftedText, currentText);
  if (o >= threshold) return { traceable: true, overlap: o, reason: null };
  return {
    traceable: false,
    overlap: o,
    reason: `edited beyond its source: ${Math.round(o * 100)}% of the drafted wording remains, under the ${Math.round(threshold * 100)}% needed`,
  };
}

/* ── shapes ──────────────────────────────────────────────────────────────── */

const REF_ID = /^[A-Za-z0-9_.:\-]{1,120}$/;

/** [{passageId}] as the drafter emits, or [{passageId, sourceId, origin}] as stored. */
function normalizeSourceRefs(refs) {
  if (!Array.isArray(refs)) return [];
  const out = [];
  const seen = new Set();
  for (const r of refs) {
    const passageId = typeof r?.passageId === "string" ? r.passageId.trim() : "";
    if (!REF_ID.test(passageId) || seen.has(passageId)) continue;
    seen.add(passageId);
    out.push({ passageId });
  }
  return out.slice(0, 12);
}

const FIDELITY_VERDICTS = new Set(["supported", "partial", "unsupported"]);

function normalizeFidelity(f) {
  if (!f || typeof f !== "object" || !FIDELITY_VERDICTS.has(f.verdict)) return null;
  return {
    verdict: f.verdict,
    unsupportedClaims: (Array.isArray(f.unsupportedClaims) ? f.unsupportedClaims : []).map((s) => String(s).slice(0, 300)).filter(Boolean).slice(0, 6),
  };
}

/**
 * A block's provenance as stored, from what the client sent.
 *
 * Returns null for a block that was never drafted (no refs). Traceability is
 * measured here, on the server, against the text being saved — the client's
 * live chip is a preview of the same function.
 */
function normalizeBlockProvenance({ sourceRefs, draftedText, fidelity, currentHtml }) {
  const refs = normalizeSourceRefs(sourceRefs);
  if (refs.length === 0) return null;
  const drafted = normaliseText(draftedText).slice(0, 4000);
  const current = normaliseText(currentHtml);
  const trace = drafted ? traceability({ draftedText: drafted, currentText: current }) : { traceable: false, overlap: 0, reason: "no drafted text recorded" };
  return {
    source_refs: refs,
    drafted_text: drafted || null,
    fidelity: normalizeFidelity(fidelity),
    traceable: trace.traceable,
    overlap: trace.overlap,
    trace_reason: trace.reason,
    version: PROVENANCE_VERSION,
  };
}

/** The client's shape, from what is stored. */
function presentBlockProvenance(p) {
  if (!p || !Array.isArray(p.source_refs) || p.source_refs.length === 0) return {};
  return {
    sourceRefs: p.source_refs.map((r) => ({ passageId: r.passageId })),
    draftedText: p.drafted_text || "",
    fidelity: p.fidelity || null,
    traceable: Boolean(p.traceable),
    overlap: typeof p.overlap === "number" ? p.overlap : null,
    traceReason: p.trace_reason || null,
  };
}

/** Story-level provenance, from the draft job that produced the text. */
function storyProvenanceFromJob(job) {
  if (!job || !job.source) return null;
  return {
    job_id: job._id,
    origin: job.source.origin,
    source_id: job.source.id,
    source_title: job.source.title || null,
    source_year: job.source.year ?? null,
    prompt_version: job.prompt_version || null,
    graph_version: job.graph_version || null,
    drafted_at: job.finished_at || job.created_at || null,
    version: PROVENANCE_VERSION,
  };
}

/**
 * The line under the byline, from the read-time join.
 *
 * @param {object|null} resolved  {title, year, url} looked up at read time, or null
 */
function provenanceLine(resolved) {
  if (!resolved || !resolved.title) return null;
  const year = resolved.year ? ` (${resolved.year})` : "";
  return `Drawn from the author's research: ${resolved.title}${year}`;
}

/** "Gupta 2011" from a title and year — the chip's short label. */
function shortSourceLabel({ title, year, scholarSurname }) {
  const who = scholarSurname || (title ? String(title).split(/\s+/).slice(0, 3).join(" ") : "source");
  return year ? `${who} ${year}` : who;
}

module.exports = {
  TRACE_THRESHOLD,
  PROVENANCE_VERSION,
  tokenSet,
  overlap,
  traceability,
  normalizeSourceRefs,
  normalizeBlockProvenance,
  presentBlockProvenance,
  storyProvenanceFromJob,
  provenanceLine,
  shortSourceLabel,
};
