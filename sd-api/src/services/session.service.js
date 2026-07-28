const { env } = require("../config/env");
const { getCollections } = require("../db/mongo");
const { hashToken, generateSessionToken } = require("../lib/tokens");
const { serializeMongoValue } = require("../lib/serialize");

function buildExpiryDate() {
  return new Date(Date.now() + env.authSessionTtlMs);
}

async function createSession({
  scholarId,
  profileId,
  loginEmail,
  sessionVersion,
  ipAddress,
  userAgent,
}) {
  const { sessions } = await getCollections();
  const token = generateSessionToken();
  const now = new Date();

  const sessionDocument = {
    scholar_id: scholarId,
    profile_id: profileId,
    login_email: loginEmail,
    session_version: sessionVersion || 0,
    token_hash: hashToken(token),
    ip_address: ipAddress || null,
    user_agent: userAgent || null,
    created_at: now,
    last_seen_at: now,
    expires_at: buildExpiryDate(),
  };

  const result = await sessions.insertOne(sessionDocument);

  return {
    token,
    session: serializeMongoValue({
      _id: result.insertedId,
      ...sessionDocument,
    }),
  };
}

async function getSessionByToken(token) {
  const { sessions } = await getCollections();
  const tokenHash = hashToken(token);
  const now = new Date();

  const session = await sessions.findOne({
    token_hash: tokenHash,
    expires_at: { $gt: now },
  });

  return session;
}

async function deleteSessionByToken(token) {
  const { sessions } = await getCollections();
  await sessions.deleteOne({ token_hash: hashToken(token) });
}

async function deleteSessionsForScholar({ scholarId, profileId }) {
  const { sessions } = await getCollections();
  await sessions.deleteMany({
    scholar_id: scholarId,
    profile_id: profileId,
  });
}

async function touchSession(sessionId, metadata = {}) {
  if (!sessionId) {
    return;
  }

  const { sessions } = await getCollections();
  const now = new Date();

  await sessions.updateOne(
    { _id: sessionId },
    {
      $set: {
        last_seen_at: now,
        ...(metadata.ipAddress ? { ip_address: metadata.ipAddress } : {}),
        ...(metadata.userAgent ? { user_agent: metadata.userAgent } : {}),
      },
    },
  );
}

module.exports = {
  createSession,
  deleteSessionByToken,
  deleteSessionsForScholar,
  getSessionByToken,
  touchSession,
};
