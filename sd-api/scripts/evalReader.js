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
const guard = require("../src/lib/agents/readerGuard");
const { AGENT_VERSION } = require("../src/lib/readingAgent");
const { SENTINEL_VERSION, writeRefusal } = require("../src/lib/sentinel");
const { THRESHOLDS, EVAL_VERSION, scoreTurn, summarise, validateRow, parseJsonl, inputFor } = require("../src/lib/readerEvals");
const { createRouter } = require("../src/lib/modelRouter");
/* Every policy this run reads: the baseline, or a proposed change laid over
   it when started with `--policy <file>` (scripts/policy.js does that before
   it writes the change). */
const { readProposal, policyFor: policyUnder } = require("../src/lib/policyChange");
const proposal = readProposal(process.argv);
const policyFor = (name) => policyUnder(name, proposal);
const { AUDIENCES } = require("../src/lib/audiences");
const vertex = require("../src/lib/vertex");
const { env } = require("../src/config/env");
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
  const models = policyFor("models");
  const policy = policyFor("reader");
  const calls = [];
  const router = createRouter({ models, deploymentModel: env.llm.model, call: traced("eval.reader.generateContent", (req) => vertex.generateContent(req)), embedCall: (req) => vertex.embed(req), onCall: (e) => calls.push(e) });
  console.log(`  agent ${models.routes["reader.agent"].primary} · sentinel ${models.routes["reader.sentinel"].primary} · guard ${models.routes["reader.guard"].primary} · embeddings ${models.embeddings.primary}`);
  console.log(`  tracing ${isTracingConfigured() ? "on (LangSmith)" : "off"}`);
  console.log("=".repeat(78));

  const results = [];
  const cosine = (a, b) => { let d = 0; let x = 0; let y = 0; for (let i = 0; i < a.length; i += 1) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return x && y ? d / Math.sqrt(x * y) : 0; };

  for (const row of queue) {
    const t0 = Date.now();
    let result = null;
    let error = null;
    try {
      const input = inputFor(row);
      const young = Boolean(AUDIENCES[input.audience]?.young);
      const extra = young && policy.safety.young.length ? { safetySettings: policy.safety.young } : {};
      /* The whole path a question takes: the guard, then the companion and the Sentinel. */
      const screened = await guard.screenQuestion({ question: input.question, audience: input.audience, storyTitle: input.storyTitle, generate: router.bound("reader.guard", extra) });
      if (screened.decision.route === "decline") {
        const w = await writeRefusal({ reasons: [screened.decision.declineReason], audience: input.audience, storyTitle: input.storyTitle, generate: router.bound("reader.refusal", extra) });
        result = { answer: null, check: null, attempts: 0, calls: [], usage: [], declinedBy: "guard", refusalText: w.text };
      } else {
        const items = [...input.blocks.map((b) => ({ id: b.id, text: b.text })), ...input.passages];
        let index = null;
        const search = async (q) => {
          if (!index) { const e = await router.embed(items.map((i) => i.text)); index = { model: e.model, vectors: e.vectors }; }
          const qv = (await router.embed([q], { taskType: "RETRIEVAL_QUERY", model: index.model })).vectors[0];
          return items.map((i, n) => ({ id: i.id, text: i.text, score: cosine(qv, index.vectors[n]) })).sort((a, b) => b.score - a.score).slice(0, policy.retrieval.topK);
        };
        result = await companion.answerQuestion({
          ...input, question: screened.masked, search,
          limits: { agent: policy.agent, sentinel: policy.sentinel },
          generate: router.bound("reader.agent", extra), judge: router.bound("reader.sentinel", extra), refusal: router.bound("reader.refusal", extra), refusalFallback: policy.messages.refusalFallback,
        });
      }
    } catch (e) {
      error = e;
    }
    const ms = Date.now() - t0;
    const score = scoreTurn(result, row);
    results.push({ id: row.id, audience: row.audience || "adults", question: row.question, expected: row.expect || null, ms, error: error ? error.message : null, score, answer: result?.answer?.text || null });
    console.log(
      `${row.id.padEnd(28)} ${error ? "ERROR " + error.message.slice(0, 60) : ""}` +
        (result
          ? `${(score.declared || (score.declinedBy ? "declined" : "refused")).padEnd(10)} want ${(row.expect?.grounding || "-").padEnd(10)} cited ${score.cited}  band ${score.bandFit} (${score.readingLevel || "-"}/${score.length || "-"})  ` +
            `${score.attempts} attempt${score.attempts === 1 ? "" : "s"}  ${score.words}w  ${score.calls} calls  ${score.tokens.input}/${score.tokens.output} tok  ${(ms / 1000).toFixed(1)}s`
          : ""),
    );
    if (result?.check?.reasons?.length) console.log(`    · sentinel: ${result.check.verdict} (${result.check.reasons.join(", ")}) — ${result.check.rationale}`);
    if (result?.rulings?.length > 1) console.log(`    · rounds: ${result.rulings.map((r) => r.verdict).join(" → ")}`);
    if (result?.refusalText) console.log(`    · refusal: ${result.refusalText}`);
    if (result?.answer) console.log(`    · ${result.answer.text.slice(0, 160)}${result.answer.text.length > 160 ? "…" : ""}`);
  }

  const summary = summarise(results.map((r) => r.score));
  console.log("\n" + "=".repeat(78));
  console.log(`means  grounding ${summary.means.grounding}  sentinel ${summary.means.sentinel}  cited ${summary.means.cited}  bandFit ${summary.means.bandFit}  firstTry ${summary.means.firstTry}  words ${summary.means.words}  calls ${summary.means.calls}`);
  const fell = calls.filter((c) => c.fallback && c.ok).length;
  console.log(`models ${[...new Set(calls.filter((c) => c.ok).map((c) => `${c.purpose}=${c.model}`))].join("  ")}${fell ? `  (${fell} fallbacks)` : ""}`);
  console.log(`floors grounding ≥ ${THRESHOLDS.grounding}  sentinel ≥ ${THRESHOLDS.sentinel}  cited ≥ ${THRESHOLDS.cited}  bandFit ≥ ${THRESHOLDS.bandFit}  firstTry ≥ ${THRESHOLDS.firstTry}`);
  const errored = results.filter((r) => r.error).length;
  if (errored) console.log(`errors ${errored} of ${results.length} row(s) did not produce an answer`);
  console.log(summary.pass && !errored ? "\nPASS" : `\nFAIL: ${[...summary.failures, ...(errored ? [`${errored} row(s) errored`] : [])].join("; ")}`);

  if (jsonOut) {
    fs.writeFileSync(path.resolve(jsonOut), JSON.stringify({ dataset: path.basename(datasetPath), agent: AGENT_VERSION, sentinel: SENTINEL_VERSION, evals: EVAL_VERSION, models: policyFor("models").routes, at: new Date().toISOString(), summary, results }, null, 2));
    console.log(`wrote ${jsonOut}`);
  }

  process.exit(summary.pass && !errored ? 0 : 1);
};

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
