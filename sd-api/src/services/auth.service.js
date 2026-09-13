const { env } = require("../config/env");
const { getCollections } = require("../db/mongo");
const { loginEmailCandidates } = require("../lib/loginEmail");
const { ApiError } = require("../lib/api-error");
const {
  assertStrongPassword,
  hashPassword,
  isPasswordReused,
  verifyPassword,
} = require("../lib/passwords");
const { serializeMongoValue } = require("../lib/serialize");
const { createSession, deleteSessionByToken, deleteSessionsForScholar, getSessionByToken, touchSession } = require("./session.service");
const { loadDefaultScholarRelated } = require("./scholar-context.service");

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function sanitizeCredential(credential) {
  return serializeMongoValue({
    _id: credential._id,
    scholar_id: credential.scholar_id,
    profile_id: credential.profile_id,
    login_email: credential.login_email,
    communities: Array.isArray(credential.communities) ? credential.communities : [],
    session_version: credential.session_version || 0,
    must_change_password: Boolean(credential.must_change_password),
    is_active: Boolean(credential.is_active),
    password_change_count: credential.password_change_count || 0,
    admin_password_change_count: credential.admin_password_change_count || 0,
    scholar_password_change_count: credential.scholar_password_change_count || 0,
    last_login_at: credential.last_login_at || null,
    last_reset_at: credential.last_reset_at || null,
    password_changed_at: credential.password_changed_at || null,
    failed_login_count: credential.failed_login_count || 0,
    locked_until: credential.locked_until || null,
    created_by: credential.created_by || null,
    updated_by: credential.updated_by || null,
    reset_by: credential.reset_by || null,
    createdAt: credential.createdAt || null,
    updatedAt: credential.updatedAt || null,
  });
}

async function findCredentialByEmail(credentialsCollection, email) {
  /* Canonical form first, the address as typed second: a row not yet migrated
     still resolves, and a scholar typing the old address is still recognised
     after migration. `$in` preserves neither order nor preference, so the two
     are tried in sequence. */
  const candidates = loginEmailCandidates(email);

  if (candidates.length === 0) {
    return null;
  }

  let directMatch = null;
  for (const candidate of candidates) {
    directMatch = await credentialsCollection.findOne({ login_email: candidate });
    if (directMatch) break;
  }
  const normalizedEmail = candidates[0];

  if (directMatch) {
    return directMatch;
  }

  return credentialsCollection.findOne({
    login_email: {
      $regex: `^${escapeRegExp(normalizedEmail)}$`,
      $options: "i",
    },
  });
}

function isLocked(credential) {
  return Boolean(credential.locked_until && new Date(credential.locked_until) > new Date());
}

async function registerFailedLogin(credentialsCollection, credential) {
  const nextFailedCount = (credential.failed_login_count || 0) + 1;
  const now = new Date();
  const update = {
    failed_login_count: nextFailedCount,
    updatedAt: now,
  };

  if (nextFailedCount >= env.authLockoutAttempts) {
    update.locked_until = new Date(
      now.getTime() + env.authLockoutMinutes * 60 * 1000,
    );
  }

  await credentialsCollection.updateOne(
    { _id: credential._id },
    { $set: update },
  );
}

async function registerSuccessfulLogin(credentialsCollection, credential) {
  const now = new Date();

  await credentialsCollection.updateOne(
    { _id: credential._id },
    {
      $set: {
        failed_login_count: 0,
        locked_until: null,
        last_login_at: now,
        updatedAt: now,
        updated_by: credential.profile_id || credential.scholar_id || "system",
      },
    },
  );

  return {
    ...credential,
    failed_login_count: 0,
    locked_until: null,
    last_login_at: now,
    updatedAt: now,
  };
}

async function loginScholar({ email, password, ipAddress, userAgent }) {
  if (!email || !password) {
    throw new ApiError(400, "Email and password are required.");
  }

  const { credentials } = await getCollections();
  const credential = await findCredentialByEmail(credentials, email);

  if (!credential) {
    throw new ApiError(401, "Invalid email or password.");
  }

  if (!credential.is_active) {
    throw new ApiError(403, "This scholar account is inactive.");
  }

  if (isLocked(credential)) {
    throw new ApiError(423, "Account is temporarily locked. Try again later.");
  }

  const passwordMatches = await verifyPassword(password, credential.password_hash);

  if (!passwordMatches) {
    await registerFailedLogin(credentials, credential);
    throw new ApiError(401, "Invalid email or password.");
  }

  const refreshedCredential = await registerSuccessfulLogin(credentials, credential);

  const { token, session } = await createSession({
    scholarId: refreshedCredential.scholar_id,
    profileId: refreshedCredential.profile_id,
    loginEmail: refreshedCredential.login_email,
    sessionVersion: refreshedCredential.session_version || 0,
    ipAddress,
    userAgent,
  });

  return {
    sessionToken: token,
    session: serializeMongoValue(session),
    user: sanitizeCredential(refreshedCredential),
    related: await loadDefaultScholarRelated(refreshedCredential),
  };
}

async function getAuthenticatedScholarBySessionToken(sessionToken, metadata = {}) {
  if (!sessionToken) {
    return null;
  }

  const session = await getSessionByToken(sessionToken);

  if (!session) {
    return null;
  }

  const { credentials } = await getCollections();
  const credential = await credentials.findOne({
    scholar_id: session.scholar_id,
    profile_id: session.profile_id,
  });

  if (!credential || !credential.is_active) {
    await deleteSessionByToken(sessionToken);
    return null;
  }

  if ((credential.session_version || 0) !== (session.session_version || 0)) {
    await deleteSessionByToken(sessionToken);
    return null;
  }

  await touchSession(session._id, metadata);

  return {
    session: serializeMongoValue(session),
    user: sanitizeCredential(credential),
    related: await loadDefaultScholarRelated(credential),
  };
}

async function logoutScholar(sessionToken) {
  if (!sessionToken) {
    return;
  }

  await deleteSessionByToken(sessionToken);
}

async function changePassword({
  scholarId,
  profileId,
  currentPassword,
  newPassword,
  ipAddress,
  userAgent,
}) {
  if (!currentPassword || !newPassword) {
    throw new ApiError(400, "Current password and new password are required.");
  }

  assertStrongPassword(newPassword);

  const { credentials } = await getCollections();
  const credential = await credentials.findOne({
    scholar_id: scholarId,
    profile_id: profileId,
  });

  if (!credential) {
    throw new ApiError(404, "Scholar credentials were not found.");
  }

  const currentPasswordMatches = await verifyPassword(
    currentPassword,
    credential.password_hash,
  );

  if (!currentPasswordMatches) {
    throw new ApiError(401, "Current password is incorrect.");
  }

  const usedBefore = await isPasswordReused(newPassword, [
    credential.password_hash,
    ...(credential.password_history_hashes || []),
  ]);

  if (usedBefore) {
    throw new ApiError(
      400,
      "New password must be different from the current password and recent passwords.",
    );
  }

  const passwordHash = await hashPassword(newPassword);
  const nextSessionVersion = (credential.session_version || 0) + 1;
  const now = new Date();
  const nextPasswordHistory = [
    credential.password_hash,
    ...(credential.password_history_hashes || []),
  ].slice(0, env.authPasswordHistoryLimit);

  await credentials.updateOne(
    { _id: credential._id },
    {
      $set: {
        password_hash: passwordHash,
        password_history_hashes: nextPasswordHistory,
        password_change_count: (credential.password_change_count || 0) + 1,
        scholar_password_change_count:
          (credential.scholar_password_change_count || 0) + 1,
        session_version: nextSessionVersion,
        must_change_password: false,
        password_changed_at: now,
        updatedAt: now,
        updated_by: profileId || scholarId,
        failed_login_count: 0,
        locked_until: null,
      },
    },
  );

  await deleteSessionsForScholar({ scholarId, profileId });

  const updatedCredential = await credentials.findOne({
    scholar_id: scholarId,
    profile_id: profileId,
  });

  const { token, session } = await createSession({
    scholarId,
    profileId,
    loginEmail: updatedCredential.login_email,
    sessionVersion: nextSessionVersion,
    ipAddress,
    userAgent,
  });

  return {
    sessionToken: token,
    session: serializeMongoValue(session),
    user: sanitizeCredential(updatedCredential),
    related: await loadDefaultScholarRelated(updatedCredential),
  };
}

module.exports = {
  changePassword,
  getAuthenticatedScholarBySessionToken,
  loginScholar,
  logoutScholar,
};
