const { getCollections } = require("../db/mongo");
const { ApiError } = require("../lib/api-error");
const { serializeMongoValue } = require("../lib/serialize");
const {
  INVITE_STATUS,
  REJECTION_MESSAGES,
  generateInviteToken,
  hashInviteToken,
  buildInviteExpiry,
  inviteRejection,
  isWellFormedToken,
} = require("../lib/invites");
const { provisionCredentialForScholar } = require("./credential.service");
const { assertStrongPassword } = require("../lib/passwords");

const COLLECTION = "scholar_invites";

/**
 * Issuing and redeeming the invitations that bind a person to a scholar record.
 *
 * ── Redemption is a race, and it is settled by the database ────────────────
 * Two clicks on the same emailed link, or a link forwarded to a colleague, must
 * not produce two credentials. The claim is made with a single
 * `findOneAndUpdate` guarded on `status: "issued"` — exactly one caller can
 * flip it, and the loser is told the invite is spent rather than quietly
 * creating a second account for the same scholar.
 *
 * The alternative — read, check, then write — leaves a window in which both
 * callers see "issued". That window is small and would be hit rarely, which is
 * precisely what makes it a bad bug: it would appear months later as two
 * credentials for one person and no way to tell which is authoritative.
 */

async function invitesCollection() {
  const { db } = await getCollections();
  return db.collection(COLLECTION);
}

/** Indexes this collection needs. Owned by sd-api, so it may create them. */
async function ensureInviteIndexes() {
  const invites = await invitesCollection();
  await invites.createIndex({ token_hash: 1 }, { unique: true });
  /* "Does this scholar already have an invite outstanding?" — asked on every
     issue so an admin does not accidentally mint two. */
  await invites.createIndex({ profile_id: 1, status: 1 });
}

/**
 * Issue an invitation for one scholar.
 *
 * ── The raw token is returned exactly once ─────────────────────────────────
 * It is never stored and cannot be recovered. An admin who loses it issues a
 * new one, which is the correct outcome: a system that could re-display an
 * invite token would be a system where database access yields live invitations.
 */
async function issueInvite({ profileId, email = null, issuedBy, now = new Date() }) {
  if (!profileId || typeof profileId !== "string") {
    throw new ApiError(400, "An invitation needs the scholar's profile id.");
  }
  if (!issuedBy) {
    throw new ApiError(400, "An invitation must record who issued it.");
  }

  const { db } = await getCollections();

  /* The scholar must exist. An invite naming a profile that does not resolve
     would create a credential pointing at nothing, and the holder would log in
     to an empty portal with no way to explain why. */
  const scholar = await db.collection("scholars").findOne({
    $or: [{ profile_id: profileId }, { _id: profileId }],
  });
  if (!scholar) {
    throw new ApiError(404, `No scholar found for profile ${profileId}.`);
  }

  const invites = await invitesCollection();

  /* Superseding rather than refusing. An admin re-inviting someone almost
     always means "the last one did not arrive"; leaving the old one live would
     let two different links both create the account. */
  await invites.updateMany(
    { profile_id: profileId, status: INVITE_STATUS.ISSUED },
    { $set: { status: INVITE_STATUS.REVOKED, revoked_at: now, revoked_reason: "superseded" } },
  );

  const token = generateInviteToken();
  const invite = {
    token_hash: hashInviteToken(token),
    profile_id: profileId,
    email: typeof email === "string" && email.trim() ? email.trim().toLowerCase() : null,
    status: INVITE_STATUS.ISSUED,
    issued_by: String(issuedBy),
    issued_at: now,
    expires_at: buildInviteExpiry(now),
    redeemed_at: null,
    created_at: now,
  };

  const result = await invites.insertOne(invite);

  return {
    inviteId: String(result.insertedId),
    /* Returned once, never stored. */
    token,
    profileId,
    expiresAt: invite.expires_at,
    scholarName: scholar?.name?.display || scholar?.name?.full || null,
  };
}

/**
 * What an invitation is for, without redeeming it.
 *
 * Powers the "this is you?" confirmation — a person should see whose record
 * they are about to take control of before they set a password, not after.
 * Returns the scholar's public display name only; an unredeemed invite must not
 * be a way to read a scholar's private data.
 */
async function describeInvite({ token, now = new Date() }) {
  if (!isWellFormedToken(token)) {
    return { ok: false, reason: "unknown", message: REJECTION_MESSAGES.unknown };
  }

  const invites = await invitesCollection();
  const invite = await invites.findOne({ token_hash: hashInviteToken(token) });

  const rejection = inviteRejection(invite, now);
  if (rejection) {
    return { ok: false, reason: rejection, message: REJECTION_MESSAGES[rejection] };
  }

  const { db } = await getCollections();
  const scholar = await db.collection("scholars").findOne({
    $or: [{ profile_id: invite.profile_id }, { _id: invite.profile_id }],
  });

  return {
    ok: true,
    profileId: invite.profile_id,
    scholarName: scholar?.name?.display || scholar?.name?.full || null,
    institution: scholar?.affiliation?.institution || null,
    email: invite.email,
    expiresAt: invite.expires_at,
  };
}

/**
 * Redeem an invitation and create the scholar's credentials.
 *
 * ── The invite is claimed BEFORE the credential is created ─────────────────
 * Order matters and the safe order is counter-intuitive. Claiming first means a
 * crash between the two steps burns the invite without creating an account —
 * recoverable by issuing another. Creating first would mean a crash leaves a
 * live account and a still-redeemable invite, so the same link could mint a
 * second credential for the same person. Burning an invite is cheap; two
 * accounts for one scholar is not.
 */
async function redeemInvite({ token, password, email = null, metadata = {}, now = new Date() }) {
  if (!isWellFormedToken(token)) {
    throw new ApiError(400, REJECTION_MESSAGES.unknown);
  }

  /* ── Validated BEFORE the invite is claimed ─────────────────────────────
     An end-to-end run caught this: a weak password threw inside provisioning,
     AFTER the claim had already burned the invite. The scholar got an error
     telling them to pick a stronger password and a link that no longer worked.

     The crash-safety argument for claiming first still holds — an unexpected
     failure should burn an invite rather than risk two credentials — but a
     rejected password is not an unexpected failure. It is the single most
     likely thing to happen on this endpoint, and it must cost nothing. */
  assertStrongPassword(password);

  const invites = await invitesCollection();
  const tokenHash = hashInviteToken(token);

  /* Read first only to produce a useful message. The claim below is what
     actually decides; nothing here is trusted. */
  const preview = await invites.findOne({ token_hash: tokenHash });
  const rejection = inviteRejection(preview, now);
  if (rejection) {
    throw new ApiError(rejection === "already_redeemed" ? 409 : 400, REJECTION_MESSAGES[rejection]);
  }

  /* The claim. Guarded on `issued`, so exactly one concurrent caller wins. */
  const claimed = await invites.findOneAndUpdate(
    { token_hash: tokenHash, status: INVITE_STATUS.ISSUED, expires_at: { $gt: now } },
    {
      $set: {
        status: INVITE_STATUS.REDEEMED,
        redeemed_at: now,
        redeemed_ip: metadata.ipAddress || null,
        redeemed_user_agent: metadata.userAgent || null,
      },
    },
    { returnDocument: "after" },
  );

  const invite = claimed?.value ?? claimed;
  if (!invite || invite.status !== INVITE_STATUS.REDEEMED) {
    /* Lost the race, or it expired between the read and the claim. */
    throw new ApiError(409, REJECTION_MESSAGES.already_redeemed);
  }

  const credential = await provisionCredentialForScholar({
    scholarUuid: invite.profile_id,
    email: email || invite.email,
    password,
    /* They just chose it. Forcing another change immediately would be theatre. */
    mustChangePassword: false,
    /* An invite is the authority to create this account, including replacing a
       dormant one an admin provisioned earlier by script. */
    force: true,
    createdBy: `invite:${String(invite._id)}`,
  });

  return serializeMongoValue({
    profileId: invite.profile_id,
    loginEmail: credential?.credential?.login_email ?? null,
    status: credential?.status ?? "created",
  });
}

async function revokeInvite({ inviteId, revokedBy, reason = "revoked", now = new Date() }) {
  const invites = await invitesCollection();
  const { ObjectId } = require("mongodb");

  const result = await invites.findOneAndUpdate(
    { _id: new ObjectId(String(inviteId)), status: INVITE_STATUS.ISSUED },
    { $set: { status: INVITE_STATUS.REVOKED, revoked_at: now, revoked_by: String(revokedBy), revoked_reason: reason } },
    { returnDocument: "after" },
  );

  const invite = result?.value ?? result;
  if (!invite) throw new ApiError(404, "No outstanding invitation with that id.");
  return { inviteId: String(invite._id), status: invite.status };
}

module.exports = {
  COLLECTION,
  ensureInviteIndexes,
  issueInvite,
  describeInvite,
  redeemInvite,
  revokeInvite,
};
