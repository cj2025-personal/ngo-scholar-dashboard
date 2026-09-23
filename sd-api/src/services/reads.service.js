/**
 * How many people read it.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * A scholar's career does not reward writing for the public. Promotion
 * committees count journal papers; nothing in most department policies asks
 * anyone to explain their work to a reader outside the field. So this product
 * cannot borrow a motive from the scholar's job — the only thing it can offer
 * in return for the work is the answer to "did anyone read it?", and until
 * now it had no way to answer. A story was published and the portal went
 * quiet. "1 story published" is a filing count, not an outcome.
 *
 * ── What is stored, and what deliberately is not ───────────────────────────
 * One row per story per day, holding a number. That is the whole record:
 *
 *     { story_id, profile_id, day: "2026-09-18", reads: 41 }
 *
 * No address, no agent string, no cookie, no hashed identifier, nothing that
 * could be joined back to a person or across stories. A scholar asking "is
 * anyone reading this?" is owed a count; nobody involved is owed a file on
 * the reader, and a product whose whole argument is that it does not overstate
 * what it knows should not start by quietly building an audience database.
 *
 * The cost of that choice is honest and worth stating plainly: these are
 * reads, not readers. Two visits from one person on two days count twice, and
 * the number cannot be de-duplicated later because the data to do it with was
 * never kept. The dashboard says "reads" for that reason and must keep saying
 * it.
 *
 * ── What counts as a read ──────────────────────────────────────────────────
 * Not a page load. The reader calls this once they have actually stayed with
 * the article — the browser decides, on dwell and scroll, and records at most
 * one read per article per session. A hit counter would have been less code
 * and would have told the scholar something closer to a lie: that the eleven
 * people who bounced off the headline had read their work.
 *
 * The throttle below is the only defence against a caller that ignores all
 * that, and it is a weak one: in-process, so it protects a single replica for
 * as long as that replica lives. It exists to stop a refresh-held key, not a
 * determined inflater. Anything stronger belongs at the edge.
 */

const crypto = require("crypto");

const { COLLECTIONS } = require("../db/mongo");

/** One read per source per story in this window. */
const THROTTLE_MS = 10 * 60 * 1000;
/** Bounded so a long-running process cannot grow this without limit. */
const THROTTLE_MAX = 20_000;

/** ip+story → last accepted. Memory only; never written anywhere. */
const recent = new Map();

function throttled(key) {
  const now = Date.now();
  const last = recent.get(key);
  if (last && now - last < THROTTLE_MS) return true;
  /* Evict wholesale rather than walk the map on every call: the window is
     short and the map is only a refresh guard, so losing it costs one
     double-count per key at worst. */
  if (recent.size >= THROTTLE_MAX) recent.clear();
  recent.set(key, now);
  return false;
}

/** The day a read is filed under, in UTC, as `YYYY-MM-DD`. */
function dayKey(at = new Date()) {
  return at.toISOString().slice(0, 10);
}

/**
 * Record one read of a published story.
 *
 * Silent about whether it counted. A reader is not told they were throttled,
 * and a story that does not exist is not confirmed not to exist — both would
 * turn this into a way to probe for slugs.
 *
 * @param {import("mongodb").Db} db
 * @param {{ slug: string, from?: string }} p  `from` is a remote address, used
 *   for the in-memory throttle and never stored.
 * @returns {Promise<{ok: true}>}
 */
async function recordStoryRead(db, { slug, from = "" }) {
  const name = String(slug || "").trim();
  if (!name) return { ok: true };

  const story = await db.collection(COLLECTIONS.scholarEditorials).findOne(
    {
      slug: name,
      $or: [{ status: "published" }, { status: "scheduled", scheduled_for: { $lte: new Date() } }],
    },
    { projection: { _id: 1, profile_id: 1 } },
  );
  if (!story) return { ok: true };

  /* Hashed so that even the transient key in memory is not a list of who read
     what. It is a throttle key, and a throttle key does not need to be legible. */
  const source = crypto.createHash("sha256").update(`${from}|${story._id}`).digest("hex").slice(0, 32);
  if (throttled(source)) return { ok: true };

  await db.collection(COLLECTIONS.storyReads).updateOne(
    { story_id: story._id, day: dayKey() },
    {
      $inc: { reads: 1 },
      $set: { updated_at: new Date() },
      $setOnInsert: { profile_id: story.profile_id || null },
    },
    { upsert: true },
  );
  return { ok: true };
}

/**
 * Reads per story, for the scholar who owns them.
 *
 * @param {import("mongodb").Db} db
 * @param {import("mongodb").ObjectId[]} storyIds
 * @param {{ windowDays?: number }} [opts]
 * @returns {Promise<Map<string, {total: number, recent: number}>>}  keyed by
 *   story id as a string; `recent` covers the trailing window.
 */
async function readsForStories(db, storyIds, { windowDays = 7 } = {}) {
  const out = new Map();
  if (!storyIds || storyIds.length === 0) return out;

  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const sinceDay = dayKey(since);

  const rows = await db
    .collection(COLLECTIONS.storyReads)
    .aggregate([
      { $match: { story_id: { $in: storyIds } } },
      {
        $group: {
          _id: "$story_id",
          total: { $sum: "$reads" },
          /* One pass: the trailing window is a conditional sum over the same
             rows rather than a second query against the same index. */
          recent: { $sum: { $cond: [{ $gte: ["$day", sinceDay] }, "$reads", 0] } },
        },
      },
    ])
    .toArray();

  for (const row of rows) {
    out.set(String(row._id), { total: row.total || 0, recent: row.recent || 0 });
  }
  return out;
}

module.exports = { recordStoryRead, readsForStories, dayKey };
