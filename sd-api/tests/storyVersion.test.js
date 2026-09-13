/**
 * The rules behind "one current version, and a history behind it".
 *
 * These are the decisions that decide whether a scholar's writing survives a
 * race: what version a document is at, whether a write is allowed to land,
 * and whether two saves are one save point or two. They are pure, so they are
 * tested here rather than through a database.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  KEEP_REVISIONS,
  COALESCE_MS,
  SOURCE,
  versionOf,
  parseBaseVersion,
  guardFilter,
  conflictSentence,
  shouldCoalesce,
  revisionDocument,
  viewRevision,
} = require("../src/lib/storyVersion");

test("a story written before versioning is version 1, so its first guarded write behaves", () => {
  assert.equal(versionOf({}), 1);
  assert.equal(versionOf({ version: null }), 1);
  assert.equal(versionOf(undefined), 1);
  assert.equal(versionOf({ version: 7 }), 7);
  /* Nonsense is not a version; treating it as one would silently disarm the guard. */
  assert.equal(versionOf({ version: 0 }), 1);
  assert.equal(versionOf({ version: -3 }), 1);
  assert.equal(versionOf({ version: 2.5 }), 1);
  assert.equal(versionOf({ version: "4" }), 1);
});

test("an absent base version means unguarded; a malformed one is refused rather than ignored", () => {
  assert.equal(parseBaseVersion(undefined), null);
  assert.equal(parseBaseVersion(null), null);
  assert.equal(parseBaseVersion(""), null);
  assert.equal(parseBaseVersion(3), 3);
  assert.equal(parseBaseVersion("3"), 3);
  assert.equal(parseBaseVersion(" 12 "), 12);
  for (const bad of ["0", "-1", "abc", "1.5", "{}"]) {
    assert.throws(() => parseBaseVersion(bad), (e) => e.status === 400, `expected ${bad} to be refused`);
  }
});

test("the guard filter pins the write to a version, and version 1 also matches a story that has no counter", () => {
  assert.deepEqual(guardFilter("id", null), { _id: "id" });
  assert.deepEqual(guardFilter("id", undefined), { _id: "id" });
  assert.deepEqual(guardFilter("id", 4), { _id: "id", version: 4 });
  assert.deepEqual(guardFilter("id", 1), { _id: "id", $or: [{ version: 1 }, { version: { $exists: false } }] });
});

test("the conflict sentence names the version to go back to, and says so in words a scholar can act on", () => {
  const s = conflictSentence({ current: 9, who: "elsewhere" });
  assert.match(s, /version 9/);
  assert.match(s, /somewhere else/);
  assert.match(s, /Reload/);
  assert.match(conflictSentence({ current: 2, who: "agent" }), /by the agent/);
  assert.doesNotMatch(conflictSentence({ current: 2 }), /somewhere else|by the agent/);
});

test("consecutive saves by one person collapse into one save point; anything else does not", () => {
  const at = new Date("2026-09-13T12:00:00Z");
  const soon = new Date(at.getTime() + 30_000);
  const later = new Date(at.getTime() + COALESCE_MS + 1);
  const last = { version: 4, source: SOURCE.SCHOLAR, created_by: "a@x.edu", created_at: at, turn_id: null };

  assert.equal(shouldCoalesce({ last, source: SOURCE.SCHOLAR, actor: "a@x.edu", at: soon }), true);

  /* A different person, a different source, or a gap, each starts a new one. */
  assert.equal(shouldCoalesce({ last, source: SOURCE.SCHOLAR, actor: "b@x.edu", at: soon }), false);
  assert.equal(shouldCoalesce({ last, source: SOURCE.AGENT, actor: "a@x.edu", at: soon }), false);
  assert.equal(shouldCoalesce({ last, source: SOURCE.SCHOLAR, actor: "a@x.edu", at: later }), false);

  /* An agent turn is never folded into a person's work, in either direction. */
  assert.equal(shouldCoalesce({ last, source: SOURCE.SCHOLAR, actor: "a@x.edu", turnId: "t1", at: soon }), false);
  assert.equal(
    shouldCoalesce({ last: { ...last, source: SOURCE.AGENT, turn_id: "t1" }, source: SOURCE.AGENT, actor: "a@x.edu", at: soon }),
    false,
  );

  /* A deliberate act with a note stands on its own, in either direction. */
  assert.equal(shouldCoalesce({ last, source: SOURCE.SCHOLAR, actor: "a@x.edu", note: "Approved the levels", at: soon }), false);
  assert.equal(shouldCoalesce({ last: { ...last, note: "Approved the levels" }, source: SOURCE.SCHOLAR, actor: "a@x.edu", at: soon }), false);

  /* The machine's first draft is never overwritten by a later save. */
  assert.equal(shouldCoalesce({ last: { ...last, version: 1 }, source: SOURCE.SCHOLAR, actor: "a@x.edu", at: soon }), false);
  assert.equal(shouldCoalesce({ last: null, source: SOURCE.SCHOLAR, actor: "a@x.edu", at: soon }), false);
});

test("a revision carries the content as of its version, and refuses an unknown source", () => {
  const at = new Date();
  const doc = revisionDocument({
    storyId: "s1", profileId: "p1", version: 3, source: SOURCE.AGENT, actor: "a@x.edu",
    note: "shorten paragraph 2", turnId: "t9", at,
    story: { title: "T", subtitle: "S", excerpt: "E", content: "one two three", body_blocks: [{ type: "paragraph" }], status: "draft" },
  });
  assert.equal(doc.version, 3);
  assert.equal(doc.story_id, "s1");
  assert.equal(doc.source, SOURCE.AGENT);
  assert.equal(doc.turn_id, "t9");
  assert.equal(doc.created_by, "a@x.edu");
  assert.equal(doc.body_blocks.length, 1);
  assert.equal(doc.content, "one two three");

  assert.throws(() => revisionDocument({ storyId: "s", profileId: "p", version: 1, source: "whoever", actor: "a", at, story: {} }), /Unknown revision source/);
});

test("the history panel shows what changed and by whom, never the body", () => {
  const v = viewRevision({
    version: 5, title: "T", source: SOURCE.SCHOLAR, note: null, turn_id: null,
    created_at: new Date(), created_by: "a@x.edu", content: "one two three four", body_blocks: [{}, {}],
  });
  assert.equal(v.version, 5);
  assert.equal(v.words, 4);
  assert.equal(v.blocks, 2);
  assert.equal(v.createdBy, "a@x.edu");
  assert.ok(!("body_blocks" in v) && !("content" in v), "a listing never carries the body");
});

test("history is bounded, so an autosaving editor cannot grow a story without limit", () => {
  assert.ok(KEEP_REVISIONS >= 10 && KEEP_REVISIONS <= 200, `${KEEP_REVISIONS} is not a sane cap`);
  assert.ok(COALESCE_MS >= 30_000, "save points closer than half a minute would be noise");
});
