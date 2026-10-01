"use strict";

/**
 * The record of what the agents decided.
 *
 * One row per decision — the guard routing a question, the Sentinel ruling
 * on an answer, the studio agent choosing what a scholar meant — with what
 * was decided, the model's own reason, which model and prompt version made
 * it, and what it cost. Nothing a person typed is stored here: the subject
 * is an id, and the decision is the model's structured output. Rows expire
 * after the audit policy's retention.
 *
 * Writes never fail the request they describe. A decision that cannot be
 * recorded is logged and the work goes on; the agent's answer is not held
 * hostage to the audit store.
 */

const { COLLECTIONS, getDb } = require("../db/mongo");
const { getPolicy } = require("./policy.service");

/**
 * @param {object} row
 * @param {string} row.agent          e.g. "reader.guard"
 * @param {{kind:string, id:string}} row.subject
 * @param {object} row.decision       the structured decision, without free text from a person
 * @param {string} [row.rationale]    the model's own reason
 * @param {string} [row.model]
 * @param {string} [row.promptVersion]
 * @param {object} [row.usage]
 * @param {number} [row.ms]
 */
async function recordDecision(row, { db = null } = {}) {
  try {
    const handle = db || (await getDb());
    const audit = await getPolicy("audit", { db: handle });
    const now = new Date();
    await handle.collection(COLLECTIONS.agentAudit).insertOne({
      agent: row.agent,
      subject: row.subject || null,
      decision: row.decision || null,
      rationale: row.rationale ? String(row.rationale).slice(0, 600) : null,
      model: row.model || null,
      prompt_version: row.promptVersion || null,
      usage: row.usage || null,
      ms: row.ms ?? null,
      created_at: now,
      expires_at: new Date(now.getTime() + (Number(audit.retainDays) || 0) * 24 * 60 * 60 * 1000),
    });
  } catch (error) {
    console.warn(`[audit] could not record ${row?.agent} decision: ${error.message}`);
  }
}

/** One line per model call, numbers only, for dashboards and alerts. */
function logModelCall(e) {
  console.log("[model]", JSON.stringify({ purpose: e.purpose, model: e.model, fallback: e.fallback, ok: e.ok, ms: e.ms, input: e.usage?.input ?? null, output: e.usage?.output ?? null, error: e.error || undefined }));
}

module.exports = { recordDecision, logModelCall };
