"use strict";
/**
 * What scholars contribute, recorded as it happens, so what they are paid for
 * can be worked out later from the record (the platform charges institutions
 * and families, and pays scholars for certain contributions made here; which
 * ones is not yet decided).
 *
 * One collection, scholar_contributions, shared with the learner app (its
 * services/contributions.ts writes circle_created, class_joined_circle and
 * passage_clarified); the studio writes story_published and level_approved.
 * Append-only: written once by (profileId, kind, ref), never changed; writing
 * it again is a no-op. Nothing about any reader is in it.
 */

const CONTRIBUTIONS = "scholar_contributions";
const KINDS = new Set(["story_published", "level_approved", "circle_created", "class_joined_circle", "passage_clarified"]);

let indexed = null;

function ensureIndexes(db) {
  indexed ??= Promise.all([
    db.collection(CONTRIBUTIONS).createIndex({ profileId: 1, kind: 1, ref: 1 }, { unique: true }),
    db.collection(CONTRIBUTIONS).createIndex({ profileId: 1, at: 1 }),
  ]).catch((error) => {
    indexed = null;
    throw error;
  });
  return indexed;
}

/**
 * Records a contribution once. Never throws and never holds up what the
 * scholar did: one that could not be written is logged, and
 * scripts/backfillContributions.js finds it again.
 */
async function recordContribution(db, { profileId, kind, ref, at = new Date(), detail = {} }) {
  if (!profileId || !KINDS.has(kind) || !ref) return;
  try {
    await ensureIndexes(db);
    await db.collection(CONTRIBUTIONS).updateOne(
      { profileId: String(profileId), kind, ref: String(ref) },
      { $setOnInsert: { profileId: String(profileId), kind, ref: String(ref), at, detail, source: "studio" } },
      { upsert: true },
    );
  } catch (error) {
    console.warn(`[contributions] ${kind} not recorded: ${error.message}`);
  }
}

/** A scholar's contributions counted by kind, and when the first and last were. */
async function contributionSummary(db, profileId) {
  const rows = await db
    .collection(CONTRIBUTIONS)
    .aggregate([
      { $match: { profileId: String(profileId) } },
      { $group: { _id: "$kind", n: { $sum: 1 }, first: { $min: "$at" }, last: { $max: "$at" } } },
    ])
    .toArray();
  const byKind = Object.fromEntries(rows.map((r) => [r._id, r.n]));
  const firsts = rows.map((r) => r.first).filter(Boolean).sort((a, b) => a - b);
  const lasts = rows.map((r) => r.last).filter(Boolean).sort((a, b) => b - a);
  return { byKind, firstAt: firsts[0] || null, lastAt: lasts[0] || null };
}

module.exports = { CONTRIBUTIONS, KINDS, recordContribution, contributionSummary };
