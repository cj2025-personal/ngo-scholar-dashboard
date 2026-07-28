const { getCollections } = require("../db/mongo");
const { ApiError } = require("../lib/api-error");
const { serializeMongoValue } = require("../lib/serialize");

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

  return docs.map((doc) => serializeMongoValue(doc));
}

module.exports = {
  SUGGESTION_KINDS,
  SECTION_KEYS,
  createSuggestion,
  listSuggestionsForScholar,
};
