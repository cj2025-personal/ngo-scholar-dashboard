const crypto = require("crypto");

/**
 * Trust between our own services.
 *
 * ── What this secret can do ────────────────────────────────────────────────
 * Holding it means being able to mint an invitation for any of the 9,925
 * scholars on the platform, and an invitation is the authority to create
 * credentials for that person's record. So this is the most powerful secret in
 * the system — more so than any single scholar's password — and it should be
 * per-service, rotatable, and never shared with a client.
 *
 * ── Why the caller's identity is trusted, and the secret is not ────────────
 * The admin portal sends `issuedBy` in the payload and this service records it
 * without verifying it. That looks like a gap and is a deliberate trade: anyone
 * able to forge `issuedBy` already holds this secret, and therefore can already
 * issue invitations for anyone. Verifying the field would defend against an
 * attacker who has, by that point, won. The secret is the thing to protect.
 *
 * What `issuedBy` buys is the answer to "which admin approved this?" when an
 * invitation later turns out to have gone to the wrong person — an operational
 * question, not a security boundary, and one nobody can answer if the field
 * says only "the admin service".
 */

/**
 * Compare two secrets without leaking their contents through timing.
 *
 * Both sides are hashed first so the comparison is always over 32 equal bytes.
 * `timingSafeEqual` throws on length mismatch, and guarding that with a length
 * check would itself leak the secret's length — hashing removes the question.
 */
function secretsMatch(presented, expected) {
  if (typeof presented !== "string" || typeof expected !== "string") return false;
  if (presented.length === 0 || expected.length === 0) return false;

  const a = crypto.createHash("sha256").update(presented).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

/** The header a calling service presents. */
const SERVICE_TOKEN_HEADER = "x-service-token";

/** Who is calling, for the audit trail. Advisory — see the note above. */
const SERVICE_NAME_HEADER = "x-service-name";

/**
 * Read a bearer-or-raw service token from a request.
 *
 * Both forms are accepted because callers differ and a rejected-for-formatting
 * token produces an outage that looks like an auth failure.
 */
function readServiceToken(headers) {
  const raw = headers?.[SERVICE_TOKEN_HEADER];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  /* The scheme is matched before trimming decides anything, because "Bearer "
     trims to "Bearer" — which no longer carries the trailing space, falls
     through to the raw branch, and would present the literal word "Bearer" as
     the secret. It could never match a real one, but an empty bearer is an
     ABSENT token and must read as null rather than as a value. */
  const bearer = /^bearer\s+(.*)$/i.exec(trimmed);
  if (bearer) return bearer[1].trim() || null;
  if (/^bearer$/i.test(trimmed)) return null;

  return trimmed;
}

module.exports = {
  SERVICE_TOKEN_HEADER,
  SERVICE_NAME_HEADER,
  secretsMatch,
  readServiceToken,
};
