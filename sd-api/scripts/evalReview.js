#!/usr/bin/env node
/**
 * Run the article reviewer over labelled articles and refuse to pass if it
 * has regressed.
 *
 *   npm run eval:review                       # evals/review.jsonl, real model, exit 1 on failure
 *   npm run eval:review -- --json out.json
 *   LLM_PROVIDER=fake npm run eval:review     # the test double, to check the harness itself
 *
 * ── What this gates ─────────────────────────────────────────────────────────
 * Each row is a short article over one fixed paper, with what a careful
 * editor would say: which headings promise what neither the article nor the
 * paper says — the "Cancer Treatment and Protein Folding" heading that
 * started this, and the honest ones the word rules once removed — and which
 * pronoun stands for the scholar in which paragraph, which a counter of "he"
 * and "she" cannot tell from a colleague the paper names. Two scores against
 * the floors in the evals policy: `headings`, the share of headings ruled as
 * labelled; `pronouns`, the share of rows whose consistency is ruled as
 * labelled.
 *
 * Needs Vertex configured. Touches no database.
 */

require("dotenv").config();

const fs = require("fs");
const path = require("path");

const vertex = require("../src/lib/vertex");
const { env } = require("../src/config/env");
const { createRouter } = require("../src/lib/modelRouter");
const { defaultsFor } = require("../src/lib/policyDefaults");
const reviewer = require("../src/lib/agents/articleReviewer");
const checks = require("../src/lib/checks");

const PASSAGES = [
  { id: "p1", text: "The array improved the signal-to-noise ratio by eleven decibels with one interferer." },
  { id: "p2", text: "Performance degrades when more than four interferers are present in a crowded band." },
  { id: "p3", text: "Four patch elements were spaced at half a wavelength, and the weights were updated every two milliseconds." },
];

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const datasetPath = path.resolve(opt("--dataset", path.join(__dirname, "..", "evals", "review.jsonl")));
const jsonOut = opt("--json", null);

const main = async () => {
  if (!vertex.isConfigured()) {
    console.error(`The model is not configured: ${vertex.describeMissingConfig()}`);
    process.exit(2);
  }
  const rows = fs.readFileSync(datasetPath, "utf8").split(/\r?\n/).filter((l) => l.trim()).map((l, i) => {
    const r = JSON.parse(l);
    if (!r.id || !Array.isArray(r.blocks) || !r.blocks.length) throw new Error(`row ${i + 1} is missing id or blocks`);
    return r;
  });
  const floors = defaultsFor("evals").review;
  const calls = [];
  const router = createRouter({ models: defaultsFor("models"), deploymentModel: env.llm.model, call: (req) => vertex.generateContent(req), onCall: (e) => calls.push(e) });
  const generate = router.bound("drafting.review");

  console.log("=".repeat(78));
  console.log(`REVIEW EVALS · ${path.basename(datasetPath)} · ${rows.length} row(s) · reviewer ${reviewer.REVIEW_VERSION}`);
  console.log("=".repeat(78));

  const headingResults = [];
  const pronounResults = [];
  const results = [];
  for (const row of rows) {
    const blocks = row.blocks.map(([type, text]) => ({ type: type === "heading" ? "subheading" : type, text, html: text }));
    const t0 = Date.now();
    const r = await reviewer.reviewArticle({ title: row.title || null, blocks, passages: PASSAGES, voice: row.voice || "author", scholarName: row.scholar || null, generate });
    const ms = Date.now() - t0;
    const marks = [];
    for (const [id, want] of Object.entries(row.headings || {})) {
      const got = r.unchecked ? null : r.headings.find((h) => h.id === id)?.promisesUnsaid ?? null;
      const ok = got === want;
      headingResults.push(ok);
      marks.push(`${id} ${got === null ? "?" : got ? "unsaid" : "fine"}${ok ? "" : ` (want ${want ? "unsaid" : "fine"}) WRONG`}`);
    }
    if ("consistent" in row) {
      const consistency = checks.authorPronouns({ review: r });
      const ok = !r.unchecked && consistency.ok === row.consistent;
      pronounResults.push(ok);
      marks.push(`pronouns ${r.unchecked ? "?" : consistency.ok}${ok ? "" : ` (want ${row.consistent}) WRONG`} [${r.pronouns.map((p) => `B${p.index}:${p.pronoun}`).join(" ")}]`);
    }
    results.push({ id: row.id, ms, unchecked: r.unchecked, headings: r.headings, pronouns: r.pronouns, rhythm: r.rhythm });
    console.log(`${row.id.padEnd(30)} ${marks.join("  ")}  ${(ms / 1000).toFixed(1)}s`);
    for (const h of r.headings.filter((x) => x.promisesUnsaid)) console.log(`    · ${h.id}: ${h.unsaid}`);
  }

  const share = (xs) => (xs.length ? +(xs.filter(Boolean).length / xs.length).toFixed(3) : 1);
  const scores = { headings: share(headingResults), pronouns: share(pronounResults) };
  const failures = Object.entries(floors).filter(([k, floor]) => scores[k] < floor).map(([k, floor]) => `${k} ${scores[k]} < ${floor}`);
  const unchecked = results.filter((r) => r.unchecked).length;
  console.log("\n" + "=".repeat(78));
  console.log(`scores headings ${scores.headings}  pronouns ${scores.pronouns}`);
  console.log(`floors ${Object.entries(floors).map(([k, v]) => `${k} ≥ ${v}`).join("  ")}`);
  console.log(`models ${[...new Set(calls.filter((c) => c.ok).map((c) => c.model))].join(", ")}  ·  ${calls.length} call(s)${unchecked ? `  ·  ${unchecked} row(s) unchecked` : ""}`);
  const pass = !failures.length && !unchecked;
  console.log(pass ? "\nPASS" : `\nFAIL: ${[...failures, ...(unchecked ? [`${unchecked} row(s) unchecked`] : [])].join("; ")}`);
  if (jsonOut) {
    fs.writeFileSync(path.resolve(jsonOut), JSON.stringify({ dataset: path.basename(datasetPath), reviewer: reviewer.REVIEW_VERSION, route: defaultsFor("models").routes["drafting.review"], at: new Date().toISOString(), scores, floors, results }, null, 2));
    console.log(`wrote ${jsonOut}`);
  }
  process.exit(pass ? 0 : 1);
};

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
