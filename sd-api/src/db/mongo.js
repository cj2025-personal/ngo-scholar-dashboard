const { MongoClient } = require("mongodb");

const { env } = require("../config/env");

const COLLECTIONS = {
  credentials: "scholar_credentials",
  sessions: "scholar_sessions",
  scholarStories: "scholarstories",
  editorialImageAssets: "editorial_story_images",
  suggestions: "scholar_suggestions",
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

async function getDb() {
  const client = await getClient();
  return client.db(env.mongodbDb);
}

async function ensureIndexes() {
  if (!indexesPromise) {
    indexesPromise = (async () => {
      const db = await getDb();
      const credentials = db.collection(COLLECTIONS.credentials);
      const sessions = db.collection(COLLECTIONS.sessions);
      const scholarStories = db.collection(COLLECTIONS.scholarStories);
      const editorialImageAssets = db.collection(COLLECTIONS.editorialImageAssets);
      const suggestions = db.collection(COLLECTIONS.suggestions);

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
      await scholarStories.createIndex(
        { scholar_id: 1, updatedAt: -1 },
        { name: "idx_scholarstories_scholar_updated_at" },
      );
      await scholarStories.createIndex(
        { profile_id: 1, updatedAt: -1 },
        { name: "idx_scholarstories_profile_updated_at" },
      );
      await scholarStories.createIndex(
        { slug: 1 },
        { name: "slug_1" },
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
  connectToMongo,
  getCollections,
  getDb,
};
