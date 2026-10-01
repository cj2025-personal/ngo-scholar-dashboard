/**
 * Reads by day, as the Studio's chart draws them.
 *
 * What must hold: every day of the window is present, quiet days as 0; days
 * sum across stories; the window before is one total and never leaks into
 * the series; the stories that drew the reads come back most first; and the
 * window is bounded whatever is asked. The store here returns what a real
 * one would for the queried range, rows already within it.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

/* Nothing here connects; the service's module needs the setting to load. */
process.env.MONGODB_URI ||= "mongodb://localhost:27017/reads-test";
process.env.MONGODB_DB ||= "reads-test";

const { readsByDay, dayKey } = require("../src/services/reads.service");

const NOW = new Date("2026-10-01T15:00:00Z");
const day = (offset) => dayKey(new Date(NOW.getTime() - offset * 24 * 60 * 60 * 1000));

function storeOf(rows) {
  const asked = [];
  return {
    asked,
    collection: () => ({
      aggregate: (pipeline) => {
        asked.push(pipeline);
        /* Grouped by day and story, as the pipeline's $group asks. */
        const grouped = new Map();
        for (const r of rows) {
          const key = `${r.day}|${r.story}`;
          grouped.set(key, (grouped.get(key) || 0) + r.reads);
        }
        return { toArray: async () => [...grouped].map(([k, reads]) => { const [d, story] = k.split("|"); return { _id: { day: d, story }, reads }; }) };
      },
    }),
  };
}

test("every day of the window is there, quiet days as 0, through today", async () => {
  const db = storeOf([{ day: day(0), story: "a", reads: 2 }]);
  const r = await readsByDay(db, ["a"], { days: 7, now: NOW });
  assert.equal(r.days, 7);
  assert.equal(r.series.length, 7);
  assert.deepEqual(r.series.map((p) => p.day), [6, 5, 4, 3, 2, 1, 0].map(day));
  assert.deepEqual(r.series.map((p) => p.reads), [0, 0, 0, 0, 0, 0, 2]);
  assert.equal(r.total, 2);
  /* The query covers this window and the one before it, nothing wider. */
  const match = db.asked[0][0].$match;
  assert.equal(match.day.$gte, day(13));
  assert.equal(match.day.$lte, day(0));
});

test("days sum across stories, the window before is one total, and the stories come back most first", async () => {
  const db = storeOf([
    { day: day(1), story: "a", reads: 3 },
    { day: day(1), story: "b", reads: 1 },
    { day: day(4), story: "b", reads: 5 },
    { day: day(9), story: "a", reads: 4 }, // the window before
    { day: day(12), story: "b", reads: 2 }, // the window before
  ]);
  const r = await readsByDay(db, ["a", "b"], { days: 7, now: NOW });
  assert.equal(r.series.find((p) => p.day === day(1)).reads, 4);
  assert.equal(r.series.find((p) => p.day === day(4)).reads, 5);
  assert.equal(r.total, 9);
  assert.equal(r.previousTotal, 6, "the window before is counted, and kept out of the series");
  assert.deepEqual(r.byStory, [{ storyId: "b", reads: 6 }, { storyId: "a", reads: 3 }]);
});

test("no stories is an empty chart, not a query; the window is bounded", async () => {
  const db = storeOf([]);
  const none = await readsByDay(db, [], { days: 30, now: NOW });
  assert.equal(none.series.length, 30);
  assert.equal(none.total, 0);
  assert.equal(db.asked.length, 0);
  assert.equal((await readsByDay(db, [], { days: 9999, now: NOW })).days, 365);
  assert.equal((await readsByDay(db, [], { days: 0, now: NOW })).days, 30);
  assert.equal((await readsByDay(db, [], { days: "x", now: NOW })).days, 30);
});
