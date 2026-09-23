"use strict";

/**
 * Where a scholar stands against the Legacy benchmark, measured from what is
 * actually on record.
 *
 * ── Why this reads rather than trusts ──────────────────────────────────────
 * Legacy used to be `status: "legacy"` on the curated record: a value this
 * service cannot write (the `scholars` collection belongs to the curation
 * pipeline) and cannot explain. Measuring it here means a scholar can be told
 * what holds, what does not, and what one act would change — none of which a
 * flag can do.
 *
 * ── Where it is stored, and why not on the scholar ─────────────────────────
 * `scholar_standing`, owned by this service. The curated record is the
 * curation pipeline's, and writing a computed field into someone else's
 * collection is the exact hazard `src/db/ownership.js` exists to prevent. The
 * stored row is a cache and a history, never the source of truth: the gates
 * are recomputed from live signals on every read, and the row records what
 * was decided and when it last moved.
 *
 * ── What is counted ────────────────────────────────────────────────────────
 * The scholarship half comes from the curated record and the scholar's own
 * contributed papers. The Archivyn half comes from this service's own
 * collections: articles published, reading levels approved, corrections
 * filed. Approved is the operative word for levels — a level nobody approved
 * is a level no reader ever saw.
 */

const { COLLECTIONS, getDb } = require("../db/mongo");
const legacyStanding = require("../lib/legacyStanding");

const STANDING_COLLECTION = "scholar_standing";

/**
 * The Archivyn half: what the scholar has done here.
 *
 * One aggregation per question rather than one clever pipeline, because these
 * are read on a dashboard load and each is an indexed count over one
 * scholar's own rows.
 */
async function archivynSignals(db, profileId) {
  const stories = db.collection(COLLECTIONS.scholarEditorials);
  const suggestions = db.collection(COLLECTIONS.suggestions);

  const [published, levelRows, corrections] = await Promise.all([
    stories.countDocuments({ profile_id: profileId, status: "published" }),
    /* Levels live embedded on the story, so the count of approved ones is a
       sum across the scholar's stories rather than a collection count. */
    stories
      .find({ profile_id: profileId, "levels.0": { $exists: true } }, { projection: { levels: 1 } })
      .toArray(),
    suggestions.countDocuments({ profile_id: profileId }),
  ]);

  const approvedLevels = levelRows.reduce(
    (sum, row) => sum + (row.levels || []).filter((l) => l && l.approved).length,
    0,
  );

  return { publishedStories: published, approvedLevels, corrections };
}

/**
 * The scholarship half, taken from the inventory the drafting service has
 * already classified.
 *
 * Reusing that inventory rather than re-classifying is the point: "work we may
 * build on" then means exactly what it means on the Papers page and in the
 * composer, instead of becoming a second definition that drifts from the
 * first. A benchmark measured differently from the feature it unlocks would be
 * a benchmark nobody could act on.
 */
function scholarshipSignals({ inventory = {} }) {
  const draftable = inventory.draftable || [];
  const citable = inventory.citable || [];
  const unusable = inventory.unusable || [];
  const all = [...draftable, ...citable, ...unusable];

  /* Everything of theirs we hold, whatever the licence. Absent means zero,
     never "unknown but probably fine": a scholar must not clear a gate
     because a number failed to load. */
  return {
    sourcesOnRecord: all.length,
    fullUseSources: draftable.length,
    contributedPapers: all.filter((s) => s.origin === "contributed").length,
  };
}

/** The stored row, or nothing if this scholar has never been assessed. */
async function readStored(db, profileId) {
  return db.collection(STANDING_COLLECTION).findOne({ profile_id: profileId });
}

/**
 * Assess a scholar now, and record the result if it moved.
 *
 * Returns the assessment either way, so a caller that only wants to render
 * the dashboard does not have to care whether anything changed.
 */
async function assessScholar({ profileId, inventory = {}, recordSaysLegacy = false, persist = true }) {
  const db = await getDb();
  const stored = await readStored(db, profileId);

  const archivyn = await archivynSignals(db, profileId);
  const scholarship = scholarshipSignals({ inventory });

  const signals = {
    ...scholarship,
    publishedStories: archivyn.publishedStories,
    approvedLevels: archivyn.approvedLevels,
    /* A correction filed or a paper contributed: either is the scholar
       answering for their own record, which is what the gate is asking. */
    substantiveResponses: archivyn.corrections + scholarship.contributedPapers,
    withdrawn: stored?.standing === legacyStanding.STANDING.WITHDRAWN,
    /* Today's 65, from the curated record this service may read but not
       write. Seeding from it is what makes the switch behaviour-neutral. */
    grandfathered: Boolean(recordSaysLegacy),
  };

  const assessment = legacyStanding.assess(signals);
  const decision = legacyStanding.reconcile({
    current: stored?.standing || legacyStanding.STANDING.CONTEMPORARY,
    assessment,
  });

  if (persist && (decision.changed || !stored)) {
    const now = new Date();
    await db.collection(STANDING_COLLECTION).updateOne(
      { profile_id: profileId },
      {
        $set: {
          profile_id: profileId,
          standing: decision.standing,
          signals,
          gates: assessment.gates.map((g) => ({ key: g.key, met: g.met })),
          assessed_at: now,
          ...(decision.changed ? { moved_at: now, moved_reason: decision.reason } : {}),
        },
        $setOnInsert: { created_at: now },
        /* A benchmark a scholar is climbing is worth a history: "when did I
           reach this" is a fair question and an empty answer is a bad one. */
        ...(decision.changed
          ? { $push: { history: { $each: [{ at: now, standing: decision.standing, reason: decision.reason }], $slice: -20 } } }
          : {}),
      },
      { upsert: true },
    );
  }

  return {
    ...assessment,
    standing: decision.standing,
    /* What the gates say, versus what is on file. They differ only where
       standing was reached and a gate later dropped, which is deliberate. */
    assessedStanding: assessment.standing,
    since: stored?.moved_at || null,
    mayDraft: legacyStanding.mayDraft(decision.standing),
  };
}

/** Standing as recorded, without recomputing. For callers on a hot path. */
async function storedStanding(profileId) {
  const db = await getDb();
  const row = await readStored(db, profileId);
  return row?.standing || legacyStanding.STANDING.CONTEMPORARY;
}

module.exports = {
  STANDING_COLLECTION,
  assessScholar,
  storedStanding,
  archivynSignals,
  scholarshipSignals,
};
