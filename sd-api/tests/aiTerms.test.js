/**
 * The agent's terms: whether a scholar has agreed to the ones that stand,
 * and whether a client's agreement is to those or to an older page.
 *
 * The decisions are pure, so they are tested here rather than through a
 * database. The write is one upsert on a collection this service owns.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { AI_TERMS_VERSION, aiTermsView, checkAcceptedVersion } = require("../src/services/aiTerms.service");

test("the version is a date, so 'the terms changed' has a reason a scholar can see", () => {
  assert.match(AI_TERMS_VERSION, /^\d{4}-\d{2}-\d{2}$/);
});

test("no record means not agreed, and the profile still says which version stands", () => {
  const v = aiTermsView(null);
  assert.equal(v.current, false);
  assert.equal(v.acceptedVersion, null);
  assert.equal(v.acceptedAt, null);
  assert.equal(v.version, AI_TERMS_VERSION);
});

test("an agreement to the terms as they stand is current", () => {
  const at = new Date("2026-09-15T10:00:00Z");
  const v = aiTermsView({ profile_id: "p1", version: AI_TERMS_VERSION, accepted_at: at });
  assert.equal(v.current, true);
  assert.equal(v.acceptedVersion, AI_TERMS_VERSION);
  assert.equal(v.acceptedAt, at.toISOString());
});

test("an agreement to older terms is kept on the record but is not current, so the sheet comes back", () => {
  const v = aiTermsView({ version: "2025-01-01", accepted_at: "2025-01-02T00:00:00.000Z" });
  assert.equal(v.current, false);
  assert.equal(v.acceptedVersion, "2025-01-01");
  assert.equal(v.acceptedAt, "2025-01-02T00:00:00.000Z");
});

test("a malformed record is treated as no agreement rather than trusted", () => {
  assert.equal(aiTermsView({ version: 42, accepted_at: new Date() }).current, false);
  assert.equal(aiTermsView({ version: 42 }).acceptedAt, null);
});

test("the client must say which version it showed", () => {
  for (const bad of [undefined, null, "", "   ", 7]) {
    assert.throws(() => checkAcceptedVersion(bad), (e) => e.statusCode === 400 || e.status === 400);
  }
});

test("a sheet drawn before the terms changed cannot agree to the new ones", () => {
  assert.throws(() => checkAcceptedVersion("2020-01-01"), (e) => e.statusCode === 409 || e.status === 409);
});

test("the version that stands is accepted, whitespace and all", () => {
  assert.equal(checkAcceptedVersion(AI_TERMS_VERSION), AI_TERMS_VERSION);
  assert.equal(checkAcceptedVersion(` ${AI_TERMS_VERSION} `), AI_TERMS_VERSION);
});
