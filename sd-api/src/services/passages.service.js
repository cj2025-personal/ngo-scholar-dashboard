/**
 * The passages behind a story: the paper it was drawn from, split the way
 * the drafter split it, so the ids on the story's blocks resolve to the
 * same text they were judged against — and screened the way the drafter
 * screened it, so a passage the source guard set aside is absent here too.
 *
 * Shared by the story agent, the evidence ledger, the reading levels, the
 * reading companion and the public "show sources" route, which is why it
 * lives on its own rather than inside any of them.
 */

const composer = require("../lib/draftComposer");
const { loadSourceText } = require("./drafting.service");
const { screenedPassages } = require("./sourceGuard.service");

/**
 * @param {import("mongodb").Db} db
 * @param {object} story   the raw story document, with `provenance`
 * @returns {Promise<{id: string, text: string, words: number}[]>}
 */
async function passagesFor(db, story) {
  const p = story?.provenance;
  if (!p || !p.source_id) return [];
  const text = await loadSourceText(db, { origin: p.origin, id: p.source_id });
  const { passages } = await screenedPassages(db, { source: { origin: p.origin, id: p.source_id, title: p.source_title || null }, text: composer.prepareSourceText(text).text });
  return passages;
}

module.exports = { passagesFor };
