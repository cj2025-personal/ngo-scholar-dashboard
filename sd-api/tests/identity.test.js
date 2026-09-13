/**
 * The authorization primitive, tested adversarially.
 *
 * This service lets people change what a platform publishes about named
 * individuals. `isSameScholar` is what stands between a scholar editing their
 * own record and editing someone else's, so it is tested for the ways it could
 * wrongly say yes rather than for the happy path.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CANONICAL_KEY,
  canonicalScholarId,
  isSameScholar,
  scholarFilter,
  ownedByScholarFilter,
  isLegacyObjectIdNamespace,
} = require("../src/lib/identity");

const PROFILE = "0001d6a6-974f-43df-b097-fe20f6aa7239";
const OTHER = "a688a2f0-ab3c-4f21-9e55-1c8f7d2b4a10";

test("profile_id is the canonical key", () => {
  assert.equal(CANONICAL_KEY, "profile_id");
});

test("resolves the canonical id from a session user", () => {
  assert.equal(canonicalScholarId({ profile_id: PROFILE }), PROFILE);
  assert.equal(canonicalScholarId({ profileId: PROFILE }), PROFILE);
  // scholar_id duplicates profile_id on the two existing credential rows, so it
  // is accepted as a migration aid — not as a contract.
  assert.equal(canonicalScholarId({ scholar_id: PROFILE }), PROFILE);
  assert.equal(canonicalScholarId({ profile_id: `  ${PROFILE}  ` }), PROFILE);
});

test("an unidentified caller resolves to null, never to some scholar", () => {
  // Guessing here would mean acting on a record on behalf of nobody.
  for (const input of [null, undefined, {}, "string", 42, { profile_id: "" }, { profile_id: "   " }, { profile_id: 123 }]) {
    assert.equal(canonicalScholarId(input), null, `should not resolve: ${JSON.stringify(input)}`);
  }
});

test("profile_id wins over a stale scholar_id when both are present", () => {
  // scholar_id is vestigial; if the two ever disagree, the canonical one leads.
  assert.equal(canonicalScholarId({ profile_id: PROFILE, scholar_id: OTHER }), PROFILE);
});

test("two different scholars are never the same scholar", () => {
  assert.equal(isSameScholar(PROFILE, OTHER), false);
});

test("identity comparison refuses everything ambiguous", () => {
  // Each of these is a way a looser comparison could wrongly grant access to
  // another person's public record.
  const attacks = [
    [PROFILE, PROFILE.toUpperCase(), "case folding must not match"],
    [PROFILE, PROFILE.slice(0, 10), "a prefix must not match"],
    [PROFILE, `${PROFILE}x`, "a suffix must not match"],
    ["", "", "two empties are not a scholar"],
    [null, null, "null is not an identity"],
    [undefined, undefined, "undefined is not an identity"],
    [PROFILE, null, "a real id never matches nothing"],
    [0, 0, "numbers are not identities"],
    [{}, {}, "objects are not identities"],
    [[PROFILE], [PROFILE], "arrays are not identities"],
  ];

  for (const [a, b, why] of attacks) {
    assert.equal(isSameScholar(a, b), false, why);
  }
});

test("surrounding whitespace does not change who you are", () => {
  assert.equal(isSameScholar(` ${PROFILE} `, PROFILE), true);
});

test("scholarFilter reaches the five scholars whose _id and profile_id differ", () => {
  const filter = scholarFilter(PROFILE);
  assert.deepEqual(filter, { $or: [{ profile_id: PROFILE }, { _id: PROFILE }] });
});

test("ownership filter is a single indexed equality, not an OR", () => {
  // The six-way $or this replaces could not use an index and silently matched
  // rows from a different identity namespace.
  const filter = ownedByScholarFilter(PROFILE);
  assert.deepEqual(filter, { profile_id: PROFILE });
  assert.equal(Object.keys(filter).length, 1);
  assert.equal("$or" in filter, false, "ownership must never widen to an OR");
});

test("building a filter without an id throws rather than matching everything", () => {
  // An empty filter would return every scholar's content. Failing loudly is the
  // only acceptable behaviour.
  for (const bad of [null, undefined, ""]) {
    assert.throws(() => scholarFilter(bad), TypeError);
    assert.throws(() => ownedByScholarFilter(bad), TypeError);
  }
});

test("the legacy ObjectId namespace is recognisable, so it can be reported", () => {
  // The 6 existing scholarstories rows carry this shape and resolve to nothing.
  assert.equal(isLegacyObjectIdNamespace("69724afe4ad91ba8a172bc5c"), true);
  assert.equal(isLegacyObjectIdNamespace(PROFILE), false, "a UUID is not an ObjectId");
  assert.equal(isLegacyObjectIdNamespace("69724afe4ad91ba8a172bc5"), false, "23 chars is not an ObjectId");
  assert.equal(isLegacyObjectIdNamespace(null), false);
});
