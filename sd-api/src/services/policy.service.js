"use strict";

/**
 * Agent policies: the limits, models and thresholds every agent works to,
 * as data rather than constants.
 *
 * ── Where a value comes from ────────────────────────────────────────────────
 *   1. src/policies/defaults.json — the baseline, reviewed like code.
 *   2. agent_policies — the active (highest) version of a named policy,
 *      deep-merged over the baseline. Set at runtime with an author and a
 *      note (scripts/policy.js); a change takes effect within the cache
 *      window, on every replica, with no deploy.
 *
 * The code never reads a limit from anywhere else. A policy that cannot be
 * read from the database falls back to the baseline and says so once, so a
 * database outage degrades to the reviewed defaults, not to an error.
 */

const { COLLECTIONS, getDb } = require("../db/mongo");
const { merge, defaultsFor, cacheSeconds } = require("../lib/policyDefaults");

const cache = new Map(); // name -> { value, at }
let warned = false;

/**
 * One policy, as it stands now.
 * @param {string} name
 * @param {{db?: import("mongodb").Db, fresh?: boolean}} [opts]
 * @returns {Promise<object>}
 */
async function getPolicy(name, { db = null, fresh = false } = {}) {
  const base = defaultsFor(name);
  const ttlMs = cacheSeconds() * 1000;
  const hit = cache.get(name);
  if (!fresh && hit && Date.now() - hit.at < ttlMs) return hit.value;
  let value = base;
  let version = 0;
  try {
    const handle = db || (await getDb());
    const row = await handle.collection(COLLECTIONS.agentPolicies).find({ name, active: true }).sort({ version: -1 }).limit(1).next();
    if (row) { value = merge(base, row.value || {}); version = row.version; }
  } catch (error) {
    if (!warned) { warned = true; console.warn(`[policy] reading agent_policies failed; using the reviewed defaults (${error.message})`); }
  }
  const frozen = Object.freeze({ ...value, _version: version });
  cache.set(name, { value: frozen, at: Date.now() });
  return frozen;
}

/**
 * Set a new version of a policy: the override as given, merged over the
 * baseline when read. Earlier versions are kept; the newest active wins.
 */
async function setPolicy(name, value, { db = null, author = "unknown", note = "" } = {}) {
  defaultsFor(name);
  const handle = db || (await getDb());
  const coll = handle.collection(COLLECTIONS.agentPolicies);
  const last = await coll.find({ name }).sort({ version: -1 }).limit(1).next();
  const version = (last?.version || 0) + 1;
  await coll.insertOne({ name, version, value, active: true, created_at: new Date(), created_by: author, note });
  cache.delete(name);
  return { name, version };
}

/** Read every policy at once, for a request that touches several. */
async function getPolicies(names, opts) {
  const out = {};
  for (const n of names) out[n] = await getPolicy(n, opts);
  return out;
}

function clearPolicyCache() {
  cache.clear();
}

module.exports = { getPolicy, getPolicies, setPolicy, defaultsFor, merge, clearPolicyCache };
