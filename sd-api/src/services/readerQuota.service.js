"use strict";

/**
 * How much a reader may ask.
 *
 * Two counters, both per UTC day, both in Mongo so that every replica sees
 * the same number: one per reader, one for every reader together. The first
 * keeps one device from monopolising the companion; the second is the cost
 * ceiling on a feature that anyone with a link can use.
 *
 * The count is taken before the model is called, and is not given back if
 * the answer fails: a question that reached the model cost what it cost.
 */

const { COLLECTIONS } = require("../db/mongo");
const { ApiError } = require("../lib/api-error");
const { env } = require("../config/env");

const GLOBAL_KEY = "all";
const ROW_TTL_MS = 2 * 24 * 60 * 60 * 1000;

/** The day a question is filed under, in UTC, as `YYYY-MM-DD`. */
function dayKey(at = new Date()) {
  return at.toISOString().slice(0, 10);
}

async function bump(db, key, day, now) {
  const row = await db.collection(COLLECTIONS.readerQuota).findOneAndUpdate(
    { key, day },
    { $inc: { asks: 1 }, $set: { updated_at: now }, $setOnInsert: { expires_at: new Date(now.getTime() + ROW_TTL_MS) } },
    { upsert: true, returnDocument: "after" },
  );
  return row?.asks ?? row?.value?.asks ?? 1;
}

/**
 * Count one question, or refuse it.
 *
 * @param {import("mongodb").Db} db
 * @param {{readerKey: string, now?: Date}} p
 * @returns {Promise<{remaining: number}>}  questions this reader has left today
 */
async function takeAsk(db, { readerKey, now = new Date() }) {
  const day = dayKey(now);
  const mine = await bump(db, readerKey, day, now);
  if (mine > env.reader.dailyCap) {
    throw new ApiError(429, "You've asked a lot today. Come back tomorrow and we can keep going.");
  }
  const everyone = await bump(db, GLOBAL_KEY, day, now);
  if (everyone > env.reader.globalDailyCap) {
    throw new ApiError(429, "The companion is very busy today. Please try again tomorrow.");
  }
  return { remaining: Math.max(0, env.reader.dailyCap - mine) };
}

/** How many questions a reader has left today, without taking one. */
async function remainingFor(db, { readerKey, now = new Date() }) {
  const row = await db.collection(COLLECTIONS.readerQuota).findOne({ key: readerKey, day: dayKey(now) }, { projection: { asks: 1 } });
  return Math.max(0, env.reader.dailyCap - (row?.asks || 0));
}

module.exports = { takeAsk, remainingFor, dayKey, GLOBAL_KEY };
