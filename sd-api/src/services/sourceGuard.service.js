"use strict";

/**
 * A paper's passages, screened once and remembered.
 *
 * Every model that reads a paper — the drafter, the fact-checking judges,
 * the editing agent, the reading companion — reads it through here. The
 * guard's verdicts are kept per paper, per text and per guard version, so a
 * paper is screened once and the same passages are set aside every time it
 * is read, by every replica. A screening that fails is an error, not a
 * pass: a paper the guard could not read is not read by anything else.
 */

const crypto = require("node:crypto");
const { COLLECTIONS } = require("../db/mongo");
const { ApiError } = require("../lib/api-error");
const plan = require("../lib/draftPlan");
const guard = require("../lib/agents/sourceGuard");
const { getPolicy } = require("./policy.service");
const { routerFor } = require("./models.service");
const { recordDecision } = require("./agentAudit.service");

const hashOf = (text) => crypto.createHash("sha256").update(String(text || ""), "utf8").digest("hex");

/**
 * The passages of a prepared text, with those the guard set aside removed.
 * Ids are the split's, so a passage set aside leaves a gap no block can
 * cite; `setAside` says which, and why.
 *
 * @param {import("mongodb").Db} db
 * @param {object} p
 * @param {{origin: string, id: string, title?: string}} p.source
 * @param {string} p.text            the prepared source text
 * @param {Function} [p.generate]    injected by tests; the guard's route otherwise
 * @returns {Promise<{passages: {id,text,words}[], setAside: {id, reason}[], screened: boolean}>}
 */
async function screenedPassages(db, { source, text, generate = null }) {
  const all = plan.splitPassages(text);
  if (!all.length) return { passages: [], setAside: [], screened: false };
  const policy = await getPolicy("drafting", { db });
  const key = `${source.origin}:${source.id}`;
  const hash = hashOf(text);
  const coll = db.collection(COLLECTIONS.sourceScreenings);
  const kept = await coll.findOne({ key, hash, version: guard.GUARD_VERSION });
  let setAside;
  if (kept) {
    setAside = kept.set_aside || [];
  } else {
    const gen = generate || (await routerFor({ db })).bound("drafting.guard");
    let result;
    try {
      result = await guard.screen({ passages: all, title: source.title || null, batch: policy.guard.batch, generate: gen });
    } catch (error) {
      throw new ApiError(503, `The paper could not be screened just now, so nothing read it. Try again in a moment. (${error.message})`);
    }
    setAside = result.setAside;
    const now = new Date();
    await coll.updateOne(
      { key, hash, version: guard.GUARD_VERSION },
      { $setOnInsert: { key, hash, version: guard.GUARD_VERSION, set_aside: setAside, passages: all.length, created_at: now, expires_at: new Date(now.getTime() + (Number(policy.guard.cacheDays) || 90) * 24 * 60 * 60 * 1000) } },
      { upsert: true },
    );
    void recordDecision({
      agent: "drafting.guard",
      subject: { kind: "source", id: key },
      decision: { setAside: setAside.map((s) => s.id), of: all.length },
      rationale: setAside.map((s) => `${s.id}: ${s.reason}`).join(" ") || "nothing addressed the reader",
      model: result.calls.find((c) => c.model)?.model || null,
      promptVersion: guard.GUARD_VERSION,
      usage: result.calls.reduce((acc, c) => (c.usage ? { input: acc.input + (c.usage.input || 0), output: acc.output + (c.usage.output || 0) } : acc), { input: 0, output: 0 }),
    }, { db });
  }
  const gone = new Set(setAside.map((s) => s.id));
  return { passages: all.filter((p) => !gone.has(p.id)), setAside, screened: true };
}

/** One sentence for a scholar when passages were set aside. */
function setAsideNote(setAside) {
  if (!setAside?.length) return null;
  const n = setAside.length;
  return `${n === 1 ? "One passage" : `${n} passages`} of the paper ${n === 1 ? "was" : "were"} set aside because ${n === 1 ? "it addresses" : "they address"} whoever reads it rather than reporting the work, so nothing here draws on ${n === 1 ? "it" : "them"}.`;
}

module.exports = { screenedPassages, setAsideNote, hashOf };
