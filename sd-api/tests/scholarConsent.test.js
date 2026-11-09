/**
 * The consent read helper (lib/scholarConsent) against the shared contract.
 *
 * tests/fixtures/scholarConsent.json is the consent SPEC's own fixture, copied
 * unchanged: every repo's helper must give the same answers for the same
 * scholars, so a page here and a page in the directory cannot disagree about
 * whether a person may be seen. LISTED_FILTER is run against a real database
 * too, because a filter that reads right and matches wrong (a missing field
 * treated as hidden, say) is the failure that would hide every scholar today.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { MongoClient } = require("mongodb");
const { MongoMemoryServer } = require("mongodb-memory-server");

const consent = require("../src/lib/scholarConsent");
const fixture = require("./fixtures/scholarConsent.json");

const HELPERS = ["isListed", "photoBasis", "visiblePhotoKey", "photoCredit", "communities", "showContact"];

for (const c of fixture.cases) {
  test(`contract: ${c.name}`, () => {
    for (const name of HELPERS) {
      assert.deepEqual(consent[name](c.scholar), c.expect[name], `${name} for ${c.scholar.profile_id}`);
    }
  });
}

test("every helper answers the safe default for no record at all", () => {
  for (const s of [null, undefined, {}]) {
    assert.equal(consent.isListed(s), true);
    assert.equal(consent.photoBasis(s), null);
    assert.equal(consent.visiblePhotoKey(s), null);
    assert.equal(consent.photoCredit(s), null);
    assert.deepEqual(consent.communities(s), []);
    assert.equal(consent.showContact(s), false);
  }
});

test("a withdrawn photo or community, recorded with a null basis, shows nothing", () => {
  /* What the studio writes on withdrawal: the layer kept, its basis gone. */
  const s = { display: { profile_image_object_key: "contemporary/x/headshot-aaaaaaaaaaaa.jpg" }, consent: { photo: { basis: null, objectKey: null }, community: { basis: null, values: [] }, contact: { show: false } } };
  assert.equal(consent.photoBasis(s), null);
  assert.equal(consent.visiblePhotoKey(s), null);
  assert.deepEqual(consent.communities(s), []);
  assert.equal(consent.showContact(s), false);
});

test("LISTED_FILTER matches exactly the scholars isListed says are listed", async (t) => {
  const server = await MongoMemoryServer.create();
  const client = await MongoClient.connect(server.getUri());
  t.after(async () => {
    await client.close();
    await server.stop();
  });
  const scholars = client.db("consent_helper_test").collection("scholars");
  await scholars.insertMany(fixture.cases.map((c) => ({ ...structuredClone(c.scholar), _id: c.scholar.profile_id })));
  /* Unhidden again by the scholar: listed, with a record that says so. */
  await scholars.insertOne({ _id: "s-unhidden", profile_id: "s-unhidden", consent: { listing: { state: "listed", reason: null } } });

  const matched = (await scholars.find(consent.LISTED_FILTER, { projection: { _id: 1 } }).toArray()).map((d) => d._id).sort();
  const expected = [...fixture.cases.filter((c) => c.expect.isListed).map((c) => c.scholar.profile_id), "s-unhidden"].sort();
  assert.deepEqual(matched, expected);
  assert.ok(!matched.includes("s-hidden"));
});
