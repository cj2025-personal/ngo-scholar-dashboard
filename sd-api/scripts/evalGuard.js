#!/usr/bin/env node
/**
 * Run the source guard over labelled passages and refuse to pass if it has
 * regressed.
 *
 *   npm run eval:guard                        # evals/guard.jsonl, real model, exit 1 on failure
 *   npm run eval:guard -- --dataset path.jsonl
 *   npm run eval:guard -- --json out.json
 *   LLM_PROVIDER=fake npm run eval:guard      # the test double, to check the harness itself
 *
 * ── What this gates ─────────────────────────────────────────────────────────
 * Each row is a passage as a paper might carry it, and whether it addresses
 * whoever reads it rather than reporting the work. Half are the ordinary
 * text of a paper, including the ones that look like instructions and are
 * not: a method's instructions to participants, a prompt a paper studies
 * and quotes, a recommendation to practitioners. The other half are
 * directions to an assistant, disguised or plain. Two scores against the
 * floors in the evals policy: `caught`, the share of addressed passages set
 * aside, and `kept`, the share of ordinary passages kept. A guard that
 * sets aside a paper's method section is as broken as one that lets an
 * injected note through, so both have floors.
 *
 * Passages are screened in batches, as the service sends them, so a
 * passage is judged beside its neighbours. Needs Vertex configured.
 * Touches no database.
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
const guard = require("../src/lib/agents/sourceGuard");

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const datasetPath = path.resolve(opt("--dataset", path.join(__dirname, "..", "evals", "guard.jsonl")));
const jsonOut = opt("--json", null);

const main = async () => {
  if (!vertex.isConfigured()) {
    console.error(`The model is not configured: ${vertex.describeMissingConfig()}`);
    process.exit(2);
  }
  const rows = fs.readFileSync(datasetPath, "utf8").split(/\r?\n/).filter((l) => l.trim()).map((l, i) => {
    const r = JSON.parse(l);
    if (!r.id || !r.text || typeof r.setAside !== "boolean") throw new Error(`row ${i + 1} is missing id, text or setAside`);
    return r;
  });
  const floors = policyFor("evals").guard;
  const batch = policyFor("drafting").guard.batch;
  const calls = [];
  const router = createRouter({ models: policyFor("models"), deploymentModel: env.llm.model, call: (req) => vertex.generateContent(req), onCall: (e) => calls.push(e) });
  const generate = router.bound("drafting.guard");

  console.log("=".repeat(78));
  console.log(`SOURCE GUARD EVALS · ${path.basename(datasetPath)} · ${rows.length} row(s) · guard ${guard.GUARD_VERSION} · batches of ${batch}`);
  console.log("=".repeat(78));

  /* In id order, so addressed passages sit among ordinary ones as they would in a paper, and runs compare. */
  const order = [...rows].sort((a, b) => (a.id < b.id ? -1 : 1));
  const t0 = Date.now();
  let error = null;
  let setAside = [];
  try {
    ({ setAside } = await guard.screen({ passages: order.map((r) => ({ id: r.id, text: r.text })), title: "Evaluation passages", batch, generate }));
  } catch (e) {
    error = e.message;
  }
  const aside = new Map(setAside.map((s) => [s.id, s.reason]));
  const results = order.map((r) => ({ id: r.id, expected: r.setAside, got: aside.has(r.id), reason: aside.get(r.id) || null, ok: aside.has(r.id) === r.setAside }));
  for (const r of results) {
    console.log(`${r.ok ? "ok   " : "WRONG"} ${r.id.padEnd(32)} ${r.expected ? "set aside" : "kept     "} → ${r.got ? "set aside" : "kept"}${r.reason ? `  “${r.reason.slice(0, 90)}”` : ""}`);
  }
  if (error) console.log(`ERROR ${error}`);

  const addressed = results.filter((r) => r.expected);
  const ordinary = results.filter((r) => !r.expected);
  const share = (xs) => (xs.length ? Number((xs.filter((r) => r.ok).length / xs.length).toFixed(3)) : 0);
  const scores = { caught: share(addressed), kept: share(ordinary) };
  const failures = Object.entries(floors).filter(([k, floor]) => scores[k] < floor).map(([k, floor]) => `${k} ${scores[k]} < ${floor}`);
  const pass = !error && failures.length === 0;
  const tokens = calls.reduce((n, c) => n + (c.usage?.input || 0) + (c.usage?.output || 0), 0);
  console.log("=".repeat(78));
  console.log(`scores caught ${scores.caught}  kept ${scores.kept}`);
  console.log(`floors ${Object.entries(floors).map(([k, v]) => `${k} ≥ ${v}`).join("  ")}`);
  console.log(`models ${[...new Set(calls.map((c) => c.model))].join(", ") || "none"}  ·  ${calls.length} call(s)  ·  ${tokens.toLocaleString()} tokens  ·  ${Math.round((Date.now() - t0) / 1000)}s`);
  console.log(pass ? "PASS" : `FAIL: ${[...failures, ...(error ? [error] : [])].join("; ")}`);
  if (jsonOut) {
    fs.writeFileSync(path.resolve(jsonOut), JSON.stringify({ dataset: path.basename(datasetPath), guard: guard.GUARD_VERSION, route: policyFor("models").routes["drafting.guard"], at: new Date().toISOString(), scores, floors, results, error }, null, 2));
    console.log(`wrote ${jsonOut}`);
  }
  process.exit(pass ? 0 : 1);
};

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
