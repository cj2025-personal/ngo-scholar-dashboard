"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

/* A placeholder, as in contracts.test.js: these are pure query builders and
   nothing here connects. The service module refuses to load without it. */
process.env.MONGODB_URI ||= "mongodb://localhost:27017/ownership-scope-test";
process.env.MONGODB_DB ||= "ownership-scope-test";

const {
  buildScholarStoryFilters,
  buildStoryStatusQuery,
  buildStoryListQuery,
} = require("../src/services/editorial.service");

/**
 * A scholar sees their own work, and only their own.
 *
 * ── The failure ────────────────────────────────────────────────────────────
 * The listing combined two conditions with an object spread:
 *
 *   { $or: buildScholarStoryFilters(...), ...buildStoryStatusQuery(status) }
 *
 * Ownership is an `$or`. So is the `published` status filter, because a
 * published story is "published, or scheduled and past its date". The spread
 * therefore replaced the ownership `$or` with the status one, and the query
 * lost its owner clause entirely: `GET /api/editorial-stories?status=published`
 * returned every scholar's published stories to whoever asked. Signed in as
 * Craig Johnson, who has written nothing, the portal showed another scholar's
 * article under "Everything you have written".
 *
 * `draft` and `scheduled` were unaffected, but only because those branches
 * happen to return plain `status` keys. That is luck. These tests check the
 * composition rather than the luck.
 */

test("ownership survives every status filter", () => {
  /* The property that was lost. Asserted for all four branches, because the
     bug was invisible in three of them. */
  for (const status of ["all", "published", "draft", "scheduled"]) {
    const query = buildStoryListQuery({ scholarId: "s-1", profileId: "p-1", status });
    const serialized = JSON.stringify(query);
    assert.ok(
      serialized.includes("p-1"),
      `status=${status} dropped the owner clause: ${serialized.slice(0, 160)}`,
    );
  }
});

test("the published filter is an $or, which is what made the collision possible", () => {
  /* If this stops being an `$or`, the spread would start working by accident
     and someone may reasonably undo the `$and`. Recording the shape keeps the
     reason for the fix attached to the fact that caused it. */
  const published = buildStoryStatusQuery("published");
  assert.ok(Array.isArray(published.$or), "published is expressed as $or");
  assert.ok(published.$or.length > 1, "published-or-scheduled-and-due");
});

test("ownership is also an $or, so the two cannot share a key", () => {
  const owner = buildScholarStoryFilters({ scholarId: "s-1", profileId: "p-1" });
  assert.ok(Array.isArray(owner) && owner.length > 0);
});

test("both clauses are kept side by side, not merged", () => {
  /* `$and` is the specific remedy: it composes conditions whatever shape each
     one takes, where a spread silently keeps only the last key. */
  const query = buildStoryListQuery({ scholarId: "s-1", profileId: "p-1", status: "published" });
  assert.ok(Array.isArray(query.$and), "conditions must compose under $and");
  assert.equal(query.$and.length, 2, "one ownership clause, one status clause");

  const [ownership, statusClause] = query.$and;
  assert.ok(Array.isArray(ownership.$or), "ownership clause intact");
  assert.ok(Array.isArray(statusClause.$or), "status clause intact");
});

test("a deleted story is not listed, whatever the status asked for", () => {
  /* Deletion is owner-facing state; the filter carries it, and the collision
     discarded that too. */
  const query = buildStoryListQuery({ scholarId: "s-1", profileId: "p-1", status: "published" });
  assert.ok(JSON.stringify(query).includes("deleted"), "the deleted exclusion must survive");
});

test("an unsupported status is refused rather than widened", () => {
  /* Falling back to "no status condition" on an unknown value would list a
     scholar's drafts under a typo'd filter. */
  assert.throws(() => buildStoryStatusQuery("everything"), /Unsupported story status/);
});
