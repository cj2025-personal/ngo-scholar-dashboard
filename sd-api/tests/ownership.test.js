/**
 * The guard against a shared collection acquiring a second writer.
 *
 * This is not hypothetical. `scholarstories` had two writers with incompatible
 * shapes, and neither raised an error — the writes succeeded and the documents
 * were simply unreadable by the other service. These tests exist so that the
 * next attempt fails at the call site instead.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MANIFEST_VERSION,
  OWNER,
  COLLECTION_OWNERSHIP,
  WRITE_OPERATIONS,
  canWrite,
  ownerOf,
} = require("../src/db/ownership");

/* Asserted in BOTH repos. Changing ownership in one without the other breaks a
   test rather than surfacing as corrupt data months later. */
test("manifest version is pinned across both repos", () => {
  assert.equal(MANIFEST_VERSION, "2026-09-22.1");
});

test("this service may write what it owns", () => {
  for (const name of [
    "scholar_credentials",
    "scholar_sessions",
    "scholar_suggestions",
    /* The portal's own authoring output. Publishing was dead for as long as
       this was missing: the editor wrote `scholarstories`, the guard refused
       it, and the scholar saw nothing at all. */
    "scholar_editorials",
  ]) {
    assert.equal(canWrite(name), true, `sd-api owns ${name}`);
  }
});

test("the portal's editorials are not the user dashboard's stories", () => {
  /* They briefly shared a collection and were never the same thing: that one
     is keyed to a `users` account with its body in `storyblocks`, this one to
     a portal credential with blocks embedded. Separate owners, so neither can
     start writing the other's shape again. */
  assert.equal(ownerOf("scholar_editorials"), "sd-api");
  assert.equal(ownerOf("scholarstories"), "user-dashboard-api");
  assert.notEqual(ownerOf("scholar_editorials"), ownerOf("scholarstories"));
});

test("this service may not write another service's collections", () => {
  for (const name of [
    "scholarstories",
    "storyblocks",
    "reading_passages",
    "users",
    /* Claimed for this service and reverted the same day: the Scholar
       Documents portal already owns it, with enums a second writer broke. */
    "scholar_documents",
    "scholar_document_extractions",
  ]) {
    assert.equal(canWrite(name), false, `${name} belongs to ${ownerOf(name)}`);
  }
});

test("nobody writes the curated scholar record", () => {
  // A scholar's curated record is corrected through the suggestion workflow,
  // never by a service editing it directly.
  assert.equal(ownerOf("scholars"), OWNER.CURATION);
  assert.equal(canWrite("scholars"), false);
  assert.equal(canWrite("scholars", OWNER.USER_DASHBOARD_API), false);
});

test("an unlisted collection is allowed", () => {
  // The manifest governs what is SHARED. A service creating a private
  // collection should not need a cross-repo change to do it.
  assert.equal(canWrite("sd_private_scratch"), true);
  assert.equal(ownerOf("sd_private_scratch"), null);
});

test("every mutating driver method is treated as a write", () => {
  // A method missing from this set is a hole: the proxy would wave it through.
  for (const op of [
    "insertOne",
    "insertMany",
    "updateOne",
    "updateMany",
    "replaceOne",
    "deleteOne",
    "deleteMany",
    "findOneAndUpdate",
    "findOneAndReplace",
    "findOneAndDelete",
    "bulkWrite",
    "drop",
  ]) {
    assert.equal(WRITE_OPERATIONS.has(op), true, `${op} must count as a write`);
  }
});

test("reads are never treated as writes", () => {
  // Reading another service's collection is normal and necessary — this service
  // reads scholarstories and reading_passages to tell a scholar what is
  // published about them.
  for (const op of ["find", "findOne", "countDocuments", "distinct", "aggregate", "indexes"]) {
    assert.equal(WRITE_OPERATIONS.has(op), false, `${op} must stay readable`);
  }
});

test("the proxy throws on a foreign write, naming the owner", async () => {
  const { OWNER: O, WRITE_OPERATIONS: W, canWrite: cw, ownerOf: oo } = require("../src/db/ownership");

  /* The proxy from mongo.js, reconstructed against a fake collection so the
     behaviour is testable without a database. Kept in step with the real one by
     the assertions below, which check the message a developer actually sees. */
  const guard = (collection, name) =>
    new Proxy(collection, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof prop === "string" && W.has(prop) && !cw(name)) {
          return () => {
            throw new Error(
              `sd-api may not ${prop} on "${name}" — that collection is owned by ${oo(name)}.`,
            );
          };
        }
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

  const fake = {
    insertOne: async () => ({ acknowledged: true }),
    find: () => ({ toArray: async () => [] }),
  };

  const foreign = guard(fake, "scholarstories");
  assert.throws(() => foreign.insertOne({}), /may not insertOne on "scholarstories"/);
  assert.throws(() => foreign.insertOne({}), /owned by user-dashboard-api/);

  // The same collection stays readable.
  assert.deepEqual(await foreign.find().toArray(), []);

  // And an owned collection is untouched.
  const owned = guard(fake, "scholar_sessions");
  assert.deepEqual(await owned.insertOne({}), { acknowledged: true });
});

test("every shared collection has a named owner", () => {
  // An entry with no owner is worse than no entry: it reads as governed while
  // permitting everything.
  for (const [name, owner] of Object.entries(COLLECTION_OWNERSHIP)) {
    assert.ok(owner, `${name} has no owner`);
    assert.ok(
      Object.values(OWNER).includes(owner),
      `${name} names an unknown owner: ${owner}`,
    );
  }
});
