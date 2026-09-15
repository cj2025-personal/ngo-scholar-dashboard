#!/usr/bin/env node
/**
 * Run the drafter over the eval set and refuse to pass if it has regressed.
 *
 *   npm run eval:drafts                       # evals/drafts.jsonl, real model, exit 1 on failure
 *   npm run eval:drafts -- --limit 1          # first row only
 *   npm run eval:drafts -- --dataset path.jsonl
 *   npm run eval:drafts -- --langsmith        # also record the run as a LangSmith experiment
 *   npm run eval:drafts -- --json out.json    # write per-row scores for diffing
 *
 * ── What this gates ─────────────────────────────────────────────────────────
 * The four scores in `lib/draftEvals.js`, averaged over the set, against
 * their thresholds. A prompt, model or graph change that drops any of them
 * below the floor exits non-zero, and CI treats that as a failed build. That
 * is how the 4.3-grade drift never happens again: the measurement gates the
 * deploy rather than sitting unread in a field.
 *
 * ── Cost ────────────────────────────────────────────────────────────────────
 * Each row is a full draft: one outline call, one draft and one judge call
 * per section, with retries. Roughly 20 model calls and 20,000 tokens a row.
 * The set is small on purpose; it grows by capture, not by hand.
 *
 * Needs Vertex configured (the same variables the API uses). Touches no
 * database.
 */

require("dotenv").config();

const fs = require("fs");
const path = require("path");

const { runDraftGraph, GRAPH_VERSION } = require("../src/lib/draftGraph");
const composer = require("../src/lib/draftComposer");
const { THRESHOLDS, EVAL_VERSION, scoreDraft, summarise, validateRow, parseJsonl, inputFor } = require("../src/lib/draftEvals");
const { FIDELITY_VERSION } = require("../src/lib/fidelity");
const vertex = require("../src/lib/vertex");
const { traced, isTracingConfigured } = require("../src/lib/tracing");

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const datasetPath = path.resolve(opt("--dataset", path.join(__dirname, "..", "evals", "drafts.jsonl")));
const limit = Number(opt("--limit", Infinity)) || Infinity;
const jsonOut = opt("--json", null);
const useLangsmith = flag("--langsmith");

const main = async () => {
  if (!vertex.isConfigured()) {
    console.error(`Drafting is not configured: ${vertex.describeMissingConfig()}`);
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
  console.log(`DRAFT EVALS · ${path.basename(datasetPath)} · ${queue.length} row(s)`);
  console.log(`  graph ${GRAPH_VERSION} · prompt ${composer.PROMPT_VERSION} · judge ${FIDELITY_VERSION} · evals ${EVAL_VERSION}`);
  console.log(`  model ${vertex.resolveResourceName()}`);
  console.log(`  tracing ${isTracingConfigured() ? "on (LangSmith)" : "off"}`);
  console.log("=".repeat(78));

  const generate = traced("eval.generateContent", (req) => vertex.generateContent(req));
  const results = [];

  for (const row of queue) {
    const t0 = Date.now();
    let result = null;
    let error = null;
    try {
      result = await runDraftGraph(inputFor(row), { generate });
    } catch (e) {
      error = e;
    }
    const ms = Date.now() - t0;
    const score = result ? scoreDraft(result) : { entailment: 0, bandFit: 0, voiceViolations: 0, provenance: 0, anchoring: 0, reach: 0, extensionParagraphs: 0, words: 0, calls: 0, paragraphs: 0, tokens: { input: 0, output: 0 } };
    results.push({ id: row.id, audience: row.audience || composer.DEFAULT_AUDIENCE, ms, error: error ? error.message : null, score, title: result?.title || null, warnings: result?.warnings || [] });
    console.log(
      `${row.id.padEnd(30)} ${error ? "ERROR " + error.message.slice(0, 60) : ""}` +
        (result
          ? `entail ${score.entailment}  band ${score.bandFit} (FK ${score.fkGrade})  voice ${score.voiceViolations}  prov ${score.provenance}  ` +
            (score.extensionParagraphs ? `beyond ${score.extensionParagraphs}: anchor ${score.anchoring} reach ${score.reach}  ` : "") +
            `${score.words}w  ${score.calls} calls  ${score.tokens.input}/${score.tokens.output} tok  ${(ms / 1000).toFixed(1)}s`
          : ""),
    );
    for (const w of result?.warnings || []) console.log(`    · ${w}`);
  }

  const summary = summarise(results.map((r) => r.score));
  console.log("\n" + "=".repeat(78));
  console.log(`means  entailment ${summary.means.entailment}  bandFit ${summary.means.bandFit}  voice ${summary.means.voiceViolations}  provenance ${summary.means.provenance}  anchoring ${summary.means.anchoring}  reach ${summary.means.reach}  words ${summary.means.words}  calls ${summary.means.calls}`);
  console.log(`floors entailment ≥ ${THRESHOLDS.entailment}  bandFit ≥ ${THRESHOLDS.bandFit}  voice ≤ ${THRESHOLDS.voiceViolations}  provenance ≥ ${THRESHOLDS.provenance}  anchoring ≥ ${THRESHOLDS.anchoring}  reach ≥ ${THRESHOLDS.reach}`);
  const errored = results.filter((r) => r.error).length;
  if (errored) console.log(`errors ${errored} of ${results.length} row(s) did not produce a draft`);
  console.log(summary.pass && !errored ? "\nPASS" : `\nFAIL: ${[...summary.failures, ...(errored ? [`${errored} row(s) errored`] : [])].join("; ")}`);

  if (jsonOut) {
    fs.writeFileSync(path.resolve(jsonOut), JSON.stringify({ dataset: path.basename(datasetPath), graph: GRAPH_VERSION, prompt: composer.PROMPT_VERSION, judge: FIDELITY_VERSION, evals: EVAL_VERSION, model: vertex.resolveResourceName(), at: new Date().toISOString(), summary, results }, null, 2));
    console.log(`wrote ${jsonOut}`);
  }

  if (useLangsmith) await recordLangsmith({ rows: queue, results, summary });

  process.exit(summary.pass && !errored ? 0 : 1);
};

/**
 * Record the run as a LangSmith experiment, creating the dataset if needed.
 * Rows are keyed by id so re-running updates the same examples.
 */
async function recordLangsmith({ rows, results, summary }) {
  if (!isTracingConfigured()) {
    console.log("LangSmith not configured (LANGSMITH_API_KEY); skipping experiment record");
    return;
  }
  const { Client } = require("langsmith");
  const client = new Client();
  const datasetName = process.env.LANGSMITH_DRAFT_DATASET || "archivyn-drafts";
  let dataset;
  if (await client.hasDataset({ datasetName })) {
    dataset = await client.readDataset({ datasetName });
  } else {
    dataset = await client.createDataset(datasetName, { description: "Archivyn draft eval rows: prepared source text + audience → scored draft" });
  }
  const existing = new Map();
  for await (const ex of client.listExamples({ datasetId: dataset.id })) existing.set(ex.inputs?.id, ex);
  const fresh = rows.filter((r) => !existing.has(r.id));
  if (fresh.length) {
    await client.createExamples({
      datasetId: dataset.id,
      inputs: fresh.map((r) => ({ id: r.id, title: r.title, audience: r.audience || "general", text: r.text })),
      outputs: fresh.map(() => ({})),
    });
  }
  const projectName = `drafts-${GRAPH_VERSION}-${composer.PROMPT_VERSION}-${Date.now()}`;
  for (const r of results) {
    const ex = existing.get(r.id) || (await findExample(client, dataset.id, r.id));
    if (!ex) continue;
    for (const [key, value] of Object.entries({ entailment: r.score.entailment, bandFit: r.score.bandFit, voiceViolations: r.score.voiceViolations, provenance: r.score.provenance, anchoring: r.score.anchoring, reach: r.score.reach })) {
      await client.createFeedback(null, key, { score: value, sourceInfo: { project: projectName, graph: GRAPH_VERSION, prompt: composer.PROMPT_VERSION }, comment: r.error || undefined, feedbackSourceType: "model" }).catch(() => {});
    }
  }
  console.log(`LangSmith: dataset "${datasetName}" (${existing.size + fresh.length} examples) · experiment ${projectName} · set ${summary.pass ? "PASS" : "FAIL"}`);
}

async function findExample(client, datasetId, id) {
  for await (const ex of client.listExamples({ datasetId })) if (ex.inputs?.id === id) return ex;
  return null;
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
