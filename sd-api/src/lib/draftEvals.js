/**
 * Scoring a draft, and deciding whether a prompt change may ship. Pure.
 *
 * ── Why this is the last line ───────────────────────────────────────────────
 * The passage generator stored a measured grade beside every passage and
 * nothing read it, and the corpus drifted 4.3 grades from its labels before
 * anyone noticed. The lesson is not that the measurement was wrong; it is
 * that a measurement nothing acts on is decoration. Here the measurements
 * gate: a prompt or model change is run over the eval set, scored on the
 * four things the drafter must get right, and refused if any threshold is
 * missed. CI does the refusing, so it cannot be skipped by being busy.
 *
 * ── The four scores ─────────────────────────────────────────────────────────
 *   entailment  share of paragraphs the fidelity judge marked supported.
 *               The judge is a separate prompt; this reads its verdicts.
 *   bandFit     readability against the audience: pass 1, warn 0.5, fail 0.
 *   voice       first-person sentences in the prose. Must be zero: a draft
 *               that says "I" under a living scholar's name is refused
 *               upstream, so any here is a regression in that refusal.
 *   provenance  share of paragraphs carrying at least one passage citation.
 *
 * Thresholds are per set, not per draft: one hard paper may miss band fit
 * and still be a fair draft, but a set that averages under the floor has a
 * prompt problem.
 */

const composer = require("./draftComposer");

const EVAL_VERSION = "draft-evals-2026.1";

const THRESHOLDS = {
  /* Measured on the synthetic set on 2026-09-12: every paragraph supported.
     Nine in ten leaves room for a hard paper without letting a prompt that
     invents a claim in every third paragraph through. */
  entailment: 0.9,
  bandFit: 0.75,
  voiceViolations: 0,
  provenance: 0.95,
};

/** Score one graph result (the shape `runDraftGraph` returns). */
function scoreDraft(result) {
  const paragraphs = (result?.bodyBlocks || []).filter((b) => b.type === "paragraph");
  const n = paragraphs.length;
  const supported = paragraphs.filter((b) => b.fidelity?.verdict === "supported").length;
  const partial = paragraphs.filter((b) => b.fidelity?.verdict === "partial").length;
  const unsupported = paragraphs.filter((b) => b.fidelity?.verdict === "unsupported").length;
  const cited = paragraphs.filter((b) => Array.isArray(b.sourceRefs) && b.sourceRefs.length > 0).length;
  const prose = paragraphs.map((b) => unescapeHtml(b.html)).join("\n\n");
  const voice = composer.firstPersonSentences(prose).length;
  const verdict = result?.readability?.verdict || null;
  const bandFit = verdict === "pass" ? 1 : verdict === "warn" ? 0.5 : 0;

  return {
    paragraphs: n,
    entailment: n ? +(supported / n).toFixed(3) : 0,
    partial,
    unsupported,
    bandFit,
    fkGrade: result?.readability?.fkGrade ?? null,
    drift: result?.readability?.drift ?? null,
    voiceViolations: voice,
    provenance: n ? +(cited / n).toFixed(3) : 0,
    words: result?.words ?? 0,
    calls: Array.isArray(result?.calls) ? result.calls.length : 0,
    tokens: (result?.calls || []).reduce(
      (acc, c) => ({ input: acc.input + (c.usage?.input || 0), output: acc.output + (c.usage?.output || 0) }),
      { input: 0, output: 0 },
    ),
    warnings: (result?.warnings || []).length,
  };
}

/** Means over a set, and the verdict against the thresholds. */
function summarise(scores, thresholds = THRESHOLDS) {
  const n = scores.length;
  const mean = (key) => (n ? +(scores.reduce((a, s) => a + (s[key] || 0), 0) / n).toFixed(3) : 0);
  const sum = (key) => scores.reduce((a, s) => a + (s[key] || 0), 0);
  const means = {
    entailment: mean("entailment"),
    bandFit: mean("bandFit"),
    voiceViolations: sum("voiceViolations"),
    provenance: mean("provenance"),
    words: mean("words"),
    calls: mean("calls"),
  };
  const checks = {
    entailment: means.entailment >= thresholds.entailment,
    bandFit: means.bandFit >= thresholds.bandFit,
    voiceViolations: means.voiceViolations <= thresholds.voiceViolations,
    provenance: means.provenance >= thresholds.provenance,
  };
  const failures = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([k]) => `${k}: ${means[k]} against ${k === "voiceViolations" ? "at most" : "at least"} ${thresholds[k]}`);
  return { n, means, checks, pass: n > 0 && failures.length === 0, failures, version: EVAL_VERSION };
}

/* ── datasets ────────────────────────────────────────────────────────────── */

/**
 * One eval row. `text` is the prepared source text the graph is given;
 * everything else describes it. Rows come from `evals/*.jsonl`.
 */
function validateRow(row, index) {
  const problems = [];
  if (!row || typeof row !== "object") return [`row ${index}: not an object`];
  if (typeof row.id !== "string" || !row.id) problems.push(`row ${index}: missing id`);
  if (typeof row.text !== "string" || row.text.split(/\s+/).length < 200) problems.push(`row ${row.id || index}: text under 200 words`);
  if (row.audience && !composer.AUDIENCES[row.audience]) problems.push(`row ${row.id || index}: unknown audience ${row.audience}`);
  return problems;
}

function parseJsonl(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l, i) => {
      try {
        return JSON.parse(l);
      } catch {
        throw new Error(`line ${i + 1} is not valid JSON`);
      }
    });
}

/** The graph input for a row. */
function inputFor(row) {
  const prepared = composer.prepareSourceText(row.text);
  return {
    source: { id: row.id, origin: row.origin === "contributed" ? "contributed" : "harvested", title: row.title || row.id, year: row.year ?? null, use: "draftable", reason: "eval row" },
    scholar: { name: row.scholarName || "the scholar", field: row.field || null },
    audience: row.audience || composer.DEFAULT_AUDIENCE,
    prepared,
  };
}

function unescapeHtml(value) {
  return String(value || "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

module.exports = { EVAL_VERSION, THRESHOLDS, scoreDraft, summarise, validateRow, parseJsonl, inputFor };
