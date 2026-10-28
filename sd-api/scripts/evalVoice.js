#!/usr/bin/env node
/**
 * Run the voice judge over labelled sentences and refuse to pass if it has
 * regressed.
 *
 *   npm run eval:voice                        # evals/voice.jsonl, real model, exit 1 on failure
 *   npm run eval:voice -- --dataset path.jsonl
 *   npm run eval:voice -- --json out.json
 *   LLM_PROVIDER=fake npm run eval:voice      # the test double, to check the harness itself
 *
 * ── What this gates ─────────────────────────────────────────────────────────
 * Each row is a paragraph, the voice it is written in, and what a careful
 * editor would say: does it speak as the scholar, and in the scholar's own
 * account does it refer to them. The rows are the sentences that broke the
 * word rules this judge replaced — the inclusive "we" of an article for
 * children, which refused whole drafts, and "we wanted to know whether",
 * which slipped through. Three scores against the floors in the evals
 * policy: `speaks` and `names` are the share of rows ruled as labelled, and
 * `quoted` is the share of rows with an expected sentence where the judge
 * quoted exactly that sentence.
 *
 * Paragraphs are judged in batches of the same voice and scholar, as the
 * drafter sends them. Needs Vertex configured. Touches no database.
 */

require("dotenv").config();

const fs = require("fs");
const path = require("path");

const vertex = require("../src/lib/vertex");
const { env } = require("../src/config/env");
const { createRouter } = require("../src/lib/modelRouter");
/* Every policy this run reads: the baseline, or a proposed change laid over
   it when started with `--policy <file>` (scripts/policy.js does that before
   it writes the change). */
const { readProposal, policyFor: policyUnder } = require("../src/lib/policyChange");
const proposal = readProposal(process.argv);
const policyFor = (name) => policyUnder(name, proposal);
const voiceJudge = require("../src/lib/agents/voiceJudge");

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const datasetPath = path.resolve(opt("--dataset", path.join(__dirname, "..", "evals", "voice.jsonl")));
const jsonOut = opt("--json", null);
const BATCH = 8;

const main = async () => {
  if (!vertex.isConfigured()) {
    console.error(`The model is not configured: ${vertex.describeMissingConfig()}`);
    process.exit(2);
  }
  const rows = fs.readFileSync(datasetPath, "utf8").split(/\r?\n/).filter((l) => l.trim()).map((l, i) => {
    const r = JSON.parse(l);
    if (!r.id || !["author", "about"].includes(r.voice) || !r.text || typeof r.speaks !== "boolean") throw new Error(`row ${i + 1} is missing id, voice, text or speaks`);
    return r;
  });
  const floors = policyFor("evals").voice;
  const calls = [];
  const router = createRouter({ models: policyFor("models"), deploymentModel: env.llm.model, call: (req) => vertex.generateContent(req), onCall: (e) => calls.push(e) });
  const generate = router.bound("drafting.voice");

  console.log("=".repeat(78));
  console.log(`VOICE EVALS · ${path.basename(datasetPath)} · ${rows.length} row(s) · judge ${voiceJudge.VOICE_JUDGE_VERSION}`);
  console.log("=".repeat(78));

  /* Same voice and scholar together, in batches, as the drafter sends them. */
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.voice}|${r.scholar || ""}`;
    groups.set(key, [...(groups.get(key) || []), r]);
  }
  const results = [];
  for (const group of groups.values()) {
    for (let at = 0; at < group.length; at += BATCH) {
      const batch = group.slice(at, at + BATCH);
      const t0 = Date.now();
      const judged = await voiceJudge.judgeVoice({ paragraphs: batch.map((r, k) => ({ index: k + 1, text: r.text })), voice: batch[0].voice, scholarName: batch[0].scholar || null, generate });
      const ms = Date.now() - t0;
      batch.forEach((r, k) => {
        const v = judged.verdicts?.get(k + 1) || null;
        const speaksOk = v ? v.speaksAsAuthor === r.speaks : false;
        const namesOk = typeof r.names === "boolean" ? (v ? v.namesAuthor === r.names : false) : null;
        const quotedOk = r.sentence ? Boolean(v && v.sentences.includes(r.sentence)) : null;
        results.push({ id: r.id, voice: r.voice, unchecked: !v, speaks: v?.speaksAsAuthor ?? null, names: v?.namesAuthor ?? null, speaksOk, namesOk, quotedOk, reason: v?.reason || "", ms });
        const marks = [speaksOk ? "ok" : "WRONG", namesOk === null ? "" : namesOk ? "ok" : "WRONG", quotedOk === null ? "" : quotedOk ? "ok" : "WRONG"];
        console.log(`${r.id.padEnd(28)} ${r.voice.padEnd(6)} speaks ${String(v?.speaksAsAuthor ?? "?").padEnd(5)} (want ${String(r.speaks).padEnd(5)}) ${marks[0].padEnd(5)}` +
          `${namesOk === null ? "" : ` names ${v?.namesAuthor} (want ${r.names}) ${marks[1]}`}${quotedOk === null ? "" : ` quote ${marks[2]}`}${v?.reason ? `  · ${v.reason}` : ""}`);
      });
    }
  }

  const share = (xs) => (xs.length ? +(xs.filter(Boolean).length / xs.length).toFixed(3) : 1);
  const scores = {
    speaks: share(results.map((r) => r.speaksOk)),
    names: share(results.filter((r) => r.namesOk !== null).map((r) => r.namesOk)),
    quoted: share(results.filter((r) => r.quotedOk !== null).map((r) => r.quotedOk)),
  };
  const failures = Object.entries(floors).filter(([k, floor]) => scores[k] < floor).map(([k, floor]) => `${k} ${scores[k]} < ${floor}`);
  const unchecked = results.filter((r) => r.unchecked).length;
  console.log("\n" + "=".repeat(78));
  console.log(`scores speaks ${scores.speaks}  names ${scores.names}  quoted ${scores.quoted}`);
  console.log(`floors ${Object.entries(floors).map(([k, v]) => `${k} ≥ ${v}`).join("  ")}`);
  console.log(`models ${[...new Set(calls.filter((c) => c.ok).map((c) => c.model))].join(", ")}  ·  ${calls.length} call(s)${unchecked ? `  ·  ${unchecked} row(s) unchecked` : ""}`);
  const pass = !failures.length && !unchecked;
  console.log(pass ? "\nPASS" : `\nFAIL: ${[...failures, ...(unchecked ? [`${unchecked} row(s) unchecked`] : [])].join("; ")}`);
  if (jsonOut) {
    fs.writeFileSync(path.resolve(jsonOut), JSON.stringify({ dataset: path.basename(datasetPath), judge: voiceJudge.VOICE_JUDGE_VERSION, route: policyFor("models").routes["drafting.voice"], at: new Date().toISOString(), scores, floors, results }, null, 2));
    console.log(`wrote ${jsonOut}`);
  }
  process.exit(pass ? 0 : 1);
};

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
