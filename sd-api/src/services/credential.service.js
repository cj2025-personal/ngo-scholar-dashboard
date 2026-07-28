const crypto = require("crypto");

const { env } = require("../config/env");
const { getCollections, getDb } = require("../db/mongo");
const { ApiError } = require("../lib/api-error");
const { assertStrongPassword, hashPassword } = require("../lib/passwords");
const { serializeMongoValue } = require("../lib/serialize");
const { deleteSessionsForScholar } = require("./session.service");

const SCHOLAR_EMAIL_DOMAIN = (
  process.env.SCHOLAR_EMAIL_DOMAIN || "scholars.archivyn.com"
)
  .trim()
  .replace(/^@+/, "")
  .toLowerCase();

// Ambiguity-free character sets for generated temp passwords (no 0/O/1/l/I).
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function pickFrom(set) {
  return set[crypto.randomInt(set.length)];
}

/** Strong 16-char temp password that satisfies the password policy. */
function generateTempPassword() {
  const all = LOWER + UPPER + DIGITS;
  const chars = [pickFrom(LOWER), pickFrom(UPPER), pickFrom(DIGITS), pickFrom(DIGITS)];
  while (chars.length < 16) {
    chars.push(pickFrom(all));
  }
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

function scholarDisplayName(scholar) {
  const name = scholar?.name || {};
  return (
    name.full ||
    name.display ||
    scholar?.professor_name ||
    "Scholar"
  );
}

function slugifyName(name) {
  return String(name || "")
    .replace(/^(Dr\.|Prof\.?|Sir|Mr\.|Ms\.|Mrs\.)\s*/i, "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .replace(/\.{2,}/g, ".");
}

/** Deterministic, unique login email derived from the scholar's name + id. */
function generateLoginEmail(scholar) {
  const slug = slugifyName(scholarDisplayName(scholar)) || "scholar";
  const idSuffix = String(scholar?._id || scholar?.profile_id || "")
    .replace(/-/g, "")
    .slice(0, 8);
  const local = idSuffix ? `${slug}.${idSuffix}` : slug;
  return `${local}@${SCHOLAR_EMAIL_DOMAIN}`;
}

/** Resolve a scholar record from the `scholars` collection by its UUID (_id or profile_id). */
async function resolveScholar(scholarUuid) {
  const id = String(scholarUuid || "").trim();
  if (!id) {
    throw new ApiError(400, "A scholar id is required.");
  }
  const db = await getDb();
  const scholar = await db
    .collection("scholars")
    .findOne({ $or: [{ _id: id }, { profile_id: id }] });

  if (!scholar) {
    throw new ApiError(404, `No scholar found for id "${id}".`);
  }
  return scholar;
}

function sanitizeCredential(credential) {
  return serializeMongoValue({
    _id: credential._id,
    scholar_id: credential.scholar_id,
    profile_id: credential.profile_id,
    login_email: credential.login_email,
    communities: credential.communities || [],
    is_active: Boolean(credential.is_active),
    must_change_password: Boolean(credential.must_change_password),
    session_version: credential.session_version || 0,
    created_by: credential.created_by || null,
    createdAt: credential.createdAt || null,
    updatedAt: credential.updatedAt || null,
  });
}

/**
 * Create (or reset with `force`) a scholar credential mapped to an existing
 * scholar's unique id. Credentials are generated out-of-band and distributed
 * separately, so we return the one-time temp password when we generate it.
 *
 * @returns {{ status: "created"|"reset"|"exists", credential, tempPassword, scholar }}
 */
async function provisionCredentialForScholar({
  scholarUuid,
  email = null,
  password = null,
  communities = [],
  mustChangePassword = true,
  force = false,
  createdBy = "provision-script",
} = {}) {
  const scholar = await resolveScholar(scholarUuid);
  const scholarId = String(scholar._id);
  const profileId = String(scholar.profile_id ?? scholar._id);

  const { credentials } = await getCollections();

  const existing = await credentials.findOne({
    $or: [{ scholar_id: scholarId }, { profile_id: profileId }],
  });

  if (existing && !force) {
    return {
      status: "exists",
      credential: sanitizeCredential(existing),
      tempPassword: null,
      scholar: { id: scholarId, name: scholarDisplayName(scholar) },
    };
  }

  const loginEmail = normalizeEmail(email) || generateLoginEmail(scholar);

  // login_email must be globally unique (and not owned by a different scholar).
  const emailOwner = await credentials.findOne({ login_email: loginEmail });
  if (emailOwner && String(emailOwner.scholar_id) !== scholarId) {
    throw new ApiError(409, `login_email "${loginEmail}" is already in use.`);
  }

  if (password) {
    assertStrongPassword(password);
  }
  const plainPassword = password || generateTempPassword();
  const passwordHash = await hashPassword(plainPassword);
  const now = new Date();
  const normalizedCommunities = Array.isArray(communities)
    ? [...new Set(communities.map((c) => String(c).trim().toLowerCase()).filter(Boolean))]
    : [];

  if (existing) {
    // Reset: bump session_version to invalidate all live sessions, and rotate
    // the password. Keep the account identity (scholar_id/profile_id) stable.
    const nextVersion = (existing.session_version || 0) + 1;
    await credentials.updateOne(
      { _id: existing._id },
      {
        $set: {
          login_email: loginEmail,
          password_hash: passwordHash,
          communities: normalizedCommunities.length
            ? normalizedCommunities
            : existing.communities || [],
          is_active: true,
          must_change_password: mustChangePassword,
          session_version: nextVersion,
          failed_login_count: 0,
          locked_until: null,
          last_reset_at: now,
          reset_by: createdBy,
          updatedAt: now,
          updated_by: createdBy,
        },
      },
    );
    await deleteSessionsForScholar({ scholarId, profileId });
    const updated = await credentials.findOne({ _id: existing._id });
    return {
      status: "reset",
      credential: sanitizeCredential(updated),
      tempPassword: password ? null : plainPassword,
      scholar: { id: scholarId, name: scholarDisplayName(scholar) },
    };
  }

  const document = {
    scholar_id: scholarId,
    profile_id: profileId,
    login_email: loginEmail,
    password_hash: passwordHash,
    password_history_hashes: [],
    communities: normalizedCommunities,
    is_active: true,
    must_change_password: mustChangePassword,
    session_version: 0,
    failed_login_count: 0,
    locked_until: null,
    password_change_count: 0,
    admin_password_change_count: 0,
    scholar_password_change_count: 0,
    last_login_at: null,
    last_reset_at: null,
    password_changed_at: null,
    created_by: createdBy,
    updated_by: createdBy,
    createdAt: now,
    updatedAt: now,
  };

  const result = await credentials.insertOne(document);

  return {
    status: "created",
    credential: sanitizeCredential({ _id: result.insertedId, ...document }),
    tempPassword: password ? null : plainPassword,
    scholar: { id: scholarId, name: scholarDisplayName(scholar) },
  };
}

module.exports = {
  generateLoginEmail,
  generateTempPassword,
  provisionCredentialForScholar,
  resolveScholar,
  sanitizeCredential,
  scholarDisplayName,
  slugifyName,
};
