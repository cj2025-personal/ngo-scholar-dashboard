"use strict";

/**
 * A change to a policy at runtime, and what has to be true before it is made.
 *
 * A policy is data (src/policies/defaults.json, overridden through the
 * agent_policies collection), so a change to it never passes the evals that
 * gate a change to the code. This module is what makes a runtime change pass
 * them anyway:
 *
 *   - `unknownPaths` names every key in an override that the baseline does
 *     not have. A misspelt key is otherwise merged in silently and does
 *     nothing, and the operator believes the limit changed.
 *   - `evalsFor` names the evals a change to this policy can move, so the
 *     script that writes the row runs them first, with the proposed policy in
 *     place of the baseline, and refuses the row when one fails.
 *   - `readProposal` and `policyFor` are how an eval script runs under a
 *     proposed policy: `--policy <file>` carries the overrides, keyed by
 *     policy name, and every policy the script reads is the baseline with
 *     those laid over it. Without the flag the baseline is what runs, exactly
 *     as a fresh deployment would.
 *
 * Pure: no database, no model.
 */

const fs = require("node:fs");
const path = require("node:path");
const { defaultsFor, merge, isObject } = require("./policyDefaults");

/** Every eval, with the script that runs it and the policies it reads. */
const EVALS = Object.freeze({
  drafts:   { script: "scripts/evalDrafts.js",   reads: ["models", "drafting"] },
  reader:   { script: "scripts/evalReader.js",   reads: ["models", "reader", "evals"] },
  converse: { script: "scripts/evalConverse.js", reads: ["models", "studio", "evals"] },
  voice:    { script: "scripts/evalVoice.js",    reads: ["models", "evals"] },
  review:   { script: "scripts/evalReview.js",   reads: ["models", "drafting", "evals"] },
  edit:     { script: "scripts/evalEdit.js",     reads: ["models", "studio", "evals"] },
  guard:    { script: "scripts/evalGuard.js",    reads: ["models", "drafting", "evals"] },
});

/* Objects whose keys are instances rather than a fixed set: a new route or a
   new model's limits may be added at runtime, since the router reads them by
   name. Everything else must already exist in the baseline. */
const OPEN_PATHS = new Set(["models.routes", "models.modelLimits"]);

/**
 * The key paths in `override` that the baseline for `name` does not have.
 * @param {string} name
 * @param {object} override
 * @returns {string[]}  dotted paths, in document order; empty when every key is known
 */
function unknownPaths(name, override) {
  const out = [];
  const walk = (base, over, at) => {
    if (!isObject(over)) return;
    for (const [k, v] of Object.entries(over)) {
      const here = at ? `${at}.${k}` : k;
      const known = isObject(base) && Object.prototype.hasOwnProperty.call(base, k);
      if (!known && !OPEN_PATHS.has(`${name}${at ? `.${at}` : ""}`)) { out.push(here); continue; }
      if (known && isObject(base[k]) && !isObject(v) && v !== null) { out.push(`${here} (an object in the baseline, ${typeof v} here)`); continue; }
      if (known) walk(base[k], v, here);
    }
  };
  walk(defaultsFor(name), override, "");
  return out;
}

/**
 * The evals a change to policy `name` can move, in the order to run them.
 * For the `evals` policy itself, only the evals whose floors the override
 * touches; a floor nobody raised cannot start failing.
 * @param {string} name
 * @param {object} [override]
 * @returns {string[]}  keys of EVALS
 */
function evalsFor(name, override = {}) {
  if (name === "evals") return Object.keys(EVALS).filter((e) => isObject(override) && Object.prototype.hasOwnProperty.call(override, e));
  return Object.keys(EVALS).filter((e) => EVALS[e].reads.includes(name));
}

/**
 * The proposed overrides an eval script was started with: `--policy <file>`,
 * a JSON object keyed by policy name. Empty when the flag is absent.
 * @param {string[]} argv
 * @returns {object}
 */
function readProposal(argv) {
  const i = argv.indexOf("--policy");
  if (i < 0 || !argv[i + 1]) return {};
  const file = path.resolve(argv[i + 1]);
  const proposal = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!isObject(proposal)) throw new Error(`${file} must hold an object keyed by policy name.`);
  for (const name of Object.keys(proposal)) {
    const unknown = unknownPaths(name, proposal[name]);
    if (unknown.length) throw new Error(`${file}: ${name} has keys the baseline does not: ${unknown.join(", ")}`);
  }
  return proposal;
}

/**
 * One policy as the proposal would have it: the baseline with the override
 * laid over it, or the baseline alone.
 * @param {string} name
 * @param {object} [proposal]   as readProposal returns it
 */
function policyFor(name, proposal = {}) {
  const over = isObject(proposal) ? proposal[name] : null;
  return over ? merge(defaultsFor(name), over) : defaultsFor(name);
}

module.exports = { EVALS, unknownPaths, evalsFor, readProposal, policyFor };
