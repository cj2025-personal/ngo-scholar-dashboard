/**
 * A scholar's signed impact record (services/impact.service) and the
 * contributions it counts (lib/contributions), 2026-11-06.
 *
 * The record says what a scholar's stories reached - readers, readers who
 * understood, circles - counts only, null under the floor; it is signed with
 * the evidence ledger's key so anyone can check it; it is the scholar's, and
 * nobody else sees it unless they make a share link, which they can turn off.
 * Only a link's hash is kept. A record whose reader counts could not be read
 * is not issued.
 *
 * A throwaway local database (mongodb-memory-server); the learner app's
 * counts are stubbed.
 */
process.env.MONGODB_URI ||= "mongodb://localhost:27017";
process.env.MONGODB_DB ||= "impact-test";
const test = require("node:test");
const assert = require("node:assert/strict");
const { MongoClient, ObjectId } = require("mongodb");
const { MongoMemoryServer } = require("mongodb-memory-server");

const impact = require("../src/services/impact.service");
const { recordContribution, contributionSummary } = require("../src/lib/contributions");

let server;
let client;
let db;
const P = "impact-test-scholar";
const storyA = new ObjectId();
const storyB = new ObjectId();

const counts = (over = {}) => async (method, path, { profileId }) => {
  assert.equal(method, "GET");
  assert.equal(path, "/impact");
  assert.equal(profileId, P);
  return {
    impact: {
      floor: 5,
      understoodShare: 0.75,
      readers: 12,
      understood: 9,
      stories: [{ editorialId: String(storyA), readers: 12, understood: 9, bands: ["ages_8_11"] }],
      circles: { led: 1, classes: 2, schools: 1 },
      contributions: {},
      ...over,
    },
  };
};

test.before(async () => {
  server = await MongoMemoryServer.create();
  client = await MongoClient.connect(server.getUri());
  db = client.db("impact_test");
  await db.collection("scholars").insertOne({ profile_id: P, name: { display: "Dr Ada Field" } });
  await db.collection("scholar_editorials").insertMany([
    { _id: storyA, profile_id: P, status: "published", title: "How small antennas listen", slug: "small-antennas", published_at: new Date("2026-10-01T00:00:00Z"), provenance: { audience: "adults" }, levels: { ages_8_11: { approved: true }, ages_12_14: { approved: false } } },
    { _id: storyB, profile_id: P, status: "published", title: "Radio in the rain", slug: "radio-rain", published_at: new Date("2026-10-05T00:00:00Z"), provenance: { audience: "ages_8_11" } },
    { _id: new ObjectId(), profile_id: P, status: "draft", title: "Not yet", slug: "not-yet" },
    { _id: new ObjectId(), profile_id: "someone-else", status: "published", title: "Theirs", slug: "theirs" },
  ]);
});

test.after(async () => {
  await client?.close();
  await server?.stop();
});

test("contributions are written once each, and counted by kind", async () => {
  await recordContribution(db, { profileId: P, kind: "story_published", ref: String(storyA), at: new Date("2026-10-01T00:00:00Z") });
  await recordContribution(db, { profileId: P, kind: "story_published", ref: String(storyA), at: new Date("2026-11-01T00:00:00Z") });
  await recordContribution(db, { profileId: P, kind: "story_published", ref: String(storyB), at: new Date("2026-10-05T00:00:00Z") });
  await recordContribution(db, { profileId: P, kind: "level_approved", ref: `${storyA}:ages_8_11:x`, at: new Date("2026-10-02T00:00:00Z") });
  await recordContribution(db, { profileId: P, kind: "not_a_kind", ref: "x" });
  await recordContribution(db, { profileId: null, kind: "story_published", ref: "y" });
  const summary = await contributionSummary(db, P);
  assert.deepEqual(summary.byKind, { story_published: 2, level_approved: 1 }, "the same story published twice is one contribution; unknown kinds and no scholar are not written");
  assert.equal(new Date(summary.firstAt).toISOString(), "2026-10-01T00:00:00.000Z", "the first time it happened, not the second");
});

test("the record says what the stories reached, counts only, and is signed", async () => {
  const issued = await impact.buildImpactRecord(db, P, { learnerApi: counts() });
  const { record, signature } = issued;
  assert.equal(record.record_version, impact.RECORD_VERSION);
  assert.equal(record.scholar.name, "Dr Ada Field");
  assert.deepEqual(record.totals, { stories_published: 2, readers: 12, understood: 9, circles_led: 1, classes_in_circles: 2, schools_in_circles: 1 });
  const a = record.stories.find((s) => s.slug === "small-antennas");
  assert.deepEqual(a.reading_ages, ["adults", "ages_8_11"], "its own reading age and the approved level, not one waiting");
  assert.equal(a.readers, 12);
  assert.equal(record.stories.find((s) => s.slug === "radio-rain").readers, null, "no readers counted: null, never a zero that would mean none");
  assert.ok(!record.stories.some((s) => s.slug === "not-yet" || s.slug === "theirs"), "only their published stories");
  assert.deepEqual(record.contributions.by_kind, { story_published: 2, level_approved: 1 });
  assert.match(record.terms.understood, /at least 75%/);
  assert.ok(issued.signed && signature && record.key_id, "signed with the ledger's key");

  assert.equal(impact.verifyRecord({ record, signature }).valid, true);
  const altered = { ...record, totals: { ...record.totals, readers: 1200 } };
  assert.equal(impact.verifyRecord({ record: altered, signature }).valid, false, "a changed number does not verify");
  assert.equal(impact.verifyRecord({ record: { ...record, key_id: "ed25519-other" }, signature }).valid, false, "another key's record is not this one's");
});

test("no record is issued when the reader counts cannot be read", async () => {
  await assert.rejects(
    impact.buildImpactRecord(db, P, { learnerApi: async () => { throw new Error("learner app down"); } }),
    (error) => error.statusCode === 503 || error.status === 503,
  );
  await assert.rejects(impact.buildImpactRecord(db, P, { learnerApi: async () => ({}) }), (error) => error.statusCode === 503 || error.status === 503);
});

test("a share link: its token once, only its hash kept, turned off for good", async () => {
  const { share, token } = await impact.createShare(db, P, "  For the grant panel  ");
  assert.match(token, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(share.label, "For the grant panel");
  const stored = await db.collection(impact.SHARES).findOne({ _id: new ObjectId(share.id) });
  assert.ok(!JSON.stringify(stored).includes(token) && stored.token_hash === impact.hashOf(token), "the token itself is not kept");
  assert.ok(!JSON.stringify(await impact.listShares(db, P)).includes(token), "nor listed");

  const seen = await impact.sharedRecord(db, token, { learnerApi: counts() });
  assert.equal(seen.record.totals.readers, 12);
  assert.equal(impact.verifyRecord(seen).valid, true, "what a link shows verifies");
  assert.equal((await impact.listShares(db, P)).find((s) => s.id === share.id).views, 1);

  await assert.rejects(impact.revokeShare(db, "someone-else", share.id), (e) => (e.statusCode || e.status) === 404, "only theirs to turn off");
  const off = await impact.revokeShare(db, P, share.id);
  assert.ok(off.revokedAt);
  await assert.rejects(impact.sharedRecord(db, token, { learnerApi: counts() }), (e) => (e.statusCode || e.status) === 404, "a link turned off shows nothing");
  await assert.rejects(impact.revokeShare(db, P, share.id), (e) => (e.statusCode || e.status) === 404, "and stays off");
  await assert.rejects(impact.sharedRecord(db, "../../etc", { learnerApi: counts() }), (e) => (e.statusCode || e.status) === 404);
});

test("at most twenty links open at once", async () => {
  for (let i = 0; i < 20; i += 1) await impact.createShare(db, "busy-scholar", `link ${i}`);
  await assert.rejects(impact.createShare(db, "busy-scholar", "one more"), (e) => (e.statusCode || e.status) === 409);
});
