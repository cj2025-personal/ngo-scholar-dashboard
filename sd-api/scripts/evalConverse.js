#!/usr/bin/env node
/**
 * Run the studio's conversation agent over labelled conversations and refuse
 * to pass if it has regressed.
 *
 *   npm run eval:converse                     # evals/converse.jsonl, real model, exit 1 on failure
 *   npm run eval:converse -- --json out.json
 *   LLM_PROVIDER=fake npm run eval:converse   # the test double, to check the harness itself
 *
 * ── What this gates ─────────────────────────────────────────────────────────
 * Each row is what a scholar said (and tapped), what the page has set, and
 * what the page needs back: the action, and where it matters the paper, the
 * reader and words the brief must keep. Two scores against the floors in the
 * evals policy: `action`, the share of rows where the agent chose an
 * expected action; `fields`, the share of the paper, reader, brief and reply
 * expectations met. The rows come from walking the real agent through the
 * conversations the composer's browser specs drive, plus the ones a scholar
 * types that no button covers: approving in words, asking it to publish,
 * asking who it is — Kivyn, a program, never a person.
 *
 * Papers are two fixed titles, so rows name them by key. Needs Vertex
 * configured. Touches no database.
 */

require("dotenv").config();

const fs = require("fs");
const path = require("path");

const vertex = require("../src/lib/vertex");
const { env } = require("../src/config/env");
const { createRouter } = require("../src/lib/modelRouter");
const { defaultsFor } = require("../src/lib/policyDefaults");
const converse = require("../src/lib/agents/studioConverse");

const PAPERS = [
  { key: "harvested:spectral", title: "Spectral Domain Sparse Representation for DOA Estimation of Signals with Large Dynamic Range", year: 2021 },
  { key: "harvested:bartlett", title: "Application of Sparse Representation to Bartlett Spectra for Improved Direction of Arrival Estimation", year: 2019 },
];

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const datasetPath = path.resolve(opt("--dataset", path.join(__dirname, "..", "evals", "converse.jsonl")));
const jsonOut = opt("--json", null);

const main = async () => {
  if (!vertex.isConfigured()) {
    console.error(`The model is not configured: ${vertex.describeMissingConfig()}`);
    process.exit(2);
  }
  const rows = fs.readFileSync(datasetPath, "utf8").split(/\r?\n/).filter((l) => l.trim()).map((l, i) => {
    const r = JSON.parse(l);
    if (!r.id || !Array.isArray(r.said) || !r.said.length || !r.expect?.action) throw new Error(`row ${i + 1} is missing id, said or expect.action`);
    return r;
  });
  const floors = defaultsFor("evals").converse;
  const calls = [];
  const router = createRouter({ models: defaultsFor("models"), deploymentModel: env.llm.model, call: (req) => vertex.generateContent(req), onCall: (e) => calls.push(e) });
  const generate = router.bound("studio.converse");

  console.log("=".repeat(78));
  console.log(`CONVERSE EVALS · ${path.basename(datasetPath)} · ${rows.length} row(s) · agent ${converse.CONVERSE_VERSION}`);
  console.log("=".repeat(78));

  const results = [];
  for (const row of rows) {
    /* What the scholar said, with a neutral agent turn between, as the page sends the thread. */
    const messages = row.said.flatMap((text, i) => (i < row.said.length - 1 ? [{ role: "scholar", text }, { role: "agent", text: "(the agent answered)" }] : [{ role: "scholar", text }]));
    const t0 = Date.now();
    let d = null;
    let error = null;
    try {
      d = (await converse.decide({ messages, papers: PAPERS, audiences: converse.AUDIENCE_LIST, voices: converse.VOICES, state: row.state || {}, scholarName: "Inder Gupta", generate })).decision;
    } catch (e) {
      error = e.message;
    }
    const ms = Date.now() - t0;
    const e = row.expect;
    const actionOk = Boolean(d && e.action.includes(d.action));
    const fields = [];
    if ("paper" in e) fields.push(["paper", d?.paperKey === e.paper || (!d?.paperKey && row.state?.paperKey === e.paper)]);
    if ("audience" in e) fields.push(["audience", e.audience.includes(d?.audience ?? null)]);
    for (const w of e.briefHas || []) fields.push([`brief~${w}`, new RegExp(w, "i").test(d?.brief || "")]);
    for (const w of e.replyHas || []) fields.push([`reply~${w}`, new RegExp(w, "i").test(d?.reply || "")]);
    for (const w of e.replyLacks || []) fields.push([`reply!~${w}`, !new RegExp(w, "i").test(d?.reply || "")]);
    results.push({ id: row.id, ms, error, actionOk, fields, decision: d });
    const miss = fields.filter(([, ok]) => !ok).map(([k]) => k);
    console.log(`${row.id.padEnd(24)} ${(d?.action || "ERROR").padEnd(13)} ${actionOk ? "ok   " : "WRONG"} ${miss.length ? `missed ${miss.join(", ")}` : ""}  ${(ms / 1000).toFixed(1)}s${error ? `  ${error}` : ""}`);
    if (d?.reply) console.log(`    “${d.reply.slice(0, 150)}”`);
  }

  const share = (xs) => (xs.length ? +(xs.filter(Boolean).length / xs.length).toFixed(3) : 1);
  const scores = { action: share(results.map((r) => r.actionOk)), fields: share(results.flatMap((r) => r.fields.map(([, ok]) => ok))) };
  const failures = Object.entries(floors).filter(([k, floor]) => scores[k] < floor).map(([k, floor]) => `${k} ${scores[k]} < ${floor}`);
  const errored = results.filter((r) => r.error).length;
  console.log("\n" + "=".repeat(78));
  console.log(`scores action ${scores.action}  fields ${scores.fields}`);
  console.log(`floors ${Object.entries(floors).map(([k, v]) => `${k} ≥ ${v}`).join("  ")}`);
  console.log(`models ${[...new Set(calls.filter((c) => c.ok).map((c) => c.model))].join(", ")}  ·  ${calls.length} call(s)${calls.some((c) => c.fallback && c.ok) ? "  ·  fallbacks used" : ""}`);
  const pass = !failures.length && !errored;
  console.log(pass ? "\nPASS" : `\nFAIL: ${[...failures, ...(errored ? [`${errored} row(s) errored`] : [])].join("; ")}`);
  if (jsonOut) {
    fs.writeFileSync(path.resolve(jsonOut), JSON.stringify({ dataset: path.basename(datasetPath), agent: converse.CONVERSE_VERSION, route: defaultsFor("models").routes["studio.converse"], at: new Date().toISOString(), scores, floors, results }, null, 2));
    console.log(`wrote ${jsonOut}`);
  }
  process.exit(pass ? 0 : 1);
};

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
