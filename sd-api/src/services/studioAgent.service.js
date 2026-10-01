"use strict";

/**
 * The studio agent, wired to a scholar's papers and stories: what they mean
 * when they talk to it, and what it could do next on their page.
 */

const { getDb, COLLECTIONS } = require("../db/mongo");
const { ApiError } = require("../lib/api-error");
const converse = require("../lib/agents/studioConverse");
const ideasAgent = require("../lib/agents/studioIdeas");
const vertex = require("../lib/vertex");
const { listDraftSources } = require("./drafting.service");
const editorial = require("./editorial.service");
const { getPolicy } = require("./policy.service");
const { routerFor } = require("./models.service");
const { recordDecision } = require("./agentAudit.service");

const { VOICES, AUDIENCE_LIST } = converse;

const paperKey = (p) => `${p.origin}:${p.id}`;

async function papersFor(profileId) {
  const inv = await listDraftSources({ profileId });
  return { inventory: inv, papers: (inv.draftable || []).map((p) => ({ key: paperKey(p), title: p.title, year: p.year || null, words: p.words || p.wordCount || null })) };
}

/**
 * What the scholar means by what they just said.
 *
 * @param {object} p
 * @param {string} p.profileId
 * @param {string} [p.scholarName]
 * @param {{role:string,text:string}[]} p.messages
 * @param {object} p.state
 */
async function converseWith({ profileId, scholarName = null, messages, state = {} }) {
  if (!vertex.isConfigured()) throw new ApiError(503, `The studio agent is not available on this deployment. ${vertex.describeMissingConfig()}`);
  const db = await getDb();
  const policy = await getPolicy("studio", { db });
  const clean = (Array.isArray(messages) ? messages : [])
    .map((m) => ({ role: m?.role === "agent" ? "agent" : "scholar", text: String(m?.text || "").replace(/\s+/g, " ").trim().slice(0, 2000) }))
    .filter((m) => m.text)
    .slice(-policy.converse.historyMessages);
  if (!clean.length || clean[clean.length - 1].role !== "scholar") throw new ApiError(400, "Say something to the agent.");
  const { papers } = await papersFor(profileId);
  /* What the page says is set, kept to values that exist for this scholar. */
  const s = state && typeof state === "object" ? state : {};
  const known = (list, v) => (list.some((x) => x.value === v) ? v : null);
  const paperKeySet = papers.some((p) => p.key === s.paperKey) ? s.paperKey : null;
  const said = {
    paperKey: paperKeySet,
    paperFrom: paperKeySet ? (s.paperFrom === "shelf" ? "shelf" : "conversation") : null,
    audience: known(AUDIENCE_LIST, s.audience),
    voice: known(VOICES, s.voice),
    extraAudiences: (Array.isArray(s.extraAudiences) ? s.extraAudiences : []).filter((a) => known(AUDIENCE_LIST, a)),
    stage: converse.STAGES.includes(s.stage) ? s.stage : "start",
    outlineTitle: typeof s.outlineTitle === "string" ? s.outlineTitle.slice(0, 200) : null,
  };
  const router = await routerFor({ db });
  const out = await converse.decide({ messages: clean, papers, audiences: AUDIENCE_LIST, voices: VOICES, state: said, scholarName, generate: router.bound("studio.converse") });
  if (!out.decision) throw new ApiError(502, "The agent could not make sense of that just now. Try saying it another way.");
  void recordDecision({ agent: "studio.converse", subject: { kind: "scholar", id: profileId }, decision: { action: out.decision.action, paperKey: out.decision.paperKey, audience: out.decision.audience, voice: out.decision.voice, stage: said.stage }, rationale: out.decision.rationale, model: out.model, promptVersion: converse.CONVERSE_VERSION, usage: out.usage[0] || null }, { db });
  const { rationale, paperKnown, ...decision } = out.decision;
  return { decision };
}

/**
 * Ideas for the page the scholar is on: a story in review, or a new story.
 * Cached per story version and paragraph, or per paper chosen.
 */
async function ideasFor({ profileId, scholarId, storyId = null, paperKey: chosenKey = null, focusIndex = null }) {
  if (!vertex.isConfigured()) return { groups: [] };
  const db = await getDb();
  const policy = await getPolicy("studio", { db });
  const router = await routerFor({ db });
  const coll = db.collection(COLLECTIONS.agentIdeas);
  const focus = Number.isInteger(focusIndex) && focusIndex > 0 ? focusIndex : null;

  let key;
  let make;
  if (storyId) {
    const doc = await editorial.findOwnedStory({ storyId, scholarId, profileId });
    const mapped = editorial.mapStoryDocument(doc, null, null);
    key = `story:${String(doc._id)}:${mapped.version}:${focus || 0}:${ideasAgent.IDEAS_VERSION}`;
    make = () => ideasAgent.ideasForStory({
      title: mapped.title,
      blocks: mapped.bodyBlocks.map((b, i) => ({
        index: i + 1,
        type: b.type,
        text: b.type === "image" ? `(illustration) ${b.caption || ""}` : String(b.html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
        fidelity: b.extension ? null : b.fidelity?.verdict || null,
        reach: b.extension ? b.reach?.verdict || "unjudged" : null,
        ownView: Boolean(b.ownView),
        edited: b.traceable === false,
      })),
      record: mapped.record?.alerts?.length ? mapped.record.headline : null,
      audience: mapped.provenance?.audience || doc.provenance?.audience || "adults",
      focusIndex: focus,
      count: policy.ideas.count,
      generate: router.bound("studio.ideas"),
    });
  } else {
    const { papers } = await papersFor(profileId);
    const chosen = papers.find((p) => p.key === chosenKey) || null;
    key = `new:${profileId}:${papers.map((p) => p.key).join(",")}:${chosen?.key || ""}:${ideasAgent.IDEAS_VERSION}`;
    make = () => ideasAgent.ideasForNewStory({ papers, chosen, count: policy.ideas.count, generate: router.bound("studio.ideas") });
  }

  const hit = await coll.findOne({ key });
  if (hit) return { groups: hit.groups, cached: true };
  const made = await make();
  if (made.groups.length) {
    await coll.updateOne({ key }, { $set: { key, groups: made.groups, model: made.model, created_at: new Date(), expires_at: new Date(Date.now() + policy.ideas.cacheHours * 60 * 60 * 1000) } }, { upsert: true });
  }
  return { groups: made.groups, cached: false };
}

module.exports = { converseWith, ideasFor, VOICES, AUDIENCE_LIST };
