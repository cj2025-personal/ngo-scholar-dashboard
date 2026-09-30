#!/usr/bin/env node
/**
 * Run the reading companion over the eval set and refuse to pass if it has
 * regressed.
 *
 *   npm run eval:reader                       # evals/reader.jsonl, real model, exit 1 on failure
 *   npm run eval:reader -- --limit 1          # first row only
 *   npm run eval:reader -- --dataset path.jsonl
 *   npm run eval:reader -- --json out.json    # write per-row scores for diffing
 *   LLM_PROVIDER=fake npm run eval:reader     # the fake model, to check the harness itself
 *
 * ── What this gates ─────────────────────────────────────────────────────────
 * The five scores in `lib/readerEvals.js`, averaged over the set, against
 * their thresholds. A prompt or model change that makes the companion guess
 * where it should say "the article doesn't say", or that the Sentinel keeps
 * refusing, exits non-zero.
 *
 * ── Cost ────────────────────────────────────────────────────────────────────
 * Each row is one question: two to four agent calls and one Sentinel call,
 * twice on a rewrite. A few thousand tokens a row.
 *
 * Needs Vertex configured (the same variables the API uses). Touches no
 * database.
 */

require("dotenv").config();

const fs = require("fs");
const path = require("path");

const companion = require("../src/lib/companion");
const { AGENT_VERSION } = require("../src/lib/readingAgent");
const { SENTINEL_VERSION } = require("../src/lib/sentinel");
const { THRESHOLDS, EVAL_VERSION, scoreTurn, summarise, validateRow, parseJsonl, inputFor } = require("../src/lib/readerEvals");
const vertex = require("../src/lib/vertex");
const { traced, isTracingConfigured } = require("../src/lib/tracing");

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const datasetPath = path.resolve(opt("--dataset", path.join(__dirname, "..", "evals", "reader.jsonl")));
const limit = Number(opt("--limit", Infinity)) || Infinity;
const jsonOut = opt("--json", null);

const main = async () => {
  if (!vertex.isConfigured()) {
    console.error(`The model is not configured: ${vertex.describeMissingConfig()}`);
    process.exit(2);
  }

  const rows = parseJsonl(fs.readFileSync(datasetPath, "utf8"));
  const problems = rows.flatMap((r, i) => validateRow(r, i));
  if (problems.length) {
    console.error("dataset problems:\n  " + problems.join("\n  "));
    process.exit(2);
  }
  const queue = rows.slice(0, limit);

  console.log("=".repeat(78));
  console.log(`READER EVALS · ${path.basename(datasetPath)} · ${queue.length} row(s)`);
  console.log(`  agent ${AGENT_VERSION} · sentinel ${SENTINEL_VERSION} · evals ${EVAL_VERSION}`);
  console.log(`  model ${vertex.resolveResourceName()}`);
  console.log(`  tracing ${isTracingConfigured() ? "on (LangSmith)" : "off"}`);
  console.log("=".repeat(78));

  const generate = traced("eval.reader.generateContent", (req) => vertex.generateContent(req));
  const results = [];

  for (const row of queue) {
    const t0 = Date.now();
    let result = null;
    let error = null;
    try {
      result = await companion.answerQuestion({ ...inputFor(row), generate });
    } catch (e) {
      error = e;
    }
    const ms = Date.now() - t0;
    const score = scoreTurn(result, row);
    results.push({ id: row.id, audience: row.audience || "adults", question: row.question, expected: row.expect || null, ms, error: error ? error.message : null, score, answer: result?.answer?.text || null });
    console.log(
      `${row.id.padEnd(28)} ${error ? "ERROR " + error.message.slice(0, 60) : ""}` +
        (result
          ? `${(score.declared || "refused").padEnd(10)} want ${(row.expect?.grounding || "-").padEnd(10)} cited ${score.cited}  band ${score.bandFit} (FK ${score.fkGrade ?? "-"})  ` +
            `${score.attempts} attempt${score.attempts === 1 ? "" : "s"}  ${score.words}w  ${score.calls} calls  ${score.tokens.input}/${score.tokens.output} tok  ${(ms / 1000).toFixed(1)}s`
          : ""),
    );
    if (result?.check?.reasons?.length) console.log(`    · sentinel: ${result.check.verdict} (${result.check.reasons.join(", ")})`);
    if (result?.answer) console.log(`    · ${result.answer.text.slice(0, 160)}${result.answer.text.length > 160 ? "…" : ""}`);
  }

  const summary = summarise(results.map((r) => r.score));
  console.log("\n" + "=".repeat(78));
  console.log(`means  grounding ${summary.means.grounding}  sentinel ${summary.means.sentinel}  cited ${summary.means.cited}  bandFit ${summary.means.bandFit}  firstTry ${summary.means.firstTry}  words ${summary.means.words}  calls ${summary.means.calls}`);
  console.log(`floors grounding ≥ ${THRESHOLDS.grounding}  sentinel ≥ ${THRESHOLDS.sentinel}  cited ≥ ${THRESHOLDS.cited}  bandFit ≥ ${THRESHOLDS.bandFit}  firstTry ≥ ${THRESHOLDS.firstTry}`);
  const errored = results.filter((r) => r.error).length;
  if (errored) console.log(`errors ${errored} of ${results.length} row(s) did not produce an answer`);
  console.log(summary.pass && !errored ? "\nPASS" : `\nFAIL: ${[...summary.failures, ...(errored ? [`${errored} row(s) errored`] : [])].join("; ")}`);

  if (jsonOut) {
    fs.writeFileSync(path.resolve(jsonOut), JSON.stringify({ dataset: path.basename(datasetPath), agent: AGENT_VERSION, sentinel: SENTINEL_VERSION, evals: EVAL_VERSION, model: vertex.resolveResourceName(), at: new Date().toISOString(), summary, results }, null, 2));
    console.log(`wrote ${jsonOut}`);
  }

  process.exit(summary.pass && !errored ? 0 : 1);
};

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
