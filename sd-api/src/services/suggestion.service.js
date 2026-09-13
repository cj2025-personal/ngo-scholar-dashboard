const { getCollections } = require("../db/mongo");
const { ApiError } = require("../lib/api-error");
const { serializeMongoValue } = require("../lib/serialize");
const { ObjectId } = require("mongodb");
const {
  STATUS,
  STATUS_LABELS,
  canTransition,
  decisionRequiresNote,
  daysWaiting,
} = require("../lib/corrections");

// Allowed suggestion categories. Anything else is coerced to "other".
const SUGGESTION_KINDS = ["correction", "outdated", "issue", "addition", "other"];

// Section keys we surface pencils for on the profile page. Kept permissive but
// bounded so stored data stays queryable/categorizable.
const SECTION_KEYS = [
  "identity",
  "about",
  "research_focus",
  "education",
  "milestones",
  "publications",
  "links_and_media",
  "details",
];

const MAX_MESSAGE = 4000;
const MAX_SNAPSHOT = 6000;
const MAX_LABEL = 160;

function clampString(value, max) {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function normalizeKind(kind) {
  const value = String(kind || "").trim().toLowerCase();
  return SUGGESTION_KINDS.includes(value) ? value : "correction";
}

function normalizeSectionKey(sectionKey) {
  const value = String(sectionKey || "").trim().toLowerCase();
  return SECTION_KEYS.includes(value) ? value : "other";
}

function normalizeCommunity(community) {
  const value = clampString(community, MAX_LABEL).toLowerCase();
  return value || null;
}

/**
 * Persist a scholar's suggested edit to a section of their profile.
 * Categorized by professor (profile_id) with a community dimension so the same
 * store scales to community-specific dashboards later.
 */
async function createSuggestion({
  user,
  communities,
  sectionKey,
  fieldLabel,
  currentText,
  message,
  kind,
  community,
}) {
  const cleanMessage = clampString(message, MAX_MESSAGE);
  if (!cleanMessage) {
    throw new ApiError(400, "A description of the change is required.");
  }

  const { suggestions } = await getCollections();
  const now = new Date();

  const scholarCommunities = Array.isArray(communities)
    ? communities.map((value) => String(value).trim().toLowerCase()).filter(Boolean)
    : [];

  // A suggestion may only be tagged to a community the scholar actually belongs
  // to — never an arbitrary client-supplied value. Falls back to global (null).
  const requestedCommunity = normalizeCommunity(community);
  const scopedCommunity =
    requestedCommunity && scholarCommunities.includes(requestedCommunity)
      ? requestedCommunity
      : null;

  const document = {
    scholar_id: user?.scholar_id || null,
    profile_id: user?.profile_id || null,
    login_email: user?.login_email || null,
    // Community dimension for the future community-specific layer:
    communities: scholarCommunities,
    community: scopedCommunity,
    section_key: normalizeSectionKey(sectionKey),
    field_label: clampString(fieldLabel, MAX_LABEL) || null,
    current_text: clampString(currentText, MAX_SNAPSHOT) || null,
    kind: normalizeKind(kind),
    message: cleanMessage,
    status: "open",
    created_at: now,
    updated_at: now,
    created_by: user?.profile_id || user?.scholar_id || null,
    source: { app: "sd-ui", surface: "profile" },
  };

  const result = await suggestions.insertOne(document);

  return serializeMongoValue({ _id: result.insertedId, ...document });
}

/**
 * List the authenticated scholar's own suggestions (newest first), optionally
 * filtered by section. Lets the UI show pending state and avoid duplicates.
 */
async function listSuggestionsForScholar({ user, sectionKey, limit = 50 }) {
  const { suggestions } = await getCollections();

  const query = {
    $or: [
      { profile_id: user?.profile_id || null },
      { scholar_id: user?.scholar_id || null },
    ],
  };

  if (sectionKey) {
    query.section_key = normalizeSectionKey(sectionKey);
  }

  const docs = await suggestions
    .find(query)
    .sort({ created_at: -1 })
    .limit(Math.min(Math.max(Number(limit) || 50, 1), 200))
    .toArray();

  return docs.map((doc) => decorateForScholar(doc));
}



/**
 * Everything a scholar needs to know about their own requests.
 *
 * The list they already had told them what they sent. It never told them what
 * happened next, because nothing could move a request out of `open`. This adds
 * the half that makes it a reply rather than a receipt.
 */
function decorateForScholar(doc, now = new Date()) {
  const status = doc.status || STATUS.OPEN;
  return {
    ...serializeMongoValue(doc),
    status,
    statusLabel: STATUS_LABELS[status] || status,
    daysWaiting: status === STATUS.OPEN ? daysWaiting(doc.created_at, now) : null,
    /* The reason, where one was given. A decline without one cannot be made,
       so a rejected request always has something here. */
    decisionNote: doc.decision_note || null,
    decidedAt: doc.decided_at || null,
  };
}

/**
 * Record a decision on a correction request.
 *
 * ── This never edits the scholar record ────────────────────────────────────
 * Accepting means "we agree this should change", not "it changed". The
 * `scholars` collection is curated and owned by the curation pipeline; no
 * application service writes it. Only `curation` may mark a request APPLIED,
 * because only it is in a position to know the record actually moved.
 *
 * ── Guarded on the status we read ──────────────────────────────────────────
 * The update filter carries the expected current status, so two admins acting
 * on the same request at once cannot both succeed. The loser is told the
 * request already moved rather than silently overwriting the first decision.
 */
async function decideSuggestion({ suggestionId, to, actor, decidedBy, note = null, now = new Date() }) {
  if (!ObjectId.isValid(String(suggestionId))) {
    throw new ApiError(400, "That correction request doesn't exist.");
  }
  if (!decidedBy) {
    throw new ApiError(400, "A decision must record who made it.");
  }

  const cleanNote = clampString(note, MAX_MESSAGE);
  if (decisionRequiresNote(to) && !cleanNote) {
    throw new ApiError(
      400,
      "Give a reason — the scholar sees it, and a decline without one reads as being disbelieved.",
    );
  }

  const { suggestions } = await getCollections();
  const current = await suggestions.findOne({ _id: new ObjectId(String(suggestionId)) });
  if (!current) {
    throw new ApiError(404, "That correction request doesn't exist.");
  }

  const from = current.status || STATUS.OPEN;
  const verdict = canTransition({ from, to, actor });
  if (!verdict.ok) {
    throw new ApiError(verdict.code === "TERMINAL" ? 409 : 400, verdict.message);
  }

  const updated = await suggestions.findOneAndUpdate(
    { _id: new ObjectId(String(suggestionId)), status: from },
    {
      $set: {
        status: to,
        decision_note: cleanNote || null,
        decided_by: String(decidedBy),
        decided_actor: actor,
        decided_at: now,
        updated_at: now,
      },
      /* Append-only. A request's history is the record of how this platform
         answered a named individual, and overwriting it would erase exactly
         what an audit would want to read. */
      $push: {
        history: { from, to, actor, by: String(decidedBy), note: cleanNote || null, at: now },
      },
    },
    { returnDocument: "after" },
  );

  const result = updated?.value ?? updated;
  if (!result) {
    throw new ApiError(409, "That request was already decided by someone else.");
  }

  return decorateForScholar(result, now);
}

/**
 * The queue an admin works through.
 *
 * Oldest first, deliberately. A newest-first queue lets the hardest requests —
 * the ones nobody wants to answer — sink out of sight, which is how a right of
 * reply becomes a suggestion box again.
 */
async function listSuggestionsForReview({ status = STATUS.OPEN, limit = 100, now = new Date() }) {
  const { suggestions } = await getCollections();

  const query = status === "all" ? {} : { status: status || STATUS.OPEN };
  const docs = await suggestions
    .find(query)
    .sort({ created_at: 1 })
    .limit(Math.min(Math.max(Number(limit) || 100, 1), 500))
    .toArray();

  return docs.map((doc) => ({
    ...decorateForScholar(doc, now),
    /* Surfaced for the reviewer, not the scholar: how long this person has been
       waiting for an answer about their own public record. */
    waitingDays: daysWaiting(doc.created_at, now),
  }));
}

/** A scholar changing their mind before anyone has acted. */
async function withdrawSuggestion({ suggestionId, user, now = new Date() }) {
  const profileId = user?.profile_id || user?.scholar_id;
  if (!profileId) {
    throw new ApiError(403, "This session is not linked to a scholar profile.");
  }
  if (!ObjectId.isValid(String(suggestionId))) {
    throw new ApiError(404, "That correction request doesn't exist.");
  }

  const { suggestions } = await getCollections();
  const current = await suggestions.findOne({ _id: new ObjectId(String(suggestionId)) });

  /* Ownership before anything else. Reported as absent rather than forbidden,
     so a guessed id cannot confirm that someone else's request exists. */
  if (!current || (current.profile_id !== profileId && current.scholar_id !== profileId)) {
    throw new ApiError(404, "That correction request doesn't exist.");
  }

  return decideSuggestion({
    suggestionId,
    to: STATUS.WITHDRAWN,
    actor: "scholar",
    decidedBy: profileId,
    now,
  });
}

module.exports = {
  SUGGESTION_KINDS,
  SECTION_KEYS,
  createSuggestion,
  listSuggestionsForScholar,
  listSuggestionsForReview,
  decideSuggestion,
  withdrawSuggestion,
  decorateForScholar,
};
