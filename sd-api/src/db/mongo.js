const { MongoClient } = require("mongodb");

const { env } = require("../config/env");
const { OWNER, WRITE_OPERATIONS, canWrite, ownerOf } = require("./ownership");

const COLLECTIONS = {
  credentials: "scholar_credentials",
  sessions: "scholar_sessions",
  scholarEditorials: "scholar_editorials",
  editorialImageAssets: "editorial_story_images",
  suggestions: "scholar_suggestions",
  /* One row per "Draft from my research" model call. Private to this service:
     not in the ownership manifest because nothing else reads it. */
  draftRuns: "scholar_draft_runs",
  /* One row per requested draft: idempotent, lease-locked, with its own
     event log. Owned here; listed in the shared manifest. */
  draftJobs: "scholar_draft_jobs",
  /* One row per instruction the scholar gives the story agent: the ask, the
     tool calls, the proposed change, and whether it was accepted. */
  storyTurns: "scholar_story_turns",
  /* One row per version of a story: the content as of that version, and who
     made it. What makes "put back the version before the agent touched it"
     possible, and what turns a lost write into a refusal the scholar sees. */
  storyRevisions: "scholar_editorial_revisions",
};

let clientPromise;
let indexesPromise;

function createClient() {
  return new MongoClient(env.mongodbUri);
}

async function getClient() {
  if (!clientPromise) {
    const client = createClient();
    clientPromise = client.connect();
  }

  return clientPromise;
}


/**
 * A database handle that refuses to write collections this service does not own.
 *
 * ── Why a proxy rather than a lint rule ────────────────────────────────────
 * The failure being prevented — `scholarstories` acquiring a second writer with
 * an incompatible shape — produced no error at all. Both writes succeeded; the
 * documents were simply unreadable by the other service. A guard that only runs
 * in CI can be outrun by a hotfix, and a convention in a comment can be missed
 * by anyone who did not read it. This throws at the call site, names the owner,
 * and cannot be bypassed by adding a new file.
 *
 * Reads pass through untouched. Reading another service's collection is normal
 * and necessary — this service reads `scholarstories` and `reading_passages` to
 * tell a scholar what is published about them.
 */
function guardCollection(collection, name) {
  return new Proxy(collection, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);

      if (typeof prop === "string" && WRITE_OPERATIONS.has(prop) && !canWrite(name)) {
        return () => {
          throw new Error(
            `sd-api may not ${prop} on "${name}" — that collection is owned by ` +
              `${ownerOf(name)}. Two services writing one collection with different ` +
              `shapes is what left scholarstories unreadable; ask the owner to expose ` +
              `an endpoint instead. See src/db/ownership.js.`,
          );
        };
      }

      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** Wraps `db` so every `.collection()` handle is guarded. */
function guardDb(db) {
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === "collection") {
        return (name, ...rest) => guardCollection(target.collection(name, ...rest), name);
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function getDb() {
  const client = await getClient();
  return guardDb(client.db(env.mongodbDb));
}

/** The unguarded handle, for index creation on collections this service owns. */
async function getRawDb() {
  const client = await getClient();
  return client.db(env.mongodbDb);
}

async function ensureIndexes() {
  if (!indexesPromise) {
    indexesPromise = (async () => {
      const db = await getRawDb();
      const credentials = db.collection(COLLECTIONS.credentials);
      const sessions = db.collection(COLLECTIONS.sessions);
      const scholarEditorials = db.collection(COLLECTIONS.scholarEditorials);
      const editorialImageAssets = db.collection(COLLECTIONS.editorialImageAssets);
      const suggestions = db.collection(COLLECTIONS.suggestions);
      const draftRuns = db.collection(COLLECTIONS.draftRuns);
      const draftJobs = db.collection(COLLECTIONS.draftJobs);

      // Enforce credential uniqueness idempotently, tolerating indexes that
      // already exist under Mongo's default names.
      const credentialIndexes = await credentials.indexes().catch(() => []);
      const findIndexByKey = (keySpec) =>
        credentialIndexes.find((index) => {
          const have = Object.keys(index.key || {});
          const want = Object.keys(keySpec);
          return (
            have.length === want.length && want.every((k) => index.key[k] === keySpec[k])
          );
        });

      // login_email — globally unique (a scholar's identity).
      const emailIndex = findIndexByKey({ login_email: 1 });
      if (emailIndex && !emailIndex.unique) {
        await credentials.dropIndex(emailIndex.name).catch(() => {});
      }
      if (!emailIndex || !emailIndex.unique) {
        await credentials.createIndex(
          { login_email: 1 },
          { unique: true, name: "idx_scholar_credentials_login_email_unique" },
        );
      }

      // One credential per scholar identity.
      const scholarIndex = findIndexByKey({ scholar_id: 1, profile_id: 1 });
      if (scholarIndex && !scholarIndex.unique) {
        await credentials.dropIndex(scholarIndex.name).catch(() => {});
      }
      if (!scholarIndex || !scholarIndex.unique) {
        await credentials.createIndex(
          { scholar_id: 1, profile_id: 1 },
          { unique: true, name: "idx_scholar_credentials_scholar_profile_unique" },
        );
      }

      await sessions.createIndex(
        { token_hash: 1 },
        { unique: true, name: "idx_scholar_sessions_token_hash_unique" },
      );
      await sessions.createIndex(
        { expires_at: 1 },
        { expireAfterSeconds: 0, name: "idx_scholar_sessions_expires_at_ttl" },
      );
      await sessions.createIndex(
        { scholar_id: 1, profile_id: 1 },
        { name: "idx_scholar_sessions_scholar_profile" },
      );
      /* `profile_id` is the canonical scholar identity, so this is the index
         every portal read uses. No `scholar_id` twin: nothing writes one to
         this collection, and an index over a field that is always the same
         value as another is a second copy of the first. */
      await scholarEditorials.createIndex(
        { profile_id: 1, updatedAt: -1 },
        { name: "idx_scholar_editorials_profile_updated_at" },
      );
      await scholarEditorials.createIndex(
        { slug: 1 },
        { unique: true, name: "idx_scholar_editorials_slug" },
      );
      await editorialImageAssets.createIndex(
        { scholar_id: 1, profile_id: 1, uploaded_at: -1 },
        { name: "idx_editorial_story_images_scholar_profile_uploaded_at" },
      );
      await editorialImageAssets.createIndex(
        { story_id: 1, status: 1, kind: 1, uploaded_at: -1 },
        { name: "idx_editorial_story_images_story_status_kind_uploaded_at" },
      );
      await editorialImageAssets.createIndex(
        { bucket_name: 1, object_name: 1 },
        { unique: true, name: "idx_editorial_story_images_bucket_object_unique" },
      );

      // Profile edit-suggestions, categorized by professor (profile_id) with a
      // community dimension so this scales to community-specific dashboards.
      await suggestions.createIndex(
        { profile_id: 1, created_at: -1 },
        { name: "idx_scholar_suggestions_profile_created_at" },
      );
      await suggestions.createIndex(
        { scholar_id: 1, created_at: -1 },
        { name: "idx_scholar_suggestions_scholar_created_at" },
      );
      await suggestions.createIndex(
        { communities: 1, created_at: -1 },
        { name: "idx_scholar_suggestions_communities_created_at" },
      );
      await suggestions.createIndex(
        { community: 1, profile_id: 1, created_at: -1 },
        { name: "idx_scholar_suggestions_community_profile_created_at" },
      );
      await suggestions.createIndex(
        { status: 1, created_at: -1 },
        { name: "idx_scholar_suggestions_status_created_at" },
      );

      // Draft runs: "what has this scholar drafted, most recent first" is the
      // only read; everything else about the row is audit.
      await draftRuns.createIndex(
        { profile_id: 1, started_at: -1 },
        { name: "idx_scholar_draft_runs_profile_started_at" },
      );

      // Draft jobs. The unique key is what makes "the same request twice"
      // return one job; the status index is the worker's claim query; the
      // profile index is the composer's list and the daily-cap count.
      await draftJobs.createIndex(
        { idempotency_key: 1 },
        { unique: true, name: "idx_scholar_draft_jobs_idempotency_key" },
      );
      await draftJobs.createIndex(
        { status: 1, lease_expires_at: 1, created_at: 1 },
        { name: "idx_scholar_draft_jobs_status_lease_created" },
      );
      await draftJobs.createIndex(
        { profile_id: 1, created_at: -1 },
        { name: "idx_scholar_draft_jobs_profile_created" },
      );
      await db.collection(COLLECTIONS.storyTurns).createIndex(
        { story_id: 1, created_at: -1 },
        { name: "idx_scholar_story_turns_story_created" },
      );
      await db.collection(COLLECTIONS.storyRevisions).createIndex(
        { story_id: 1, version: -1 },
        { name: "idx_scholar_editorial_revisions_story_version", unique: true },
      );
    })();
  }

  return indexesPromise;
}

async function connectToMongo() {
  await getClient();
  await ensureIndexes();
}

async function getCollections() {
  const db = await getDb();

  return {
    db,
    credentials: db.collection(COLLECTIONS.credentials),
    sessions: db.collection(COLLECTIONS.sessions),
    suggestions: db.collection(COLLECTIONS.suggestions),
  };
}

module.exports = {
  COLLECTIONS,
  getRawDb,
  connectToMongo,
  getCollections,
  getDb,
};
