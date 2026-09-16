/**
 * Which levels a discard removes.
 *
 * A level could be written, rewritten and approved, never removed, so a
 * scholar who did not want a band was asked to approve it for as long as the
 * story existed. These are the rules behind the answer: what "the ones
 * waiting" means, what naming a band does, and which removals take something
 * away from readers — because that last one must be said out loud before it
 * happens.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { levelsToDiscard } = require("../src/lib/levels");

const have = {
  ages_8_11: { approved: false },
  ages_12_14: { approved: true, approved_at: new Date() },
  ages_15_18: { approved: false, stale: true },
};

test("with no band named, a discard takes every level the scholar has not approved — what the queue asks about", () => {
  const r = levelsToDiscard(have, null);
  assert.deepEqual(r.remove.sort(), ["ages_15_18", "ages_8_11"]);
  assert.deepEqual(r.live, [], "an approved level is never swept up by the general discard");
  assert.deepEqual(r.missing, []);
});

test("an empty list means the same as none: the ones waiting", () => {
  assert.deepEqual(levelsToDiscard(have, []).remove.sort(), ["ages_15_18", "ages_8_11"]);
});

test("naming a band removes that one, and a band that is live for readers is counted so the caller can say so", () => {
  const r = levelsToDiscard(have, ["ages_12_14"]);
  assert.deepEqual(r.remove, ["ages_12_14"]);
  assert.deepEqual(r.live, ["ages_12_14"], "readers stop seeing it; the caller warns first");
  assert.deepEqual(r.missing, []);
});

test("a band with no level on the story is reported rather than silently doing nothing", () => {
  const r = levelsToDiscard(have, ["adults"]);
  assert.deepEqual(r.remove, []);
  assert.deepEqual(r.missing, ["adults"]);
});

test("a band named twice is removed once, and an unknown band name normalises rather than deleting something else", () => {
  assert.deepEqual(levelsToDiscard(have, ["ages_8_11", "ages_8_11"]).remove, ["ages_8_11"]);
  /* normaliseAudience falls back to the default band; it is absent here, so
     the request is reported as missing rather than removing a real level. */
  const r = levelsToDiscard(have, ["toddlers"]);
  assert.deepEqual(r.remove, []);
  assert.equal(r.missing.length, 1);
});

test("a story with no levels yields nothing to discard, whatever is asked", () => {
  for (const empty of [undefined, null, {}, "nonsense"]) {
    assert.deepEqual(levelsToDiscard(empty, null).remove, []);
    assert.deepEqual(levelsToDiscard(empty, ["ages_8_11"]).remove, []);
  }
});
