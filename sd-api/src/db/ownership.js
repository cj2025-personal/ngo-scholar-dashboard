/**
 * Who owns which collection.
 *
 * ── The incident this prevents ─────────────────────────────────────────────
 * `scholarstories` acquired two writers: `user-dashboard-api` through Mongoose,
 * and this service through the raw driver. They wrote incompatible shapes — the
 * body normalised into `storyblocks` on one side, embedded on the other — so
 * every document each service wrote was unreadable by the other. Six documents
 * accumulated before anyone noticed, and the only reason the damage was small
 * is that nobody had used the second writer yet.
 *
 * Nothing in either codebase would have caught it. Both services connect to the
 * same database with the same credentials, and a raw `db.collection(...)` write
 * is indistinguishable from a legitimate one until you read the result back.
 *
 * ── Why enforcement, not documentation ─────────────────────────────────────
 * A comment saying "sd-api must not write scholarstories" is advice a new file
 * can ignore without anyone noticing. The proxy in `mongo.js` refuses the write
 * instead, at the moment it is attempted, naming the owner. A rule that cannot
 * be violated silently is worth more than one that is merely written down.
 *
 * ── Keeping the two copies in step ─────────────────────────────────────────
 * This manifest is duplicated in `user-dashboard-api`. That is deliberate — a
 * shared package between two repos on different runtimes would be more
 * machinery than the problem needs. `MANIFEST_VERSION` is asserted in both
 * repos' tests, so changing ownership in one without the other fails a test
 * rather than surfacing as corrupt data months later.
 */

/** Bump when ownership changes. Both repos assert this value. */
const MANIFEST_VERSION = "2026-09-22.1";

const OWNER = {
  SD_API: "sd-api",
  USER_DASHBOARD_API: "user-dashboard-api",
  /* The Scholar Documents portal: browser-to-GCS uploads, a scan gate, and a
     lease-based extraction queue. Its model carries strict enums; a second
     writer with a looser shape was tried on 2026-09-11 and reverted the same
     day. Both application services read these; neither writes them. */
  NGO_ADMIN_BACKEND: "ngo-admin-backend",
  /* Curated from public sources by the enrichment pipeline. Neither application
     service may write it — a scholar's curated record is corrected through the
     suggestion workflow, never by a service editing it directly. */
  CURATION: "curation-pipeline",
};

const COLLECTION_OWNERSHIP = {
  /* This service owns scholar identity and everything a scholar submits. */
  scholar_credentials: OWNER.SD_API,
  /* The scholar portal's own authoring output. Separate from `scholarstories`
     because they are different products that briefly shared a name: that one
     is the user-dashboard story editor, keyed to a `users` account with its
     body in `storyblocks`; this one is keyed to a portal credential with its
     blocks embedded. One writer each, which is the whole point of the
     manifest. */
  scholar_editorials: OWNER.SD_API,
  /* Papers a scholar uploads through the Scholar Documents portal, and the
     verbatim transcriptions its extractor produces from them. Read here to
     decide what can be drafted from; written only by the portal's backend. */
  scholar_documents: OWNER.NGO_ADMIN_BACKEND,
  scholar_document_extractions: OWNER.NGO_ADMIN_BACKEND,
  scholar_sessions: OWNER.SD_API,
  scholar_suggestions: OWNER.SD_API,
  editorial_story_images: OWNER.SD_API,
  /* "Draft from my research": one job per requested draft (lease-locked,
     idempotent, event log embedded) and one run row per model call. Listed
     so the other service knows never to write them, and so a second drafter
     cannot appear without this manifest changing. */
  scholar_draft_jobs: OWNER.SD_API,
  scholar_draft_runs: OWNER.SD_API,
  /* Every version of a story, and who made it. Owned here because the story
     itself is; listed so a second writer cannot appear without this manifest
     changing, which is the whole point of the file. */
  scholar_editorial_revisions: OWNER.SD_API,
  /* Where a scholar stands against the Legacy benchmark, recomputed from live
     signals and cached here. Owned by this service rather than written onto
     the curated record, because `scholars` belongs to the curation pipeline
     and a computed field in someone else's collection is this file's whole
     subject. Listed so a second writer cannot appear quietly. */
  scholar_standing: OWNER.SD_API,

  /* Student-facing content. Authored through the existing editor. */
  scholarstories: OWNER.USER_DASHBOARD_API,
  storyblocks: OWNER.USER_DASHBOARD_API,
  storymedias: OWNER.USER_DASHBOARD_API,
  reading_passages: OWNER.USER_DASHBOARD_API,
  media_assets: OWNER.USER_DASHBOARD_API,

  /* Agent output. Two services write these — the learner app's `runAgent` and
     paris-service's `runStudentParisAgent` — which is why they are named here
     rather than left unlisted.

     The hazard they are listed against is not a rogue write. It is that
     paris-service declared its own model of these collections and queried
     `agentdecisions` by `schoolId` and `agentmessages` by `sourceType`, fields
     no writer sets. Both teacher panels matched nothing and reported it as an
     empty list. A collection with two writers and a third party's schema over
     the top is exactly the shape this manifest exists to make visible. */
  agentruns: OWNER.USER_DASHBOARD_API,
  agentdecisions: OWNER.USER_DASHBOARD_API,
  agentmessages: OWNER.USER_DASHBOARD_API,
  agentactions: OWNER.USER_DASHBOARD_API,

  /* Read-only for every application service. */
  scholars: OWNER.CURATION,
  users: OWNER.USER_DASHBOARD_API,
};

/** Mongo operations that change data. Everything else is a read. */
const WRITE_OPERATIONS = new Set([
  "insertOne",
  "insertMany",
  "updateOne",
  "updateMany",
  "replaceOne",
  "deleteOne",
  "deleteMany",
  "findOneAndUpdate",
  "findOneAndReplace",
  "findOneAndDelete",
  "bulkWrite",
  "drop",
  "rename",
  "createIndex",
  "createIndexes",
  "dropIndex",
  "dropIndexes",
]);

/**
 * One field of a collection this service does not own, which it may still set.
 *
 * `scholars.consent` is not curated data: it is what the scholar has allowed
 * to be shown, and the shared consent SPEC (v1, 2026-11-09) gives its writes to
 * the studio (the scholar, signed in) and the admin portal (staff), in one
 * shape both follow. The curation pipeline still owns every other field, and
 * the scholar's curated record is still corrected only through suggestions.
 *
 * Narrow on purpose: `$set` of paths under the field, one layer at a time
 * (`consent.photo`, never `consent` whole, which would overwrite the layers
 * staff set), on an existing document (no upsert, which would create a
 * scholar). Nothing else on the collection gets through.
 */
const FIELD_GRANTS = {
  scholars: { [OWNER.SD_API]: ["consent"] },
};

/**
 * May this service write here?
 *
 * An unlisted collection is allowed. The manifest covers what is SHARED; a
 * service creating a private collection of its own should not have to amend a
 * cross-repo document to do it, and refusing the unknown would make this file a
 * bottleneck on ordinary work rather than a guard on a specific hazard.
 */
function canWrite(collectionName, self = OWNER.SD_API) {
  const owner = COLLECTION_OWNERSHIP[collectionName];
  return owner === undefined || owner === self;
}

/**
 * May this service make this one update on a collection it does not own?
 * Only `$set` on paths below a granted field (see FIELD_GRANTS), and never as
 * an upsert. The caller (mongo.js) allows it for `updateOne` alone.
 */
function canWriteFields(collectionName, update, options = {}, self = OWNER.SD_API) {
  const fields = FIELD_GRANTS[collectionName]?.[self];
  if (!fields || !update || typeof update !== "object" || Array.isArray(update)) return false;
  if (options?.upsert) return false;
  const operators = Object.keys(update);
  if (operators.length !== 1 || operators[0] !== "$set") return false;
  const set = update.$set;
  if (!set || typeof set !== "object" || Array.isArray(set)) return false;
  const paths = Object.keys(set);
  return paths.length > 0 && paths.every((p) => fields.some((field) => p.startsWith(`${field}.`) && p.length > field.length + 1));
}

function ownerOf(collectionName) {
  return COLLECTION_OWNERSHIP[collectionName] ?? null;
}

module.exports = {
  MANIFEST_VERSION,
  OWNER,
  COLLECTION_OWNERSHIP,
  WRITE_OPERATIONS,
  FIELD_GRANTS,
  canWrite,
  canWriteFields,
  ownerOf,
};
