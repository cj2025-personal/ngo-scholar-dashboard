"use strict";

/**
 * The reviewed policy baseline, and how an override is laid over it. Pure:
 * no database, so scripts and tests can read a policy exactly as a fresh
 * deployment would.
 */

const DEFAULTS = require("../policies/defaults.json");

function isObject(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

/** Deep merge: objects merge key by key; arrays and scalars replace. */
function merge(base, over) {
  if (!isObject(base) || !isObject(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = isObject(v) && isObject(base[k]) ? merge(base[k], v) : v;
  return out;
}

/** The baseline for one policy, as a fresh copy. */
function defaultsFor(name) {
  if (!(name in DEFAULTS) || name.startsWith("$")) throw new Error(`Unknown policy "${name}".`);
  return JSON.parse(JSON.stringify(DEFAULTS[name]));
}

function cacheSeconds() {
  return Number(DEFAULTS.policy?.cacheSeconds) || 0;
}

module.exports = { merge, defaultsFor, cacheSeconds, isObject };
