const { ApiError } = require("../lib/api-error");

/* Required where it is used: the database module reads the environment at
   load, and the decisions above it are tested without one. */
const mongo = () => require("../db/mongo");

/**
 * The agent's terms, and whether a scholar has agreed to the ones that stand.
 *
 * The agent drafts from a scholar's own papers under their own byline, sends
 * the paper's text to a model provider to do it, and keeps every instruction
 * as the record behind the story. That is asked once, plainly, before the
 * agent writes a word — and asked again only when the terms change. The
 * version is a date, so "again" has a reason a scholar can see.
 *
 * The client shows the terms and sends back the version it showed. A stale
 * version is refused, so a sheet drawn before the terms changed cannot agree
 * to terms the scholar never read.
 *
 * Kept in this service's own collection rather than on the scholar record:
 * `scholars` is curated by the enrichment pipeline and nothing here may write
 * it (see db/ownership.js). One row per scholar, with the history of every
 * agreement, since the terms will change.
 */
const AI_TERMS_VERSION = "2026-09-15";

/** What the profile carries about the terms. Pure. */
function aiTermsView(record) {
  const acceptedVersion = typeof record?.version === "string" ? record.version : null;
  const at = record?.accepted_at;
  const acceptedAt = at instanceof Date ? at.toISOString() : typeof at === "string" ? at : null;
  return {
    version: AI_TERMS_VERSION,
    acceptedVersion,
    acceptedAt: acceptedVersion ? acceptedAt : null,
    /* Agreed, and to the terms as they stand now. */
    current: acceptedVersion === AI_TERMS_VERSION,
  };
}

/** The version a client says it showed, checked against the one that stands. Pure. */
function checkAcceptedVersion(version) {
  const shown = typeof version === "string" ? version.trim() : "";
  if (!shown) throw new ApiError(400, "Say which version of the terms was shown.");
  if (shown !== AI_TERMS_VERSION) throw new ApiError(409, "The terms have changed since that page was drawn. Reload and read them again.");
  return AI_TERMS_VERSION;
}

function requireProfile(profileId) {
  if (!profileId) throw new ApiError(403, "This session is not linked to a scholar profile.");
  return profileId;
}

async function getAiTerms({ profileId }) {
  if (!profileId) return aiTermsView(null);
  const { COLLECTIONS, getDb } = mongo();
  const db = await getDb();
  return aiTermsView(await db.collection(COLLECTIONS.agentTerms).findOne({ profile_id: profileId }));
}

async function acceptAiTerms({ profileId, version }) {
  const accepted = checkAcceptedVersion(version);
  const id = requireProfile(profileId);
  const { COLLECTIONS, getDb } = mongo();
  const db = await getDb();
  const now = new Date();
  const terms = db.collection(COLLECTIONS.agentTerms);
  await terms.updateOne(
    { profile_id: id },
    {
      $set: { version: accepted, accepted_at: now },
      $setOnInsert: { profile_id: id, created_at: now },
      $push: { history: { version: accepted, accepted_at: now } },
    },
    { upsert: true },
  );
  return aiTermsView(await terms.findOne({ profile_id: id }));
}

module.exports = { AI_TERMS_VERSION, aiTermsView, checkAcceptedVersion, getAiTerms, acceptAiTerms };
