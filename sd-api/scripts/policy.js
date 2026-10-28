#!/usr/bin/env node
/**
 * Change an agent policy at runtime, with the evals in front of it.
 *
 *   npm run policy -- show studio                       # baseline, the active override, and the history
 *   npm run policy -- check studio --file change.json   # run the evals the change can move; write nothing
 *   npm run policy -- set studio --file change.json --author "Name" --note "why"
 *   npm run policy -- revert studio                     # deactivate the newest version; the one before it is live again
 *
 * ── Why ─────────────────────────────────────────────────────────────────────
 * A policy is data, read from agent_policies over src/policies/defaults.json,
 * so a change to it never goes through the pull request whose evals gate a
 * change to the code. Left there, a route moved to a cheaper model or a limit
 * halved at midnight is live on every replica within the cache window, and
 * nothing has measured what it did to the agents. This script is the gate
 * for that path: `set` runs every eval the policy can move, with the change
 * laid over the baseline exactly as production will read it, and inserts the
 * row only when each passes. The row carries the evals' scores, so the
 * history says not only who changed what and why, but what it measured.
 *
 * `change.json` holds the override only — the keys to change, nested as in
 * defaults.json — not a whole policy. A key the baseline does not have is
 * refused, because a misspelt key merges in silently and changes nothing
 * while the operator believes it did. A new route or model limit is allowed,
 * since the router reads those by name.
 *
 * `revert` runs no evals: it returns to a version that passed them.
 *
 * Needs the database (.env) and, for `check` and `set`, model credentials.
 */

require("dotenv").config();

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { getDb, COLLECTIONS, closeMongo } = require("../src/db/mongo");
const { defaultsFor, merge } = require("../src/lib/policyDefaults");
const { EVALS, unknownPaths, evalsFor } = require("../src/lib/policyChange");

const args = process.argv.slice(2);
const command = args[0];
const name = args[1];
const opt = (flag, fallback = null) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

function usage(message) {
  if (message) console.error(`\n${message}\n`);
  console.error("usage: policy.js show|check|set|revert <name> [--file change.json] [--author who] [--note why]");
  process.exit(2);
}

function readChange() {
  const file = opt("--file");
  if (!file) usage("--file change.json is required.");
  let change;
  try { change = JSON.parse(fs.readFileSync(path.resolve(file), "utf8")); } catch (error) { usage(`${file}: ${error.message}`); }
  if (!change || typeof change !== "object" || Array.isArray(change)) usage(`${file} must hold an object: the keys to change, nested as in defaults.json.`);
  const unknown = unknownPaths(name, change);
  if (unknown.length) usage(`${name} has no such key${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}. Nothing written.`);
  return change;
}

/** The newest active override for the policy, merged as production reads it. */
async function activeRow(db) {
  return db.collection(COLLECTIONS.agentPolicies).find({ name, active: true }).sort({ version: -1 }).limit(1).next();
}

/**
 * Run one eval with the proposed policy laid over the baseline. The eval
 * script reads the proposal through `--policy`, writes its scores through
 * `--json`, and exits 1 when a score is under its floor.
 */
function runEval(key, proposal, dir) {
  const spec = EVALS[key];
  const proposalFile = path.join(dir, "proposal.json");
  const out = path.join(dir, `${key}.json`);
  fs.writeFileSync(proposalFile, JSON.stringify(proposal));
  const t0 = Date.now();
  console.log(`\n── ${key} · ${spec.script} ──`);
  const r = spawnSync(process.execPath, [path.join(__dirname, "..", spec.script), "--policy", proposalFile, "--json", out], { stdio: "inherit", cwd: path.join(__dirname, "..") });
  const seconds = Math.round((Date.now() - t0) / 1000);
  let result = null;
  try { result = JSON.parse(fs.readFileSync(out, "utf8")); } catch { /* the eval did not get as far as writing */ }
  const passed = r.status === 0;
  return { eval: key, passed, status: r.status, seconds, scores: result?.scores || result?.summary || null, floors: result?.floors || null, dataset: result?.dataset || null, at: new Date().toISOString() };
}

function runEvals(change) {
  const keys = evalsFor(name, change);
  if (!keys.length) {
    console.log(`No eval reads the ${name} policy; nothing to measure.`);
    return [];
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "policy-"));
  const proposal = { [name]: change };
  const runs = keys.map((k) => runEval(k, proposal, dir));
  console.log(`\n${"=".repeat(78)}`);
  for (const run of runs) {
    const scores = run.scores ? Object.entries(run.scores).filter(([, v]) => typeof v === "number").map(([k, v]) => `${k} ${v}`).join("  ") : "(no scores written)";
    console.log(`${run.passed ? "PASS" : "FAIL"}  ${run.eval.padEnd(9)} ${scores}  ${run.seconds}s`);
  }
  return runs;
}

async function show(db) {
  const base = defaultsFor(name);
  const rows = await db.collection(COLLECTIONS.agentPolicies).find({ name }).sort({ version: -1 }).toArray();
  const active = rows.find((r) => r.active) || null;
  console.log(`${name} · baseline from src/policies/defaults.json${active ? ` · version ${active.version} active` : " · no override"}`);
  console.log(JSON.stringify(active ? merge(base, active.value || {}) : base, null, 2));
  if (active) { console.log("\noverride:"); console.log(JSON.stringify(active.value, null, 2)); }
  if (rows.length) {
    console.log("\nhistory:");
    for (const r of rows) {
      const evals = (r.evals || []).map((e) => `${e.eval} ${e.passed ? "pass" : "fail"}`).join(", ");
      console.log(`  v${r.version} ${r.active ? "active " : "revoked"} ${r.created_at?.toISOString?.() || ""} ${r.created_by || ""}${r.note ? ` — ${r.note}` : ""}${evals ? ` [${evals}]` : " [no evals recorded]"}`);
    }
  }
}

async function set(db, { write }) {
  const change = readChange();
  const author = opt("--author");
  const note = opt("--note", "");
  if (write && !author) usage("--author is required for set: the history says who changed it.");
  if (write && !note) usage("--note is required for set: the history says why.");
  const runs = runEvals(change);
  const failed = runs.filter((r) => !r.passed);
  if (failed.length) {
    console.log(`\nREFUSED: ${failed.map((r) => r.eval).join(", ")} under the floor with this change. Nothing written.`);
    return 1;
  }
  if (!write) {
    console.log(`\nOK: every eval passes with this change to ${name}. Not written (check).`);
    return 0;
  }
  const coll = db.collection(COLLECTIONS.agentPolicies);
  const last = await coll.find({ name }).sort({ version: -1 }).limit(1).next();
  const version = (last?.version || 0) + 1;
  await coll.insertOne({ name, version, value: change, active: true, created_at: new Date(), created_by: author, note, evals: runs });
  console.log(`\nWRITTEN: ${name} version ${version}, live on every replica within ${defaultsFor("policy").cacheSeconds}s.`);
  return 0;
}

async function revert(db) {
  const coll = db.collection(COLLECTIONS.agentPolicies);
  const active = await activeRow(db);
  if (!active) { console.log(`${name} has no active override; the baseline is live.`); return 0; }
  const by = opt("--author", os.userInfo().username);
  await coll.updateOne({ _id: active._id }, { $set: { active: false, reverted_at: new Date(), reverted_by: by } });
  const now = await activeRow(db);
  console.log(`REVERTED: ${name} version ${active.version}. ${now ? `Version ${now.version} is live again` : "The baseline is live again"} within ${defaultsFor("policy").cacheSeconds}s.`);
  return 0;
}

(async () => {
  if (!["show", "check", "set", "revert"].includes(command) || !name) usage();
  try { defaultsFor(name); } catch (error) { usage(error.message); }
  const db = await getDb();
  let code = 0;
  try {
    if (command === "show") await show(db);
    else if (command === "check") code = await set(db, { write: false });
    else if (command === "set") code = await set(db, { write: true });
    else code = await revert(db);
  } finally {
    await closeMongo();
  }
  process.exit(code);
})().catch((error) => {
  console.error(error);
  process.exit(2);
});
