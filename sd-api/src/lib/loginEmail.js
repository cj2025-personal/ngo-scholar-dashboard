/**
 * The one rule for a scholar's login address.
 *
 * ── The incident this prevents ─────────────────────────────────────────────
 * `scholar_credentials` is one table with two issuers. ngo-admin-backend issues
 * `<local>@archivyn.com` and normalises every login attempt to that shape.
 * This service issued `<local>@scholars.archivyn.com`. Same table, same argon2id
 * hashes, two conventions — so which invitation a scholar happened to receive
 * decided which portal they could enter. The only Legacy scholar with a login
 * could not open the documents portal at all.
 *
 * ── Why a port, not a config flag ──────────────────────────────────────────
 * Setting a domain variable would align the suffix and leave the local-part
 * rules free to drift. This is a faithful port of the portal's
 * `normalizeArchivynEmail` (ngo-admin-backend/utils/passwordPolicy.js), and a
 * contract test compares the two functions on a shared fixture whenever both
 * checkouts are present — the same discipline as the ownership manifest pin.
 * If the portal changes its rule, a test fails here before a scholar does.
 *
 * ── Migration posture ──────────────────────────────────────────────────────
 * Lookups try the canonical form first and the raw lowercase form second, so a
 * row issued under the old convention keeps working until it is migrated, and
 * a scholar who types the old address is still recognised afterwards.
 */

/** The portal's domain. Not configurable: configurability is how it diverged. */
const CANONICAL_DOMAIN = "archivyn.com";

/**
 * Canonical login address for any identifier — a full address, a local part,
 * or a name. Mirrors the portal exactly:
 *   lowercase, trim; take the local part; NFKD; strip non-ASCII;
 *   any run of characters outside [a-z0-9._-] becomes one dot;
 *   collapse dot runs; trim leading/trailing [._-]; append the domain.
 * Returns "" when nothing survives, never a bare "@archivyn.com".
 */
function canonicalLoginEmail(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return "";

  const atIndex = normalized.indexOf("@");
  const localPart = atIndex >= 0 ? normalized.slice(0, atIndex) : normalized;
  const safeLocalPart = localPart
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/[^a-z0-9._-]+/g, ".")
    .replace(/\.+/g, ".")
    .replace(/^[._-]+|[._-]+$/g, "");

  return safeLocalPart ? `${safeLocalPart}@${CANONICAL_DOMAIN}` : "";
}

/**
 * Every form under which a stored row might match a typed address, most
 * specific first. Used by lookups during and after migration.
 */
function loginEmailCandidates(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  const canonical = canonicalLoginEmail(raw);
  return [...new Set([canonical, raw].filter(Boolean))];
}

/** True when a stored address already follows the canonical rule. */
function isCanonicalLoginEmail(value) {
  const s = String(value ?? "");
  return s.length > 0 && canonicalLoginEmail(s) === s;
}

module.exports = { CANONICAL_DOMAIN, canonicalLoginEmail, loginEmailCandidates, isCanonicalLoginEmail };
