"use strict";

/**
 * Whether a saved story reads right for its reader, ruled by the reading
 * level judge and cached per story version.
 *
 * The publish check asks this before the scholar publishes. It used to be
 * the Flesch-Kincaid formula, run in the browser over the editor's text, and
 * a "fail" from it held publishing back. Now an editor model reads the saved
 * article as its reader would and rules; the formula's grade is still
 * measured and shown, as evidence. A ruling that cannot be had — no model on
 * this deployment, or one that could not be read — is reported as unchecked
 * and never blocks: the scholar is told, and decides.
 */

const { getDb, COLLECTIONS } = require("../db/mongo");
const editorial = require("./editorial.service");
const { assessDraftReadability, placeReadability } = require("../lib/draftReadability");
const bandJudge = require("../lib/agents/bandJudge");
const { normaliseAudience } = require("../lib/audiences");
const vertex = require("../lib/vertex");
const { getPolicy } = require("./policy.service");
const { routerFor } = require("./models.service");
const { recordDecision } = require("./agentAudit.service");

const plain = (html) => String(html || "").replace(/<[^>]+>/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

/**
 * @param {object} p
 * @param {string} p.storyId
 * @param {string} p.scholarId
 * @param {string} p.profileId
 * @returns {Promise<{version: number, audience: string, verdict: "pass"|"warn"|"fail", reason: string|null, judged: object, fkGrade: number|null, targetGrade: number, drift: number|null, cached: boolean}>}
 */
async function readingLevelFor({ storyId, scholarId, profileId }) {
  const db = await getDb();
  const doc = await editorial.findOwnedStory({ storyId, scholarId, profileId });
  const mapped = editorial.mapStoryDocument(doc, null, null);
  const audience = normaliseAudience(mapped.provenance?.audience || doc.provenance?.audience || "adults");
  const prose = mapped.bodyBlocks.filter((b) => b.type === "paragraph").map((b) => plain(b.html)).filter(Boolean).join("\n\n");
  const measured = assessDraftReadability({ text: prose, audience });
  const shape = (ruling, cached) => {
    const placed = placeReadability(measured, ruling);
    return { version: mapped.version, audience, verdict: placed.verdict, reason: placed.reason, judged: placed.judged, fkGrade: placed.fkGrade, targetGrade: placed.targetGrade, drift: placed.drift, cached };
  };
  if (!prose) return shape({ verdict: "unchecked", reason: "there is no prose to read yet" }, false);
  if (!vertex.isConfigured()) return shape({ verdict: "unchecked", reason: "no reading-level judge is available on this deployment" }, false);

  const key = `band:${String(doc._id)}:${mapped.version}:${audience}:${bandJudge.BAND_JUDGE_VERSION}`;
  const coll = db.collection(COLLECTIONS.agentRulings);
  const hit = await coll.findOne({ key });
  if (hit) return shape(hit.ruling, true);

  const drafting = await getPolicy("drafting", { db });
  const router = await routerFor({ db });
  const r = await bandJudge.judgeBand({ text: prose, audience, measured, generate: router.bound("drafting.band") });
  const ruling = { verdict: r.verdict, reason: r.reason, guidance: r.guidance, sentences: r.sentences };
  if (r.verdict !== "unchecked") {
    const now = new Date();
    await coll.updateOne({ key }, { $set: { key, kind: "band", story_id: doc._id, version: mapped.version, audience, ruling, created_at: now, expires_at: new Date(now.getTime() + drafting.rulingCacheDays * 24 * 60 * 60 * 1000) } }, { upsert: true });
  }
  void recordDecision({
    agent: "drafting.band", subject: { kind: "story", id: String(doc._id) },
    decision: { verdict: r.verdict, version: mapped.version, audience, fkGrade: measured.fkGrade },
    rationale: r.reason, model: r.calls[r.calls.length - 1]?.model || null, promptVersion: bandJudge.BAND_JUDGE_VERSION, usage: r.calls[0]?.usage || null,
  }, { db });
  return shape(ruling, false);
}

module.exports = { readingLevelFor };
