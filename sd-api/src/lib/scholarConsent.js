/**
 * What a scholar has allowed to be shown, read the same way everywhere.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Nothing about a scholar is deleted. What changes is what is shown or used:
 * each sensitive layer of the record (whether they appear at all, their photo,
 * a community or heritage, their contact details) is shown only when a
 * consent, or a recorded rights basis, allows it. Absent consent is the safe
 * default: listed, no photo, no community, no contact details.
 *
 * Every repo that shows scholar data reads this layer through its own copy of
 * these functions, with the same behaviour and the same contract fixture
 * (tests/fixtures/scholarConsent.json, from the shared consent SPEC v1). A
 * read path that decides any of this for itself, rather than calling here,
 * is how two pages end up disagreeing about whether a person may be seen.
 *
 * The inferred labels the curation pipeline keeps (`about.race` and its
 * kin) are never read here, and never qualify as a community: only the
 * scholar's own self-identification does.
 */

/** May this scholar appear at all? Absent means listed. */
function isListed(scholar) {
  return scholar?.consent?.listing?.state !== "hidden";
}

/** The recorded basis for showing a photo, or null for none (initials). */
function photoBasis(scholar) {
  return scholar?.consent?.photo?.basis ?? null;
}

/**
 * The storage key of the photo that may be shown, or null.
 *
 * The basis covers a named object when it gives one, and otherwise the
 * scholar's current display photo. Nothing older (the S3 faculty image, an
 * avatar URL, an image mapping) is ever a fallback: those were harvested, and
 * no basis covers them.
 */
function visiblePhotoKey(scholar) {
  if (!photoBasis(scholar)) return null;
  return scholar.consent.photo.objectKey || scholar.display?.profile_image_object_key || null;
}

/** The credit an openly licensed photo must carry wherever it is shown, or null. */
function photoCredit(scholar) {
  if (photoBasis(scholar) !== "open_license") return null;
  const photo = scholar.consent.photo;
  return { license: photo.license ?? null, attribution: photo.attribution ?? null };
}

/** The communities the scholar identifies with, in their own words; [] otherwise. */
function communities(scholar) {
  const community = scholar?.consent?.community;
  if (community?.basis !== "self_identified") return [];
  return Array.isArray(community.values) ? community.values : [];
}

/** May email, phone and office be shown? Only on an explicit yes. */
function showContact(scholar) {
  return scholar?.consent?.contact?.show === true;
}

/** For list queries over `scholars`: everyone not hidden, absent consent included. */
const LISTED_FILTER = Object.freeze({ "consent.listing.state": { $ne: "hidden" } });

module.exports = {
  isListed,
  photoBasis,
  visiblePhotoKey,
  photoCredit,
  communities,
  showContact,
  LISTED_FILTER,
};
