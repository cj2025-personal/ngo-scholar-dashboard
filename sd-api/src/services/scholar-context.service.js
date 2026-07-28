const { env } = require("../config/env");
const { COLLECTIONS, getDb } = require("../db/mongo");
const { ApiError } = require("../lib/api-error");
const { serializeMongoValue } = require("../lib/serialize");

const BLOCKED_COLLECTIONS = new Set([
  COLLECTIONS.credentials,
  COLLECTIONS.sessions,
  "admin_sessions",
  "admin_users",
]);

function validateCollectionName(collectionName) {
  if (!/^[A-Za-z0-9_]+$/.test(collectionName)) {
    throw new ApiError(400, "Collection name is invalid.");
  }

  if (BLOCKED_COLLECTIONS.has(collectionName)) {
    throw new ApiError(403, "That collection is not available through scholar auth.");
  }

  if (
    env.authLinkableCollections.length > 0 &&
    !env.authLinkableCollections.includes(collectionName)
  ) {
    throw new ApiError(403, "That collection is not enabled for scholar linking.");
  }
}

async function ensureCollectionExists(db, collectionName) {
  const collections = await db
    .listCollections({ name: collectionName }, { nameOnly: true })
    .toArray();

  if (collections.length === 0) {
    throw new ApiError(404, `Collection "${collectionName}" was not found.`);
  }
}

function buildScholarScopedFilter({ scholarId, profileId }) {
  const clauses = [];

  if (scholarId) {
    clauses.push({ scholar_id: scholarId });
  }

  if (profileId) {
    clauses.push({ profile_id: profileId });
  }

  if (clauses.length === 0) {
    throw new ApiError(400, "Scholar context is missing scholar_id and profile_id.");
  }

  return {
    $or: clauses,
  };
}

async function loadLinkedRecords({
  collectionName,
  scholarId,
  profileId,
  mode = "many",
  limit = 10,
}) {
  validateCollectionName(collectionName);

  const db = await getDb();
  await ensureCollectionExists(db, collectionName);

  const collection = db.collection(collectionName);
  const filter = buildScholarScopedFilter({ scholarId, profileId });

  if (mode === "one") {
    const record = await collection.findOne(filter);
    return serializeMongoValue(record);
  }

  const normalizedLimit = Math.max(1, Math.min(Number(limit) || 10, 50));
  const records = await collection.find(filter).limit(normalizedLimit).toArray();

  return serializeMongoValue(records);
}

async function loadDefaultScholarRelated(credential) {
  const scholarRecord = await loadLinkedRecords({
    collectionName: "scholars",
    scholarId: credential.scholar_id,
    profileId: credential.profile_id,
    mode: "one",
  }).catch(() => null);

  return {
    scholars: scholarRecord,
  };
}

module.exports = {
  loadDefaultScholarRelated,
  loadLinkedRecords,
};
