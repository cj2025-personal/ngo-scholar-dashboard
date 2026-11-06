"use strict";
/**
 * Writes the scholar contributions made before they were recorded as they
 * happen (lib/contributions; the learner app's services/contributions.ts), from
 * what the database already holds. Idempotent: each contribution has the same
 * (profileId, kind, ref) the live code gives it, so running this twice, or
 * after the live code has written some, adds nothing twice.
 *
 *   node scripts/backfillContributions.js           count what would be written (dry run)
 *   node scripts/backfillContributions.js --apply   write it
 *
 * Reads MONGODB_URI and MONGODB_DB from the environment (.env). Touches only
 * scholar_contributions.
 */
require("dotenv").config();
const crypto = require("crypto");
const { MongoClient } = require("mongodb");

const { recordContribution, CONTRIBUTIONS } = require("../src/lib/contributions");

const apply = process.argv.includes("--apply");
const sha256 = (text) => crypto.createHash("sha256").update(String(text)).digest("hex");

async function* found(db) {
  for await (const s of db.collection("scholar_editorials").find({ status: "published" }, { projection: { profile_id: 1, published_at: 1, created_at: 1, levels: 1 } })) {
    yield { profileId: s.profile_id, kind: "story_published", ref: String(s._id), at: s.published_at || s.created_at || new Date() };
    for (const [band, level] of Object.entries(s.levels || {})) {
      if (!level?.approved) continue;
      const written = level.generated_at ? new Date(level.generated_at).toISOString() : String(level.source_version ?? "");
      yield { profileId: s.profile_id, kind: "level_approved", ref: `${s._id}:${band}:${written}`, at: level.approved_at || new Date(), detail: { audience: band } };
    }
  }
  const leads = new Map();
  for await (const c of db.collection("circles").find({}, { projection: { leadProfileId: 1, createdAt: 1 } })) {
    leads.set(String(c._id), c.leadProfileId);
    yield { profileId: c.leadProfileId, kind: "circle_created", ref: String(c._id), at: c.createdAt || new Date() };
  }
  for await (const l of db.collection("circle_links").find({ status: { $in: ["active", "ended"] }, decidedAt: { $ne: null } }, { projection: { circleId: 1, decidedAt: 1 } })) {
    yield { profileId: leads.get(String(l.circleId)), kind: "class_joined_circle", ref: String(l._id), at: l.decidedAt, detail: { circleId: String(l.circleId) } };
  }
  for await (const check of db.collection("scholar_story_checks").find({ "asks.status": "acted" }, { projection: { profileId: 1, editorialId: 1, band: 1, asks: 1, updatedAt: 1 } })) {
    for (const ask of check.asks || []) {
      if (ask.status !== "acted" || ask.kind !== "clarify_passage") continue;
      yield { profileId: check.profileId, kind: "passage_clarified", ref: `${check._id}:${sha256(ask.question).slice(0, 16)}`, at: check.updatedAt || new Date(), detail: { editorialId: check.editorialId, band: check.band } };
    }
  }
}

(async () => {
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db(process.env.MONGODB_DB);
  try {
    const byKind = {};
    let missing = 0;
    for await (const entry of found(db)) {
      if (!entry.profileId) continue;
      const exists = await db.collection(CONTRIBUTIONS).countDocuments({ profileId: String(entry.profileId), kind: entry.kind, ref: entry.ref }, { limit: 1 });
      if (exists) continue;
      missing += 1;
      byKind[entry.kind] = (byKind[entry.kind] || 0) + 1;
      if (apply) await recordContribution(db, entry);
    }
    console.log(`${apply ? "wrote" : "would write"} ${missing} contribution(s)`, byKind);
  } finally {
    await client.close();
  }
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
