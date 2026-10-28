#!/usr/bin/env node
/**
 * Run the story agent — Kivyn editing a draft by instruction — over labelled
 * instructions on a fixed draft, and refuse to pass if it has regressed.
 *
 *   npm run eval:edit                        # evals/edit.jsonl, real model, exit 1 on failure
 *   npm run eval:edit -- --only shorten-paragraph
 *   npm run eval:edit -- --json out.json
 *   LLM_PROVIDER=fake npm run eval:edit      # the test double, to check the harness itself
 *
 * ── What this gates ─────────────────────────────────────────────────────────
 * Each row is a draft and the passages of its paper (evals/edit.fixtures.json),
 * an instruction a scholar might type, and what must be true of the proposal
 * that comes back: which blocks may change, what the changed text must say or
 * cite, what must appear nowhere, and what the agent must own up to in
 * `finish`. Four scores against the floors in the evals policy:
 *
 *   finished   the loop ended by the agent's own `finish` (or a plain answer),
 *              not the step cap, and nothing threw
 *   scope      nothing changed that the row did not allow: the blocks touched,
 *              the blocks added, moves, the heading fields
 *   asked      every expectation the row states was met
 *   supported  of the paragraphs the agent wrote from the paper, the share the
 *              fidelity judge found supported by the passages they cite
 *
 * The loop runs as in production: the edit route's model, the voice judge on
 * its own route reading every write before it lands, the reducer refusing
 * what it can. Search is by word overlap here, so the tool answers without a
 * database; the fidelity judge runs afterwards on the edit route's model, as
 * the service does. Needs Vertex configured. Touches no database.
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
const agent = require("../src/lib/storyAgent");
const fidelity = require("../src/lib/fidelity");
const composer = require("../src/lib/draftComposer");

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const datasetPath = path.resolve(opt("--dataset", path.join(__dirname, "..", "evals", "edit.jsonl")));
const fixturesPath = path.resolve(opt("--fixtures", path.join(__dirname, "..", "evals", "edit.fixtures.json")));
const only = opt("--only", null);
const jsonOut = opt("--json", null);

/* ── what a row may expect ────────────────────────────────────────────────── */

const re = (s) => new RegExp(s, "i");
const words = (t) => String(t || "").split(/\s+/).filter(Boolean).length;

/**
 * The changes, against what the row allows. A change outside the allowance
 * is named.
 */
function scopeMisses(expect, changes) {
  const touched = new Set(expect.touched || []);
  const fields = new Set(expect.fields || []);
  const adds = Number.isInteger(expect.adds) ? expect.adds : 0;
  const misses = [];
  let added = 0;
  for (const c of changes) {
    if (c.kind === "changed" || c.kind === "removed") { if (!touched.has(c.index)) misses.push(`${c.kind} block ${c.index}`); }
    else if (c.kind === "added") { added += 1; if (added > adds) misses.push(`added block ${c.index}`); }
    else if (c.kind === "moved") { if (!expect.moves) misses.push(`moved block ${c.from} to ${c.index}`); }
    else if (c.kind === "field") { if (!fields.has(c.field)) misses.push(`changed ${c.field}`); }
  }
  if (expect.unchanged && changes.length) misses.push("something changed");
  return misses;
}

/** The row's own expectations, each named when missed. */
function askedMisses(expect, { before, after, changes, summary, calls }) {
  const misses = [];
  const text = (b) => (b.type === "image" ? b.caption || b.pending?.description || "" : agent.plain(b.html));
  const written = after.blocks.filter((b) => b.changed && b.type !== "image");
  const writtenText = written.map(text).join("\n");
  /* What the agent wrote, and the heading fields: an untouched block cannot
     have gained a word, and the fixture's own prose is not under test. */
  const everything = [after.title, after.subtitle, after.excerpt, writtenText].join("\n");
  for (const t of expect.tools || []) if (!calls.some((c) => c.name === t && /^ok/.test(String(c.result)))) misses.push(`tool ${t}`);
  for (const s of expect.has || []) if (!re(s).test(writtenText)) misses.push(`has ${s}`);
  for (const s of expect.lacks || []) if (re(s).test(everything)) misses.push(`lacks ${s}`);
  for (const id of expect.cites || []) if (!written.some((b) => (b.sourceRefs || []).some((r) => r.passageId === id))) misses.push(`cites ${id}`);
  if (expect.shorter) {
    const was = before.blocks[expect.shorter - 1];
    const now = after.blocks.find((b) => b.key === was?.key);
    if (!was || !now || words(agent.plain(now.html)) >= words(agent.plain(was.html))) misses.push(`shorter ${expect.shorter}`);
  }
  if (Number.isInteger(expect.count) && after.blocks.length !== expect.count) misses.push(`count ${after.blocks.length} ≠ ${expect.count}`);
  if (expect.title && !re(expect.title).test(after.title)) misses.push("title");
  if (expect.subtitle && !re(expect.subtitle).test(after.subtitle)) misses.push("subtitle");
  if (expect.ownView && !written.some((b) => b.ownView)) misses.push("ownView");
  if (expect.quote && !after.blocks.some((b) => b.changed && b.type === "quote")) misses.push("quote");
  if (expect.imageAt && !(after.blocks[expect.imageAt - 1]?.type === "image" && after.blocks[expect.imageAt - 1]?.pending)) misses.push(`imageAt ${expect.imageAt}`);
  if (expect.before) {
    const at = after.blocks.findIndex((b) => re(expect.before.text).test(text(b)));
    if (at < 0 || at + 1 > expect.before.index) misses.push(`before ${expect.before.index}`);
  }
  for (const s of expect.summaryHas || []) if (!re(s).test(summary)) misses.push(`summary~${s}`);
  for (const s of expect.summaryLacks || []) if (re(s).test(summary)) misses.push(`summary!~${s}`);
  return misses;
}

/* ── the run ──────────────────────────────────────────────────────────────── */

const main = async () => {
  if (!vertex.isConfigured()) {
    console.error(`The model is not configured: ${vertex.describeMissingConfig()}`);
    process.exit(2);
  }
  const fixtures = JSON.parse(fs.readFileSync(fixturesPath, "utf8"));
  const rows = fs.readFileSync(datasetPath, "utf8").split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#")).map((l, i) => {
    const r = JSON.parse(l);
    if (!r.id || !r.instruction || !fixtures[r.fixture] || !r.expect) throw new Error(`row ${i + 1} is missing id, instruction, a known fixture or expect`);
    return r;
  }).filter((r) => !only || r.id === only);
  if (!rows.length) throw new Error(only ? `no row is called ${only}` : "no rows");

  const floors = policyFor("evals").edit;
  const limits = policyFor("studio").edit;
  const calls = [];
  const router = createRouter({ models: policyFor("models"), deploymentModel: env.llm.model, call: (req) => vertex.generateContent(req), onCall: (e) => calls.push(e) });
  const generate = router.bound("studio.edit");
  const judgeVoice = router.bound("drafting.voice");

  console.log("=".repeat(78));
  console.log(`EDIT EVALS · ${path.basename(datasetPath)} · ${rows.length} row(s) · agent ${agent.AGENT_VERSION} · judge ${fidelity.FIDELITY_VERSION}`);
  console.log("=".repeat(78));

  const results = [];
  for (const row of rows) {
    const fx = fixtures[row.fixture];
    const passages = fx.passages;
    const byId = new Map(passages.map((p) => [p.id, p]));
    const isVerbatim = (t, id) => byId.has(id) && composer.isVerbatim(t, byId.get(id).text);
    /* By word overlap: enough for the tool to say whether the paper mentions a thing. */
    const search = async (q) => {
      const asked = new Set(String(q).toLowerCase().split(/\W+/).filter((w) => w.length > 3));
      if (!asked.size) return [];
      return passages
        .map((p) => ({ id: p.id, text: p.text, score: new Set(p.text.toLowerCase().split(/\W+/).filter((w) => asked.has(w))).size / asked.size }))
        .filter((h) => h.score > 0).sort((a, b) => b.score - a.score).slice(0, limits.searchTopK);
    };
    const before = agent.stateFromStory(fx.story);
    const t0 = Date.now();
    let r = null;
    let error = null;
    try {
      r = await agent.runStoryAgent({
        state: before, passages, instruction: row.instruction, audience: row.audience || fx.audience, voice: row.voice || fx.voice, scholarName: row.scholar || fx.scholarName,
        generate, judgeVoice, imagesAllowed: true, isVerbatim, search, limits,
      });
    } catch (e) {
      error = e.message;
    }
    const ms = Date.now() - t0;
    const finished = Boolean(r) && !/^Stopped after the maximum/.test(r.summary);
    const scope = r ? scopeMisses(row.expect, r.changes) : ["errored"];
    const asked = r ? askedMisses(row.expect, { before, after: r.state, changes: r.changes, summary: r.summary, calls: r.calls }) : ["errored"];
    /* What the agent wrote from the paper, read by the fact-checker. */
    let supported = null;
    if (r) {
      const written = r.state.blocks.filter((b) => b.changed && b.type === "paragraph" && !b.ownView && !b.extension && b.sourceRefs?.length);
      if (written.length) {
        const judged = await fidelity.judgeSection({ blocks: written, passages, generate: router.bound("drafting.fidelity") });
        supported = { ok: judged.blocks.filter((b) => b.fidelity?.verdict === fidelity.VERDICT.SUPPORTED).length, of: judged.blocks.length, claims: judged.blocks.flatMap((b) => b.fidelity?.unsupportedClaims || []) };
      }
    }
    results.push({ id: row.id, ms, error, finished, scope, asked, supported, tools: r ? r.calls.map((c) => `${c.name}${/^refused/.test(String(c.result)) ? "✗" : ""}`) : [], changes: r?.changes || [], summary: r?.summary || null });
    const mark = (xs) => (xs.length ? "WRONG" : "ok   ");
    console.log(`${row.id.padEnd(32)} ${finished ? "finished" : "STOPPED "} scope ${mark(scope)} asked ${mark(asked)}${supported ? ` supported ${supported.ok}/${supported.of}` : ""}  ${(ms / 1000).toFixed(1)}s${error ? `  ${error}` : ""}`);
    console.log(`    tools: ${results[results.length - 1].tools.join(" → ") || "(none)"}`);
    if (scope.length || asked.length) console.log(`    missed: ${[...scope, ...asked].join(", ")}`);
    if (supported?.claims.length) console.log(`    unsupported: ${supported.claims.map((c) => `“${c}”`).join("; ")}`);
    if (r?.summary) console.log(`    “${r.summary.slice(0, 160)}”`);
  }

  const share = (xs) => (xs.length ? +(xs.filter(Boolean).length / xs.length).toFixed(3) : 1);
  const judged = results.filter((x) => x.supported);
  const scores = {
    finished: share(results.map((x) => x.finished)),
    scope: share(results.map((x) => !x.scope.length)),
    asked: share(results.map((x) => !x.asked.length)),
    supported: judged.length ? +(judged.reduce((n, x) => n + x.supported.ok, 0) / judged.reduce((n, x) => n + x.supported.of, 0)).toFixed(3) : 1,
  };
  const failures = Object.entries(floors).filter(([k, floor]) => scores[k] < floor).map(([k, floor]) => `${k} ${scores[k]} < ${floor}`);
  const errored = results.filter((x) => x.error).length;
  console.log("\n" + "=".repeat(78));
  console.log(`scores finished ${scores.finished}  scope ${scores.scope}  asked ${scores.asked}  supported ${scores.supported}`);
  console.log(`floors ${Object.entries(floors).map(([k, v]) => `${k} ≥ ${v}`).join("  ")}`);
  const tokens = calls.reduce((n, c) => n + (c.usage?.input || 0) + (c.usage?.output || 0), 0);
  console.log(`models ${[...new Set(calls.filter((c) => c.ok).map((c) => c.model))].join(", ")}  ·  ${calls.length} call(s)  ·  ${tokens.toLocaleString()} tokens${calls.some((c) => c.fallback && c.ok) ? "  ·  fallbacks used" : ""}`);
  const pass = !failures.length && !errored;
  console.log(pass ? "\nPASS" : `\nFAIL: ${[...failures, ...(errored ? [`${errored} row(s) errored`] : [])].join("; ")}`);
  if (jsonOut) {
    fs.writeFileSync(path.resolve(jsonOut), JSON.stringify({ dataset: path.basename(datasetPath), agent: agent.AGENT_VERSION, judge: fidelity.FIDELITY_VERSION, route: policyFor("models").routes["studio.edit"], at: new Date().toISOString(), scores, floors, results }, null, 2));
    console.log(`wrote ${jsonOut}`);
  }
  process.exit(pass ? 0 : 1);
};

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
