/**
 * A scholar's own consent layers, from the studio (services/consent.service,
 * routes/profile.routes /consent), and what hiding does to the public reads
 * of their stories (lib/publicStory), 2026-11-09.
 *
 * What is held here:
 *   - each action writes `scholars.consent.<layer>` and exactly one
 *     `scholar_consent_events` row, in one transaction, and an event that
 *     cannot be written fails the change;
 *   - a click that changes nothing writes nothing;
 *   - only the signed-in scholar's own record can change: no id in the body
 *     or the query is read;
 *   - a hidden scholar's stories are absent from every public read (404, as if
 *     they never existed) while the scholar's studio still has them all, and
 *     unhiding brings them back unchanged;
 *   - the headshot archive proxy serves a photo to its owner alone.
 *
 * A throwaway single-node replica set (mongodb-memory-server), because the
 * writes are transactional; the real routes, real sessions and the guarded
 * database handle, so the ownership guard's field grant is exercised too.
 */
const crypto = require("crypto");
const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("stream");
const { MongoClient, ObjectId } = require("mongodb");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const A = "consent-scholar-a";
const B = "consent-scholar-b";
const NO_PHOTO = "consent-scholar-c";
const A_PHOTO = `contemporary/${A}/headshot-0123456789ab.jpg`;
const A_ARCHIVE = `profiles/${A}/profile.jpg`;
const B_ARCHIVE = `profiles/${B}/profile.jpg`;
const A_IMAGE = new ObjectId();

let replSet;
let client;
let db;
let server;
let base;
const tokens = {};
let consentService;
let consent;
let reader;

const sha = (t) => crypto.createHash("sha256").update(t).digest("hex");

test.before(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await replSet.waitUntilRunning();
  const uri = replSet.getUri();
  const dbName = `sd_consent_${crypto.randomBytes(4).toString("hex")}`;
  /* Before anything under src/ is required: config/env reads these once. */
  process.env.MONGODB_URI = uri;
  process.env.MONGODB_DB = dbName;
  process.env.LLM_PROVIDER = "fake";
  process.env.NODE_ENV = "test";

  client = await MongoClient.connect(uri);
  db = client.db(dbName);
  const now = new Date();
  const expires = new Date(now.getTime() + 3600_000);
  await db.collection("scholars").insertMany([
    {
      _id: A, profile_id: A, name: { display: "Ada Consent" },
      about: { race: "Latino", race_status: "approved", email: "ada@uni.example", office_location: "Hall 3, Room 12" },
      display: { profile_image_object_key: A_PHOTO },
      faculty_image: { proxy_url: `/api/images/${A_ARCHIVE}` },
    },
    { _id: B, profile_id: B, name: { display: "Ben Other" }, faculty_image: { proxy_url: `/api/images/${B_ARCHIVE}` } },
    { _id: NO_PHOTO, profile_id: NO_PHOTO, name: { display: "Cy Initials" } },
  ]);
  for (const id of [A, B, NO_PHOTO]) {
    tokens[id] = crypto.randomBytes(48).toString("base64url");
    await db.collection("scholar_credentials").insertOne({ scholar_id: id, profile_id: id, login_email: `${id}@example.edu`, is_active: true, session_version: 0, password_hash: "x" });
    await db.collection("scholar_sessions").insertOne({ scholar_id: id, profile_id: id, login_email: `${id}@example.edu`, session_version: 0, token_hash: sha(tokens[id]), created_at: now, last_seen_at: now, expires_at: expires });
  }
  await db.collection("scholar_editorials").insertMany([
    { profile_id: A, slug: "ada-published", status: "published", title: "Ada's published story", published_at: now, images: [{ file_id: A_IMAGE }], evidence: { manifest: { totals: {} }, signature: "x", key_id: "k", signed: false } },
    { profile_id: B, slug: "ben-published", status: "published", title: "Ben's published story", published_at: now },
  ]);
  /* An illustration in the story, held by the in-memory stand-in for the bucket. */
  await db.collection("editorial_story_images").insertOne({ _id: A_IMAGE, status: "active", bucket_name: "editorial-images", object_name: `stories/${A}/a.png`, content_type: "image/png" });

  const express = require("express");
  const cookieParser = require("cookie-parser");
  const { connectToMongo } = require("../src/db/mongo");
  const { errorHandler, notFoundHandler } = require("../src/middleware/error.middleware");
  /* Every index this service creates, the consent events' among them. */
  await connectToMongo();
  consentService = require("../src/services/consent.service");
  consent = require("../src/lib/scholarConsent");
  reader = require("../src/services/reader.service");

  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use("/api/profile", require("../src/routes/profile.routes"));
  app.use("/api/editorial-stories", require("../src/routes/editorial.routes"));
  app.use("/api/images", require("../src/routes/images"));
  app.use(notFoundHandler);
  app.use(errorHandler);
  server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
  const { closeMongo } = require("../src/db/mongo");
  await closeMongo();
  /* Only this run's throwaway database. */
  await db?.dropDatabase();
  await client?.close();
  await replSet?.stop();
});

async function call(as, method, path, body) {
  const headers = { "content-type": "application/json" };
  if (as) headers.cookie = `sd_session=${tokens[as]}`;
  const res = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const type = res.headers.get("content-type") || "";
  return { status: res.status, headers: res.headers, body: type.includes("json") ? await res.json() : Buffer.from(await res.arrayBuffer()) };
}

const scholarDoc = (id) => db.collection("scholars").findOne({ _id: id });
const eventsOf = (id) => db.collection("scholar_consent_events").find({ profileId: id }).sort({ at: 1, _id: 1 }).toArray();

test("signed out, there is nothing to read or change", async () => {
  assert.equal((await call(null, "GET", "/api/profile/consent")).status, 401);
  assert.equal((await call(null, "POST", "/api/profile/consent/listing", { action: "hide" })).status, 401);
});

test("before anything is chosen: the safe defaults, the registry's communities, and what would be shown", async () => {
  const { status, body, headers } = await call(A, "GET", "/api/profile/consent");
  assert.equal(status, 200);
  assert.equal(headers.get("cache-control"), "no-store");
  assert.equal(body.consent.listing.listed, true);
  assert.deepEqual([body.consent.photo.shown, body.consent.photo.basis, body.consent.photo.hasPhoto], [false, null, true]);
  assert.deepEqual(body.consent.community.values, [], "the inferred label on the record is not a community");
  assert.equal(body.consent.contact.shown, false);
  assert.deepEqual(body.consent.contact.details, { email: "ada@uni.example", phone: null, office: "Hall 3, Room 12" });
  assert.deepEqual(body.communities.map((c) => c.key), ["black", "latino", "asian", "indigenous"]);
  assert.deepEqual(body.history, []);
  assert.ok(!JSON.stringify(body).includes("Latino\""), "the inferred race is never sent");
});

test("photo: granted for the current photo, once, then withdrawn; each change is one event", async () => {
  const granted = await call(A, "POST", "/api/profile/consent/photo", { action: "grant" });
  assert.equal(granted.status, 200);
  assert.equal(granted.body.changed, true);
  assert.equal(granted.body.consent.photo.shown, true);
  let doc = await scholarDoc(A);
  assert.equal(doc.consent.photo.basis, "scholar");
  assert.equal(doc.consent.photo.objectKey, null, "the basis covers the current display photo");
  assert.deepEqual(doc.consent.photo.by, { kind: "scholar", id: A });
  assert.equal(consent.visiblePhotoKey(doc), A_PHOTO);
  let events = await eventsOf(A);
  assert.equal(events.length, 1);
  assert.deepEqual([events[0].layer, events[0].action, events[0].source], ["photo", "grant", "studio"]);
  assert.deepEqual(events[0].value, doc.consent.photo, "the event holds the new value");
  assert.deepEqual(events[0].by, { kind: "scholar", id: A });
  assert.equal(new Date(events[0].at).getTime(), new Date(doc.consent.photo.at).getTime());

  const again = await call(A, "POST", "/api/profile/consent/photo", { action: "grant" });
  assert.equal(again.body.changed, false);
  assert.equal((await eventsOf(A)).length, 1, "turning on what is on writes nothing");

  const withdrawn = await call(A, "POST", "/api/profile/consent/photo", { action: "withdraw" });
  assert.equal(withdrawn.body.consent.photo.shown, false);
  doc = await scholarDoc(A);
  assert.equal(doc.consent.photo.basis, null);
  assert.equal(consent.visiblePhotoKey(doc), null);
  assert.equal(doc.display.profile_image_object_key, A_PHOTO, "the photo itself is kept");
  events = await eventsOf(A);
  assert.deepEqual(events.map((e) => e.action), ["grant", "withdraw"]);
  assert.deepEqual(withdrawn.body.history.map((h) => [h.layer, h.action, h.by]), [["photo", "withdraw", "scholar"], ["photo", "grant", "scholar"]], "newest first");
});

test("photo: with no photo on the record there is nothing to grant", async () => {
  const res = await call(NO_PHOTO, "POST", "/api/profile/consent/photo", { action: "grant" });
  assert.equal(res.status, 409);
  assert.equal((await scholarDoc(NO_PHOTO)).consent, undefined);
  assert.equal((await eventsOf(NO_PHOTO)).length, 0);
});

test("community: self-identified from the registry, in its order; anything else refused; withdrawn", async () => {
  assert.equal((await call(A, "POST", "/api/profile/consent/community", { action: "grant", values: ["martian"] })).status, 400);
  assert.equal((await call(A, "POST", "/api/profile/consent/community", { action: "grant", values: [] })).status, 400);
  assert.equal((await call(A, "POST", "/api/profile/consent/community", { action: "grant", values: "black" })).status, 400);
  assert.equal((await eventsOf(A)).filter((e) => e.layer === "community").length, 0);

  const res = await call(A, "POST", "/api/profile/consent/community", { action: "grant", values: ["latino", "Black", "black"] });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.consent.community.values, ["black", "latino"]);
  let doc = await scholarDoc(A);
  assert.deepEqual(doc.consent.community, { basis: "self_identified", values: ["black", "latino"], at: doc.consent.community.at, by: { kind: "scholar", id: A } });
  assert.deepEqual(consent.communities(doc), ["black", "latino"]);
  assert.equal(doc.about.race, "Latino", "the inferred label stays stored, unread");

  assert.equal((await call(A, "POST", "/api/profile/consent/community", { action: "grant", values: ["black", "latino"] })).body.changed, false);
  await call(A, "POST", "/api/profile/consent/community", { action: "grant", values: ["indigenous"] });
  const off = await call(A, "POST", "/api/profile/consent/community", { action: "withdraw" });
  assert.deepEqual(off.body.consent.community.values, []);
  doc = await scholarDoc(A);
  assert.deepEqual(consent.communities(doc), []);
  const rows = (await eventsOf(A)).filter((e) => e.layer === "community");
  assert.deepEqual(rows.map((e) => [e.action, e.value.values]), [["grant", ["black", "latino"]], ["grant", ["indigenous"]], ["withdraw", []]]);
  assert.ok(rows.every((e) => !JSON.stringify(e).includes("race")), "never the inferred race");
});

test("contact: shown, then hidden", async () => {
  const on = await call(A, "POST", "/api/profile/consent/contact", { action: "grant" });
  assert.equal(on.body.consent.contact.shown, true);
  assert.equal(consent.showContact(await scholarDoc(A)), true);
  const off = await call(A, "POST", "/api/profile/consent/contact", { action: "withdraw" });
  assert.equal(off.body.consent.contact.shown, false);
  assert.deepEqual((await scholarDoc(A)).consent.contact.show, false);
  assert.deepEqual((await eventsOf(A)).filter((e) => e.layer === "contact").map((e) => e.action), ["grant", "withdraw"]);
});

test("unknown settings and actions are refused without writing", async () => {
  const before = (await eventsOf(A)).length;
  assert.equal((await call(A, "POST", "/api/profile/consent/race", { action: "grant" })).status, 404);
  assert.equal((await call(A, "POST", "/api/profile/consent/listing", { action: "grant" })).status, 400);
  assert.equal((await call(A, "POST", "/api/profile/consent/photo", { action: "hide" })).status, 400);
  assert.equal((await eventsOf(A)).length, before);
});

test("listing: a hidden scholar's stories are absent from every public read, and still theirs in the studio", async () => {
  assert.equal((await call(null, "GET", "/api/editorial-stories/public/slug/ada-published")).status, 200);
  assert.equal((await call(null, "GET", "/api/editorial-stories/public/slug/ada-published/evidence")).status, 200);
  assert.equal((await call(null, "GET", `/api/editorial-stories/public/images/${A_IMAGE}`)).status, 200);

  const hidden = await call(A, "POST", "/api/profile/consent/listing", { action: "hide" });
  assert.equal(hidden.status, 200);
  assert.equal(hidden.body.consent.listing.listed, false);
  const doc = await scholarDoc(A);
  assert.deepEqual([doc.consent.listing.state, doc.consent.listing.reason, doc.consent.listing.requestId], ["hidden", "scholar_request", null]);
  assert.equal(consent.isListed(doc), false);

  /* Every public read of the story, by slug. */
  assert.equal((await call(null, "GET", "/api/editorial-stories/public/slug/ada-published")).status, 404);
  assert.equal((await call(null, "GET", "/api/editorial-stories/public/slug/ada-published/evidence")).status, 404);
  assert.equal((await call(null, "GET", "/api/editorial-stories/public/slug/ada-published/passages")).status, 404);
  assert.equal((await call(null, "GET", `/api/editorial-stories/public/images/${A_IMAGE}`)).status, 404, "nor its illustrations");
  await assert.rejects(reader.listStoryTurns({ slug: "ada-published", readerKey: "r".repeat(32) }), (e) => e.statusCode === 404, "the reading companion does not know it");
  assert.equal((await call(B, "GET", "/api/editorial-stories/public/slug/ada-published")).status, 404, "nor does another scholar");
  const read = await call(null, "POST", "/api/editorial-stories/public/slug/ada-published/read");
  assert.equal(read.status, 204);
  assert.equal(await db.collection("scholar_story_reads").countDocuments({ profile_id: A }), 0, "a read of a hidden scholar's story is not counted");
  /* Someone else's, listed, is untouched. */
  assert.equal((await call(null, "GET", "/api/editorial-stories/public/slug/ben-published")).status, 200);

  /* The scholar's own studio still has everything. */
  const studio = await call(A, "GET", "/api/editorial-stories");
  assert.equal(studio.status, 200);
  assert.ok(studio.body.stories.some((s) => s.slug === "ada-published"));
  assert.equal((await call(A, "GET", "/api/profile/me")).status, 200);
  assert.equal((await call(A, "GET", "/api/profile/consent")).status, 200);

  /* Unhidden: back exactly as it was. */
  const shown = await call(A, "POST", "/api/profile/consent/listing", { action: "unhide" });
  assert.equal(shown.body.consent.listing.listed, true);
  assert.equal((await scholarDoc(A)).consent.listing.state, "listed");
  const back = await call(null, "GET", "/api/editorial-stories/public/slug/ada-published");
  assert.equal(back.status, 200);
  assert.equal(back.body.story.title, "Ada's published story");
  assert.deepEqual((await eventsOf(A)).filter((e) => e.layer === "listing").map((e) => e.action), ["hide", "unhide"]);
});

test("a scholar can change only their own record, whatever the request names", async () => {
  const bBefore = await scholarDoc(B);
  const res = await call(A, "POST", `/api/profile/consent/listing?profileId=${B}&profile_id=${B}`, { action: "hide", profileId: B, profile_id: B, scholarId: B });
  assert.equal(res.status, 200);
  assert.equal((await scholarDoc(A)).consent.listing.state, "hidden", "the session's scholar changed");
  assert.deepEqual(await scholarDoc(B), bBefore, "the named one did not");
  assert.equal((await eventsOf(B)).length, 0);
  assert.equal((await call(null, "GET", "/api/editorial-stories/public/slug/ben-published")).status, 200);

  const theirs = await call(B, "GET", `/api/profile/consent?profileId=${A}`);
  assert.equal(theirs.body.consent.listing.listed, true, "B reads B's own state");
  assert.deepEqual(theirs.body.history, [], "and none of A's history");
  await call(A, "POST", "/api/profile/consent/listing", { action: "unhide" });
});

test("an event that cannot be written fails the change, and nothing is left half-done", async () => {
  /* Its own database, whose events collection refuses every row. */
  const failing = client.db(`sd_consent_fail_${crypto.randomBytes(3).toString("hex")}`);
  await failing.collection("scholars").insertOne({ _id: "f1", profile_id: "f1", display: { profile_image_object_key: "contemporary/f1/headshot-0123456789ab.jpg" } });
  await failing.createCollection("scholar_consent_events", { validator: { profileId: { $exists: false } }, validationAction: "error" });
  try {
    await assert.rejects(consentService.changeConsent(failing, { profileId: "f1", layer: "photo", action: "grant" }), (e) => e.code === 121, "refused by the events collection's validator");
    const doc = await failing.collection("scholars").findOne({ _id: "f1" });
    assert.equal(doc.consent, undefined, "no consent without its proof");
    assert.equal(await failing.collection("scholar_consent_events").countDocuments(), 0);
  } finally {
    await failing.dropDatabase();
  }
});

test("a change made elsewhere while the page was open is not overwritten", async () => {
  /* Staff hide the contact details between the scholar's page loading and
     their click landing: the scholar's write must not go through on top. */
  const raced = new Proxy(db, {
    get(target, prop) {
      if (prop !== "collection") return Reflect.get(target, prop);
      return (name) => {
        const coll = target.collection(name);
        if (name !== "scholars") return coll;
        return new Proxy(coll, {
          get(c, p) {
            if (p !== "updateOne") return typeof c[p] === "function" ? c[p].bind(c) : c[p];
            return async (...args) => {
              await target.collection("scholars").updateOne({ _id: B }, { $set: { "consent.contact": { show: false, at: new Date(), by: { kind: "staff", id: "admin" } } } });
              return c.updateOne(...args);
            };
          },
        });
      };
    },
  });
  const before = (await eventsOf(B)).length;
  await assert.rejects(consentService.changeConsent(raced, { profileId: B, layer: "contact", action: "grant" }), (e) => e.statusCode === 409);
  assert.equal((await scholarDoc(B)).consent.contact.by.kind, "staff", "staff's value stands");
  assert.equal((await eventsOf(B)).length, before, "and no event claims a change that did not happen");
});

test("the panel's photo: the scholar's own, private, from the bucket its key names", async () => {
  const asked = [];
  const storage = {
    bucket: (name) => ({ file: (key) => ({ createReadStream: () => { asked.push([name, key]); return Readable.from([Buffer.from("jpeg-bytes")]); } }) }),
  };
  const res = { headers: {}, chunks: [], set(k, v) { this.headers[k] = v; }, write(c) { this.chunks.push(c); }, end() { this.ended = true; }, destroy() {} };
  await consentService.streamOwnPhoto(db, A, res, { storage });
  assert.deepEqual(asked, [["scholar-headshots", A_PHOTO]]);
  assert.equal(res.headers["Content-Type"], "image/jpeg");
  assert.equal(res.headers["Cache-Control"], "private, no-store");
  assert.equal(Buffer.concat(res.chunks).toString(), "jpeg-bytes");
  await assert.rejects(consentService.streamOwnPhoto(db, NO_PHOTO, res, { storage }), (e) => e.statusCode === 404);
  /* Over HTTP, signed out: nothing. */
  assert.equal((await call(null, "GET", "/api/profile/consent/photo")).status, 401);
});

test("the headshot archive proxy serves a photo to its owner and to nobody else", async () => {
  const { s3Client } = require("../src/config/s3");
  const original = s3Client.send;
  s3Client.send = async () => ({ ContentType: "image/jpeg", Body: Readable.from([Buffer.from("archive-bytes")]) });
  try {
    assert.equal((await call(null, "GET", `/api/images/${A_ARCHIVE}`)).status, 404, "not to the public");
    assert.equal((await call(B, "GET", `/api/images/${A_ARCHIVE}`)).status, 404, "not to another scholar");
    const own = await call(A, "GET", `/api/images/${A_ARCHIVE}`);
    assert.equal(own.status, 200);
    assert.equal(own.body.toString(), "archive-bytes");
    assert.match(own.headers.get("cache-control"), /^private/);
    assert.equal((await call(A, "GET", "/api/images/profiles/../secret")).status, 400);
  } finally {
    s3Client.send = original;
  }
});

test("the guarded handle lets the consent layer through and nothing else on the curated record", async () => {
  const { getDb } = require("../src/db/mongo");
  const scholars = (await getDb()).collection("scholars");
  assert.throws(() => scholars.updateOne({ _id: A }, { $set: { "name.display": "Someone else" } }), /beyond the fields granted/);
  assert.throws(() => scholars.updateOne({ _id: A }, { $set: { consent: {} } }), /beyond the fields granted/);
  assert.throws(() => scholars.updateOne({ _id: "new" }, { $set: { "consent.photo": {} } }, { upsert: true }), /beyond the fields granted/);
  assert.throws(() => scholars.replaceOne({ _id: A }, {}), /may not replaceOne/);
  assert.throws(() => scholars.deleteOne({ _id: A }), /may not deleteOne/);
  assert.equal((await scholarDoc(A)).name.display, "Ada Consent");
});

test("an events index already made under another name is the same index, not a startup failure", async () => {
  /* The admin portal creates the SPEC's index too; mongo.js tolerates exactly this error. */
  const probe = client.db(`sd_consent_probe_${crypto.randomBytes(3).toString("hex")}`);
  try {
    await probe.collection("scholar_consent_events").createIndex({ profileId: 1, at: -1 }, { name: "by_profile_newest" });
    await assert.rejects(probe.collection("scholar_consent_events").createIndex({ profileId: 1, at: -1 }), (e) => e.code === 85 || e.code === 86);
  } finally {
    await probe.dropDatabase();
  }
  const indexes = await db.collection("scholar_consent_events").indexes();
  assert.ok(indexes.some((i) => JSON.stringify(i.key) === JSON.stringify({ profileId: 1, at: -1 })), "made at startup");
});
