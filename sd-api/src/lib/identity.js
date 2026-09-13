/**
 * Who a scholar is, in one place.
 *
 * ── The problem this exists to end ─────────────────────────────────────────
 * Queries across this service look like:
 *
 *   $or: [ { scholar_id }, { profile_id }, { authorId: scholarId },
 *          { authorId: profileId }, { authorId: new ObjectId(scholarId) }, … ]
 *
 * Six filters, because nobody knew which key was authoritative. A six-way OR is
 * not defensive coding — it is a question the codebase never answered, asked
 * again on every read. It cannot use an index well, it silently matches the
 * wrong row when two namespaces collide, and it makes "is this mine?" — the
 * single most important authorization question here — unanswerable by
 * inspection.
 *
 * ── What the data actually says ────────────────────────────────────────────
 * Measured against ngo_profiles, 2026-09-11:
 *
 *   scholars                      9925
 *     _id === profile_id          9920   (99.9%)
 *     carrying a scholar_id          0   ← not one
 *
 * `scholar_id` appears only on `scholar_credentials`, where it duplicates
 * `profile_id` exactly. It is vestigial.
 *
 * So: PROFILE_ID IS THE CANONICAL SCHOLAR IDENTITY. A UUID, equal to `_id` on
 * the scholars collection. Everything else is an alias to be migrated away.
 */

/** The field name, so call sites stop spelling it differently. */
const CANONICAL_KEY = "profile_id";

/**
 * The canonical id for an authenticated scholar.
 *
 * Falls back to `scholar_id` because the two credential rows carry both and the
 * values are identical — but the fallback is a migration aid, not a contract.
 * Returns null rather than guessing: an unidentified caller must be refused,
 * never treated as some scholar.
 */
function canonicalScholarId(user) {
  if (!user || typeof user !== "object") return null;
  const id = user.profile_id || user.profileId || user.scholar_id || user.scholarId;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

/**
 * True where two identities refer to the same scholar.
 *
 * The authorization primitive. Deliberately strict: no coercion, no ObjectId
 * casting, no partial match. Two ids are the same scholar or they are not, and
 * anything ambiguous is "not" — because the cost of a false positive here is
 * one person editing another person's public record.
 */
function isSameScholar(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = a.trim();
  const right = b.trim();
  return left.length > 0 && left === right;
}

/**
 * The one filter that finds a scholar.
 *
 * `_id` is included alongside `profile_id` because 5 of 9925 scholars have them
 * differing — a real inconsistency in curated data, not a schema choice. Both
 * are checked so those five are reachable, and the discrepancy is worth fixing
 * upstream rather than being papered over forever.
 */
function scholarFilter(profileId) {
  if (!profileId) throw new TypeError("scholarFilter requires a profile id");
  return { $or: [{ profile_id: profileId }, { _id: profileId }] };
}

/**
 * Content owned by this scholar.
 *
 * ── Why this does not accept a legacy `authorId` ───────────────────────────
 * The six existing `scholarstories` rows carry an ObjectId-shaped `authorId`
 * (`69724afe4ad91ba8a172bc5c`) that resolves to no scholar and no user — it
 * belongs to a different identity namespace. Matching it here would let this
 * service claim ownership of rows it cannot actually attribute, which is the
 * precise mistake that made the old six-way OR dangerous rather than merely
 * untidy. Such rows are unattributable and must be migrated or removed, not
 * matched by widening the query.
 */
function ownedByScholarFilter(profileId) {
  if (!profileId) throw new TypeError("ownedByScholarFilter requires a profile id");
  return { [CANONICAL_KEY]: profileId };
}

/** True for an id in the legacy ObjectId namespace, so it can be reported. */
function isLegacyObjectIdNamespace(value) {
  return typeof value === "string" && /^[0-9a-f]{24}$/i.test(value);
}

module.exports = {
  CANONICAL_KEY,
  canonicalScholarId,
  isSameScholar,
  scholarFilter,
  ownedByScholarFilter,
  isLegacyObjectIdNamespace,
};
