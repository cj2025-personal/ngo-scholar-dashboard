/**
 * Watching the record, as a service: find the DOI behind a story, ask
 * Crossref what has been registered against it, keep the answer on the
 * story, and sweep every public story on a schedule.
 *
 * The answer is derived data: it is written beside the story without
 * touching the version, so a check can never refuse a scholar's next save.
 * What to do about a notice is the scholar's decision, put in front of them
 * in the workspace and on the Studio; the reader is told too, because a
 * retraction is not something to keep from the person reading the claim.
 */

const { COLLECTIONS } = require("../db/mongo");
const { ApiError } = require("../lib/api-error");
const { env } = require("../config/env");
const record = require("../lib/record");
const { serializeMongoValue } = require("../lib/serialize");

const CROSSREF = "https://api.crossref.org/works/";
const TIMEOUT_MS = 15000;

/** The DOI of the paper a story was drawn from, wherever the source keeps it. */
async function sourceDoiFor(db, storyDoc) {
  const p = storyDoc?.provenance;
  if (!p || !p.source_id) return null;
  if (p.origin === "contributed") {
    const doc = await db.collection("scholar_documents").findOne({ document_id: p.source_id }, { projection: { doi: 1, source_url: 1, url: 1 } });
    return record.doiFrom(doc?.doi || doc?.source_url || doc?.url);
  }
  const src = await db.collection("source_texts").findOne({ source_id: p.source_id }, { projection: { doi: 1, source_url: 1, resolved_url: 1 } });
  return record.doiFrom(src?.doi || src?.source_url || src?.resolved_url);
}

/**
 * A Crossref work by DOI: its `message`, or null when Crossref has no record.
 * With the fake model provider, RECORD_FAKE holds a JSON map of DOI to
 * message so the suites can drive a retraction end to end without the network.
 */
async function fetchWork(doi, { fetchImpl = fetch } = {}) {
  if (env.llm.provider === "fake" && !env.isProduction) {
    let map = {};
    try { map = JSON.parse(process.env.RECORD_FAKE || "{}"); } catch { map = {}; }
    return map[doi] || null;
  }
  const url = `${CROSSREF}${encodeURIComponent(doi)}${env.record.crossrefMailto ? `?mailto=${encodeURIComponent(env.record.crossrefMailto)}` : ""}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { headers: { Accept: "application/json", "User-Agent": "archivyn-scholar-dashboard (record watch)" }, signal: controller.signal });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Crossref answered ${res.status} for ${doi}`);
    const body = await res.json();
    return body?.message || null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Check one story against the record and store what was found.
 * @returns {Promise<{doi: string|null, alerts: object[], notices: number, checked: boolean}>}
 */
async function checkStoryDoc(db, storyDoc, { fetchImpl } = {}) {
  const editorial = require("./editorial.service");
  const collection = db.collection(COLLECTIONS.scholarEditorials);
  const doi = await sourceDoiFor(db, storyDoc);
  const now = new Date();
  if (!doi) {
    await collection.updateOne({ _id: storyDoc._id }, { $set: { record: { version: record.RECORD_VERSION, doi: null, checked_at: now, alerts: [], notices: 0, reason: "no DOI on record for the source" } } });
    return { doi: null, alerts: [], notices: 0, checked: false };
  }
  const work = await fetchWork(doi, { fetchImpl });
  const notices = record.noticesFrom(work);
  const [author, provenance] = await Promise.all([editorial.resolveStoryAuthor(db, storyDoc.profile_id), editorial.resolveStoryProvenance(db, storyDoc.provenance)]);
  const mapped = editorial.mapStoryDocument(storyDoc, author, provenance);
  const alerts = record.alertsFor({ notices, story: mapped });
  /* An acknowledgement survives a re-check unless the alerts changed. */
  const before = storyDoc.record || {};
  const same = JSON.stringify((before.alerts || []).map((a) => [a.kind, a.notice_doi])) === JSON.stringify(alerts.map((a) => [a.kind, a.notice_doi]));
  await collection.updateOne(
    { _id: storyDoc._id },
    { $set: { record: { version: record.RECORD_VERSION, doi, checked_at: now, alerts, notices: notices.length, reason: work ? null : "Crossref has no record of this DOI", acknowledged_at: same ? before.acknowledged_at || null : null } } },
  );
  return { doi, alerts, notices: notices.length, checked: true };
}

/** The scholar asks now. */
async function checkStory({ storyId, scholarId, profileId }) {
  const editorial = require("./editorial.service");
  const { getDb } = require("../db/mongo");
  const db = await getDb();
  const storyDoc = await editorial.findOwnedStory({ storyId, scholarId, profileId });
  const result = await checkStoryDoc(db, storyDoc);
  const story = await editorial.getEditorialStory({ storyId, scholarId, profileId });
  return serializeMongoValue({ ...story, result });
}

/** The scholar has seen it. The alert stays; the nagging stops. */
async function acknowledge({ storyId, scholarId, profileId }) {
  const editorial = require("./editorial.service");
  const { getDb } = require("../db/mongo");
  const db = await getDb();
  const storyDoc = await editorial.findOwnedStory({ storyId, scholarId, profileId });
  if (!storyDoc.record?.alerts?.length) throw new ApiError(409, "There is nothing to acknowledge on this story.");
  await db.collection(COLLECTIONS.scholarEditorials).updateOne({ _id: storyDoc._id }, { $set: { "record.acknowledged_at": new Date() } });
  return editorial.getEditorialStory({ storyId, scholarId, profileId });
}

/**
 * Every public story with a source, checked. Meant for a scheduler, once a
 * day is plenty; the record does not move faster than that.
 */
async function sweepPublished({ limit = 200, fetchImpl } = {}) {
  const { getDb } = require("../db/mongo");
  const db = await getDb();
  const collection = db.collection(COLLECTIONS.scholarEditorials);
  const docs = await collection
    .find({ status: { $in: ["published", "scheduled"] }, "provenance.source_id": { $exists: true, $ne: null } })
    .sort({ "record.checked_at": 1 })
    .limit(Math.min(Number(limit) || 200, 1000))
    .toArray();
  const out = { checked: 0, skipped: 0, alerted: 0, failed: 0, stories: [] };
  for (const doc of docs) {
    try {
      const r = await checkStoryDoc(db, doc, { fetchImpl });
      if (!r.checked) out.skipped += 1; else out.checked += 1;
      if (r.alerts.length) { out.alerted += 1; out.stories.push({ id: String(doc._id), slug: doc.slug, alerts: r.alerts.map((a) => a.kind) }); }
    } catch (error) {
      out.failed += 1;
      console.error(`[record] could not check story ${doc._id}:`, error.message);
    }
  }
  return out;
}

module.exports = { sourceDoiFor, fetchWork, checkStoryDoc, checkStory, acknowledge, sweepPublished };
