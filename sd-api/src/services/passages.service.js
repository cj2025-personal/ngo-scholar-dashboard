/**
 * The passages behind a story: the paper it was drawn from, split the way
 * the drafter split it, so the ids on the story's blocks resolve to the
 * same text they were judged against.
 *
 * Shared by the story agent, the evidence ledger, the reading levels and the
 * public "show sources" route, which is why it lives on its own rather than
 * inside any of them.
 */

const composer = require("../lib/draftComposer");
const plan = require("../lib/draftPlan");
const { loadSourceText } = require("./drafting.service");

/**
 * @param {import("mongodb").Db} db
 * @param {object} story   the raw story document, with `provenance`
 * @returns {Promise<{id: string, text: string, words: number}[]>}
 */
async function passagesFor(db, story) {
  const p = story?.provenance;
  if (!p || !p.source_id) return [];
  const text = await loadSourceText(db, { origin: p.origin, id: p.source_id });
  return plan.splitPassages(composer.prepareSourceText(text).text);
}

module.exports = { passagesFor };
