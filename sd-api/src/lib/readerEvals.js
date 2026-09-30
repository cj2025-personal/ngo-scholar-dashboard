"use strict";

/**
 * Scoring the reading companion, and deciding whether a prompt change may
 * ship. Pure.
 *
 * ── The five scores ─────────────────────────────────────────────────────────
 *   grounding   share of rows where the answer's declared grounding (story,
 *               background, not_here) is what the row expected. The one that
 *               catches a companion that guesses when it should say "the
 *               article doesn't say", or that says so when the answer is there.
 *   sentinel    share of rows where the reader saw an answer, not the refusal.
 *               A prompt that the Sentinel has to keep sending back fails here.
 *   cited       share of rows whose answer cites every block or passage the
 *               row expected. 1 when the row expects none.
 *   bandFit     readability against the reader's age: pass 1, warn 0.5, fail 0.
 *   firstTry    share of rows answered without a rewrite. Reported and
 *               thresholded low: a rewrite is a cost, not a fault.
 *
 * Thresholds are per set, not per row.
 */

const { isAudience } = require("./audiences");
const { assessDraftReadability, VERDICT: READ } = require("./draftReadability");
const agent = require("./readingAgent");

const EVAL_VERSION = "reader-evals-2026.1";

const THRESHOLDS = {
  grounding: 0.8,
  sentinel: 0.9,
  cited: 0.8,
  bandFit: 0.8,
  firstTry: 0.6,
};

/** Score one row's result (the shape `companion.answerQuestion` returns). */
function scoreTurn(result, row) {
  const answer = result?.answer || null;
  const expectGrounding = row.expect?.grounding || null;
  const expectCites = Array.isArray(row.expect?.cites) ? row.expect.cites : [];
  const cited = new Set([...(answer?.blockIds || []), ...(answer?.passageIds || [])]);
  const readability = answer ? assessDraftReadability({ text: answer.text, audience: row.audience || "adults" }) : null;
  return {
    grounding: answer && expectGrounding ? (answer.grounding === expectGrounding ? 1 : 0) : answer ? 1 : 0,
    sentinel: answer ? 1 : 0,
    cited: expectCites.length ? (expectCites.every((id) => cited.has(id)) ? 1 : 0) : 1,
    bandFit: !readability ? 0 : readability.verdict === READ.PASS ? 1 : readability.verdict === READ.WARN ? 0.5 : 0,
    firstTry: answer && result.attempts === 1 ? 1 : 0,
    attempts: result?.attempts || 0,
    words: answer ? answer.words || agent.wordCount(answer.text) : 0,
    fkGrade: readability?.fkGrade ?? null,
    calls: (result?.calls || []).length,
    verdict: result?.check?.verdict || null,
    reasons: result?.check?.reasons || [],
    declared: answer?.grounding || null,
    tokens: (result?.usage || []).reduce((a, u) => ({ input: a.input + (u?.input || 0), output: a.output + (u?.output || 0) }), { input: 0, output: 0 }),
  };
}

/** Means over a set, and the verdict against the thresholds. */
function summarise(scores, thresholds = THRESHOLDS) {
  const n = scores.length;
  const mean = (key) => (n ? +(scores.reduce((a, s) => a + (s[key] || 0), 0) / n).toFixed(3) : 0);
  const means = { grounding: mean("grounding"), sentinel: mean("sentinel"), cited: mean("cited"), bandFit: mean("bandFit"), firstTry: mean("firstTry"), words: mean("words"), calls: mean("calls") };
  const checks = Object.fromEntries(Object.keys(thresholds).map((k) => [k, means[k] >= thresholds[k]]));
  const failures = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => `${k}: ${means[k]} against at least ${thresholds[k]}`);
  return { n, means, checks, pass: n > 0 && failures.length === 0, failures, version: EVAL_VERSION };
}

/* ── datasets ────────────────────────────────────────────────────────────── */

const GROUNDINGS = new Set(Object.values(agent.GROUNDING));

/**
 * One eval row: a story (title and presented blocks), its passages, the
 * reader's age, the question, and what a right answer looks like.
 */
function validateRow(row, index) {
  const problems = [];
  if (!row || typeof row !== "object") return [`row ${index}: not an object`];
  const id = row.id || index;
  if (typeof row.id !== "string" || !row.id) problems.push(`row ${index}: missing id`);
  if (!Array.isArray(row.blocks) || !row.blocks.length) problems.push(`row ${id}: blocks must be a non-empty array`);
  if (!Array.isArray(row.passages)) problems.push(`row ${id}: passages must be an array`);
  if (typeof row.question !== "string" || !row.question.trim()) problems.push(`row ${id}: missing question`);
  if (row.audience && !isAudience(row.audience)) problems.push(`row ${id}: unknown audience ${row.audience}`);
  if (row.expect?.grounding && !GROUNDINGS.has(row.expect.grounding)) problems.push(`row ${id}: expect.grounding must be one of ${[...GROUNDINGS].join(", ")}`);
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

/** The companion's input for a row. */
function inputFor(row) {
  return {
    blocks: agent.blocksFromStory(row.blocks),
    passages: (row.passages || []).map((p) => ({ id: p.id, text: p.text })),
    question: row.question.trim(),
    audience: row.audience || "adults",
    storyTitle: row.title || row.id,
    focusIndex: Number.isInteger(row.focusIndex) ? row.focusIndex : null,
  };
}

module.exports = { EVAL_VERSION, THRESHOLDS, scoreTurn, summarise, validateRow, parseJsonl, inputFor };
