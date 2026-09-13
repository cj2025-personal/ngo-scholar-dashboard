const crypto = require("crypto");

/**
 * Invites: how a real person proves they are the scholar we curated.
 *
 * ── What an invite actually asserts ────────────────────────────────────────
 * This platform publishes claims about 9,925 named individuals. An invite is
 * the moment the platform decides that a particular human being is a particular
 * one of those records — and everything downstream rests on it. Once redeemed,
 * the holder can see unpublished drafts about that scholar and submit
 * corrections to their public record.
 *
 * So an invite is not a convenience link. It is the identity assertion, and the
 * two properties that matter are:
 *
 *   1. it is bound to ONE profile_id, chosen by an admin, and redemption cannot
 *      move it to another;
 *   2. it can be redeemed exactly once.
 *
 * Verification of the human is the admin's job, done out of band — checking an
 * institutional address, a homepage, a colleague. This module does not attempt
 * to judge that. It makes the admin's decision unforgeable and single-use.
 *
 * ── Why the token is hashed at rest ────────────────────────────────────────
 * The same reason session tokens are. Anyone with read access to the database —
 * a backup, an analytics replica, a support query — would otherwise be holding
 * live credentials-in-waiting for any scholar on the platform.
 */

/** 48 bytes of entropy, URL-safe. Matches the session token generator. */
function generateInviteToken() {
  return crypto.randomBytes(48).toString("base64url");
}

/** sha256 hex, exactly as sessions are hashed. */
function hashInviteToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * How long an invite stays good.
 *
 * Long enough to survive a holiday and an ignored inbox; short enough that a
 * forwarded email found a year later is inert. Seven days is the shortest
 * window that does not generate support work.
 */
const INVITE_TTL_DAYS = 7;

const INVITE_STATUS = {
  ISSUED: "issued",
  REDEEMED: "redeemed",
  REVOKED: "revoked",
};

function buildInviteExpiry(now = new Date(), days = INVITE_TTL_DAYS) {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * Why an invite cannot be redeemed, or null if it can.
 *
 * ── Distinguishing "expired" from "unknown" is deliberate ──────────────────
 * The usual instinct is to collapse every failure into one message so an
 * attacker learns nothing. That reasoning applies to passwords and email
 * addresses, where the secret is guessable and the existence of an account is
 * itself information. It does not apply here: the token is 48 random bytes, so
 * an attacker who can enumerate one has already won, and a scholar staring at
 * "invalid link" when the real problem is "this expired on Tuesday" will file a
 * support ticket instead of asking for a new invite.
 */
function inviteRejection(invite, now = new Date()) {
  if (!invite) return "unknown";
  if (invite.status === INVITE_STATUS.REVOKED) return "revoked";
  if (invite.status === INVITE_STATUS.REDEEMED) return "already_redeemed";
  if (invite.status !== INVITE_STATUS.ISSUED) return "unknown";

  /* Checked explicitly rather than left to `new Date(null)`, which is the
     epoch and would therefore read as "expired" by coincidence. It refuses
     either way, but an invite with no expiry is malformed, not expired, and an
     operator reading the logs should be told which. */
  if (invite.expires_at === null || invite.expires_at === undefined) return "malformed";

  const expiresAt =
    invite.expires_at instanceof Date ? invite.expires_at : new Date(invite.expires_at);
  if (Number.isNaN(expiresAt.getTime())) return "malformed";
  if (expiresAt.getTime() <= now.getTime()) return "expired";

  if (!invite.profile_id || typeof invite.profile_id !== "string") {
    /* An invite with no subject cannot assert anything. It should not be
       possible to create one, and it must certainly not be redeemable. */
    return "malformed";
  }

  return null;
}

const REJECTION_MESSAGES = {
  unknown: "This invitation link is not valid.",
  expired: "This invitation has expired. Ask the Archivyn team for a new one.",
  already_redeemed: "This invitation has already been used. Try signing in instead.",
  revoked: "This invitation was withdrawn. Contact the Archivyn team.",
  malformed: "This invitation is not valid.",
};

/**
 * Shape check on a token before it costs a database round trip.
 *
 * Anything that is not base64url of the right length did not come from
 * `generateInviteToken`, so there is nothing to look up.
 */
function isWellFormedToken(token) {
  if (typeof token !== "string") return false;
  const trimmed = token.trim();
  if (trimmed.length < 32 || trimmed.length > 256) return false;
  return /^[A-Za-z0-9_-]+$/.test(trimmed);
}

module.exports = {
  INVITE_TTL_DAYS,
  INVITE_STATUS,
  REJECTION_MESSAGES,
  generateInviteToken,
  hashInviteToken,
  buildInviteExpiry,
  inviteRejection,
  isWellFormedToken,
};
