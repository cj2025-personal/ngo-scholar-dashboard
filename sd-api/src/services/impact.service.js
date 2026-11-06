"use strict";
/**
 * A scholar's impact record: what their work on Archivyn reached, signed so
 * that anyone they show it to can check it was issued by this deployment and
 * has not been altered since - a grant panel, a dean, a CV.
 *
 * ── What is in it ───────────────────────────────────────────────────────────
 * Their published stories, and for each the readers who answered its reading
 * check and those who understood it; their totals; the learning circles they
 * lead, the classes and schools in them; and what they contributed, counted
 * by kind (lib/contributions). The reader counts come from the learner app
 * (its services/scholarImpact) and are counts only: none is given under the
 * report floor (5 by default), where the record says null. No reader, class
 * or school is named anywhere in it.
 *
 * ── Who sees it ─────────────────────────────────────────────────────────────
 * The scholar, in the studio. Nobody else unless the scholar makes a share
 * link, which they can turn off; a link shows the record as it stands when it
 * is opened, newly signed. Only the link's hash is kept here.
 *
 * ── Signed how ──────────────────────────────────────────────────────────────
 * With the evidence ledger's key and canonical form (lib/evidenceLedger): the
 * record carries the key id, the signature is over its canonical bytes, and
 * the public key is at /api/editorial-stories/public/evidence/key. A record
 * whose counts could not be read is not issued at all: a signed record that
 * silently left readers out would be worse than none.
 */
const crypto = require("crypto");

const ledger = require("../lib/evidenceLedger");
const { ApiError } = require("../lib/api-error");
const { callLearnerApi } = require("../lib/learnerApi");
const { contributionSummary } = require("../lib/contributions");
const { AUDIENCES, normaliseAudience } = require("../lib/audiences");
const evidence = require("./evidence.service");

const RECORD_VERSION = "impact-record-2026.1";
const SHARES = "impact_shares";
const MAX_LIVE_SHARES = 20;
const TOKEN = /^[A-Za-z0-9_-]{32}$/;

const hashOf = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");

const readingAgesOf = (story) => {
  const own = story.provenance?.audience ? [normaliseAudience(story.provenance.audience)] : [];
  const approved = Object.entries(story.levels || {}).filter(([, level]) => level?.approved).map(([band]) => normaliseAudience(band));
  return [...new Set([...own, ...approved])].filter((band) => AUDIENCES[band]);
};

/**
 * The record, as it stands now, and its signature. Throws 503 when the reader
 * counts cannot be read.
 */
async function buildImpactRecord(db, profileId, { learnerApi = callLearnerApi } = {}) {
  let counts;
  try {
    counts = (await learnerApi("GET", "/impact", { profileId })).impact;
  } catch (error) {
    throw new ApiError(503, "The reader counts could not be read just now, so no record was issued. Try again shortly.");
  }
  if (!counts) throw new ApiError(503, "The reader counts could not be read just now, so no record was issued. Try again shortly.");

  const [scholar, stories, contributions] = await Promise.all([
    db.collection("scholars").findOne({ profile_id: profileId }, { projection: { name: 1 } }),
    db
      .collection("scholar_editorials")
      .find({ profile_id: profileId, status: "published" }, { projection: { title: 1, slug: 1, published_at: 1, provenance: 1, levels: 1 } })
      .sort({ published_at: -1 })
      .toArray(),
    contributionSummary(db, profileId),
  ]);
  const byStory = new Map((counts.stories || []).map((s) => [s.editorialId, s]));
  const keys = evidence.keys();
  const share = Math.round((counts.understoodShare ?? 0.75) * 100);

  const record = {
    record_version: RECORD_VERSION,
    issued_at: new Date().toISOString(),
    key_id: keys ? keys.keyId : null,
    scholar: { profile_id: profileId, name: scholar?.name?.display || scholar?.name?.full || null },
    floor: counts.floor,
    totals: {
      stories_published: stories.length,
      readers: counts.readers,
      understood: counts.understood,
      circles_led: counts.circles?.led ?? 0,
      classes_in_circles: counts.circles?.classes ?? 0,
      schools_in_circles: counts.circles?.schools ?? 0,
    },
    stories: stories.map((story) => {
      const reached = byStory.get(String(story._id));
      return {
        title: story.title || "Untitled",
        slug: story.slug || null,
        published_at: story.published_at ? new Date(story.published_at).toISOString() : null,
        reading_ages: readingAgesOf(story),
        readers: reached?.readers ?? null,
        understood: reached?.understood ?? null,
      };
    }),
    contributions: {
      by_kind: contributions.byKind,
      first_at: contributions.firstAt ? new Date(contributions.firstAt).toISOString() : null,
      last_at: contributions.lastAt ? new Date(contributions.lastAt).toISOString() : null,
    },
    terms: {
      readers: "Learners who answered the questions after reading the story, at any reading age; each counted once per story, and once in the totals.",
      understood: `Readers who got at least ${share}% of a story's questions right on their first try.`,
      floor: `A count is given only when at least ${counts.floor} readers stand behind it; with fewer, the record gives none and says so. No reader, class or school is named.`,
    },
  };
  return { record, signature: keys ? ledger.sign(record, keys) : null, keyId: keys ? keys.keyId : null, signed: Boolean(keys) };
}

const shareView = (row) => ({
  id: String(row._id),
  label: row.label || null,
  createdAt: row.created_at,
  revokedAt: row.revoked_at || null,
  views: row.views || 0,
  lastViewedAt: row.last_viewed_at || null,
});

async function listShares(db, profileId) {
  const rows = await db.collection(SHARES).find({ profile_id: profileId }).sort({ created_at: -1 }).limit(50).toArray();
  return rows.map(shareView);
}

/** A new share link. The token is returned once, here; only its hash is kept. */
async function createShare(db, profileId, label) {
  const live = await db.collection(SHARES).countDocuments({ profile_id: profileId, revoked_at: null });
  if (live >= MAX_LIVE_SHARES) throw new ApiError(409, `You have ${MAX_LIVE_SHARES} links open. Turn one off first.`);
  const token = crypto.randomBytes(24).toString("base64url");
  const row = {
    profile_id: profileId,
    token_hash: hashOf(token),
    label: typeof label === "string" && label.trim() ? label.trim().slice(0, 80) : null,
    created_at: new Date(),
    revoked_at: null,
    views: 0,
    last_viewed_at: null,
  };
  const { insertedId } = await db.collection(SHARES).insertOne(row);
  return { share: shareView({ ...row, _id: insertedId }), token };
}

async function revokeShare(db, profileId, shareId) {
  const { ObjectId } = require("mongodb");
  if (!ObjectId.isValid(shareId)) throw new ApiError(404, "Not found.");
  const result = await db.collection(SHARES).findOneAndUpdate(
    { _id: new ObjectId(shareId), profile_id: profileId, revoked_at: null },
    { $set: { revoked_at: new Date() } },
    { returnDocument: "after" },
  );
  const row = result?.value ?? result;
  if (!row || !row._id) throw new ApiError(404, "Not found.");
  return shareView(row);
}

/** The record behind a share link, newly signed; a link turned off, or never made, is a 404. */
async function sharedRecord(db, token, deps = {}) {
  if (!TOKEN.test(String(token || ""))) throw new ApiError(404, "This link was turned off, or never existed.");
  const share = await db.collection(SHARES).findOneAndUpdate(
    { token_hash: hashOf(token), revoked_at: null },
    { $inc: { views: 1 }, $set: { last_viewed_at: new Date() } },
    { returnDocument: "after" },
  );
  const row = share?.value ?? share;
  if (!row || !row._id) throw new ApiError(404, "This link was turned off, or never existed.");
  return buildImpactRecord(db, row.profile_id, deps);
}

/** Checks a record and signature against this deployment's key. Anyone may. */
function verifyRecord({ record, signature }) {
  if (!record || typeof record !== "object") throw new ApiError(400, "A record is required.");
  const keys = evidence.keys();
  if (!keys) return { valid: false, reason: "this deployment has no signing key", keyId: null };
  if (record.key_id && record.key_id !== keys.keyId) {
    return { valid: false, reason: `the record was signed with key ${record.key_id}; this deployment's key is ${keys.keyId}`, keyId: keys.keyId };
  }
  return { ...ledger.verify(record, signature, ledger.publicKeyPem(keys)), keyId: keys.keyId };
}

module.exports = { RECORD_VERSION, SHARES, buildImpactRecord, listShares, createShare, revokeShare, sharedRecord, verifyRecord, hashOf };
