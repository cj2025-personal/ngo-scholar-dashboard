"use strict";

/**
 * Questions per story, for the scholar who wrote them: how many, how many
 * this week, and how many the story could not answer. No reader, no text —
 * a count of where readers got stuck is the scholar's to see; what any one
 * of them typed is not.
 *
 * On its own, like reads.service, because the story list needs it and the
 * reader service needs the story list's module: one file that requires
 * neither keeps the two from requiring each other.
 */

const { COLLECTIONS } = require("../db/mongo");

const NOT_HERE = "not_here";

/**
 * @param {import("mongodb").Db} db
 * @param {import("mongodb").ObjectId[]} storyIds
 * @returns {Promise<Map<string, {total: number, recent: number, notHere: number}>>}
 */
async function questionsForStories(db, storyIds, { windowDays = 7 } = {}) {
  const out = new Map();
  if (!storyIds || storyIds.length === 0) return out;
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const rows = await db.collection(COLLECTIONS.readerTurns).aggregate([
    { $match: { story_id: { $in: storyIds } } },
    {
      $group: {
        _id: "$story_id",
        total: { $sum: 1 },
        recent: { $sum: { $cond: [{ $gte: ["$created_at", since] }, 1, 0] } },
        notHere: { $sum: { $cond: [{ $eq: ["$outcome", NOT_HERE] }, 1, 0] } },
      },
    },
  ]).toArray();
  for (const row of rows) out.set(String(row._id), { total: row.total || 0, recent: row.recent || 0, notHere: row.notHere || 0 });
  return out;
}

module.exports = { questionsForStories };
