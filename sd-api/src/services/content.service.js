const { COLLECTIONS, getCollections } = require("../db/mongo");
const { isLegacyObjectIdNamespace, ownedByScholarFilter } = require("../lib/identity");
const { serializeMongoValue } = require("../lib/serialize");

/**
 * "What content of mine is shown to students?"
 *
 * ── The question this platform could not answer ────────────────────────────
 * Archivyn publishes to children about 9,925 real, named researchers, and until
 * the identity bridge existed it could not tell any of them what it had
 * published under their name.
 *
 * Curated passages were never the problem: `provenance.profileId` has been set
 * on all 3,572 of them from the start, resolving to 431 real scholars.
 * Editorials were — they are stamped with a `users._id`, which belongs to a
 * different namespace from `scholars.profile_id` with nothing joining the two.
 *
 * This is the read that closes that. It is deliberately the first thing built
 * on top of the bridge, because a right of reply starts with being able to see
 * what you would be replying to.
 *
 * ── Reads across services, writes nothing ──────────────────────────────────
 * `scholarstories` and `reading_passages` are written by `user-dashboard-api`.
 * This service only reads them. The single-writer rule is what keeps the two
 * schemas from drifting the way they already did once.
 */

/** Content kinds a scholar can currently be shown. Grows as surfaces are wired. */
const CONTENT_KINDS = ["editorial", "passage"];

/** Nothing here is trusted to be small; every read is bounded. */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function clampLimit(value) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

/**
 * Everything published under this scholar's name, by kind.
 *
 * ── Why the unattributable is counted rather than guessed at ───────────────
 * Editorials written before the bridge carry an authoring account, not a
 * profile. Inferring the scholar by matching a name or an email would attach
 * one real person's writing to another real person's public record — the exact
 * harm this whole surface exists to prevent. Returning nothing and saying
 * nothing would instead tell a scholar their record is complete when it is not.
 *
 * So the residue is reported as a number. "We know of N items we cannot yet
 * attribute" is true, actionable, and the honest thing to put in front of
 * someone asking what exists about them.
 */
async function listScholarContent({ profileId, kind = "all", limit }) {
  if (!profileId) {
    throw new TypeError("listScholarContent requires a profile id");
  }

  const { db } = await getCollections();
  const cap = clampLimit(limit);
  const wanted = kind === "all" ? CONTENT_KINDS : [kind].filter((k) => CONTENT_KINDS.includes(k));

  const content = {};

  if (wanted.includes("editorial")) {
    const stories = await db
      .collection(COLLECTIONS.scholarEditorials)
      .find(ownedByScholarFilter(profileId))
      .sort({ lastEditedAt: -1 })
      .limit(cap)
      .toArray();

    content.editorial = stories.map((story) => ({
      id: String(story._id),
      kind: "editorial",
      title: story.title || null,
      slug: story.slug || null,
      status: story.status || "draft",
      /* What a student can actually see right now. A scholar asking this
         question means the live state, not the workflow state. */
      visibleToStudents: story.status === "published",
      publishedAt: story.publishedAt || null,
      lastEditedAt: story.lastEditedAt || null,
      origin: "authored",
    }));
  }

  if (wanted.includes("passage")) {
    /* `provenance.profileId`, not a top-level field. The harvester has always
       recorded the scholar here — an earlier reading of this collection queried
       the top level, found nothing, and reported the corpus as unattributed
       when it is attributed in full. Worth stating so nobody re-derives that
       conclusion from the same mistake. */
    const passages = await db
      .collection("reading_passages")
      .find({ "provenance.profileId": profileId })
      .sort({ createdAt: -1 })
      .limit(cap)
      .toArray();

    content.passage = passages.map((passage) => ({
      id: String(passage.passageId || passage._id),
      kind: "passage",
      title: passage.title || passage.provenance?.sourceTitle || null,
      sourceTitle: passage.provenance?.sourceTitle || null,
      sourceUrl: passage.provenance?.sourceUrl || null,
      institution: passage.provenance?.institution || null,
      words: passage.words ?? null,
      timesServed: passage.timesServed ?? 0,
      targetGrade: passage.targetGrade ?? null,
      band: passage.band || null,
      visibleToStudents: true,
      /* Curated from the scholar's published work by the platform — not written
         by them. The distinction decides what control they get: authored
         content they edit, derived content they correct or withdraw. */
      origin: "derived",
    }));
  }

  return serializeMongoValue(content);
}

/**
 * How much exists that we cannot yet attribute to anyone.
 *
 * Reported to the scholar as a caveat on their own list, and to us as the
 * measure of how far the attribution backfill has to go.
 */
async function countUnattributedContent() {
  const { db } = await getCollections();

  const [editorials, passages, legacyNamespace] = await Promise.all([
    db.collection("scholarstories").countDocuments({
      $or: [{ authorProfileId: null }, { authorProfileId: { $exists: false } }],
    }),
    db.collection("reading_passages").countDocuments({
      $or: [
        { "provenance.profileId": null },
        { "provenance.profileId": { $exists: false } },
      ],
    }),
    /* Stories whose only author id belongs to the pre-bridge ObjectId
       namespace. Counted apart because these need a different fix — a mapping
       from authoring account to scholar profile — rather than a re-harvest. */
    db
      .collection("scholarstories")
      .find({ authorProfileId: null }, { projection: { authorId: 1 } })
      .limit(1000)
      .toArray()
      .then((rows) => rows.filter((row) => isLegacyObjectIdNamespace(String(row.authorId))).length),
  ]);

  return { editorials, passages, legacyNamespace };
}

module.exports = {
  CONTENT_KINDS,
  listScholarContent,
  countUnattributedContent,
};
