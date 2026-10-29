"use strict";

/**
 * The studio agent, wired to a scholar's papers and stories: what they mean
 * when they talk to it, and what it could do next on their page.
 */

const { ObjectId } = require("mongodb");
const { getDb, COLLECTIONS } = require("../db/mongo");
const { ApiError } = require("../lib/api-error");
const converse = require("../lib/agents/studioConverse");
const ideasAgent = require("../lib/agents/studioIdeas");
const vertex = require("../lib/vertex");
const { listDraftSources } = require("./drafting.service");
const { BRIEF_KEY, BRIEF_TITLE } = require("../lib/briefSource");
const editorial = require("./editorial.service");
const { getPolicy } = require("./policy.service");
const { routerFor } = require("./models.service");
const { recordDecision } = require("./agentAudit.service");

const { VOICES, AUDIENCE_LIST } = converse;

const paperKey = (p) => `${p.origin}:${p.id}`;

/* The scholar's papers, and — for anyone who may draft at all — writing from
   the brief alone, drawing on none of them. */
async function papersFor(profileId) {
  const inv = await listDraftSources({ profileId });
  const papers = (inv.draftable || []).map((p) => ({ key: paperKey(p), title: p.title, year: p.year || null, words: p.words || p.wordCount || null }));
  return { inventory: inv, papers: inv.eligible ? [...papers, { key: BRIEF_KEY, title: BRIEF_TITLE, year: null, words: null }] : papers };
}

/* ── the conversation, kept here ────────────────────────────────────────────
   The thread the model reads lives in this service, not in the page. The
   scholar's words and the agent's replies are appended as they are said, so
   a browser cannot rewrite either before the next turn, a reload picks the
   conversation up where it was, and the record of each decision sits beside
   the words it was made from. The page adds only what it did — an outline
   shown, approved, replaced — as notes in its own role, which the model
   reads as the agent's side and the record keeps apart. */

const LINE_CHARS = 2000;
const cleanLine = (t) => String(t || "").replace(/\s+/g, " ").trim().slice(0, LINE_CHARS);
const expiryFor = (policy, now) => new Date(now.getTime() + (Number(policy.converse.keepDays) || 14) * 24 * 60 * 60 * 1000);
const viewConversation = (row) => ({ conversationId: String(row._id), lines: (row.lines || []).filter((l) => l.text).map((l) => ({ role: l.role, text: l.text, at: l.at })), state: row.state || {}, updatedAt: row.updated_at });

/** The conversation the turn belongs to: the scholar's own, still open; or a new one. */
async function conversationFor(db, { profileId, conversationId, policy, now }) {
  const coll = db.collection(COLLECTIONS.studioConversations);
  if (conversationId) {
    if (!ObjectId.isValid(String(conversationId))) throw new ApiError(404, "No such conversation.");
    const row = await coll.findOne({ _id: new ObjectId(String(conversationId)), profile_id: profileId });
    if (!row) throw new ApiError(404, "No such conversation.");
    if (row.ended_at) throw new ApiError(409, "That conversation has ended. Start another.");
    return row;
  }
  const row = { _id: new ObjectId(), profile_id: profileId, lines: [], state: {}, created_at: now, updated_at: now, ended_at: null, expires_at: expiryFor(policy, now) };
  await coll.insertOne(row);
  return row;
}

/** The scholar's newest open conversation, to pick up on a reload; null when there is none. */
async function latestConversation({ profileId }) {
  const db = await getDb();
  const row = await db.collection(COLLECTIONS.studioConversations).find({ profile_id: profileId, ended_at: null }).sort({ updated_at: -1 }).limit(1).next();
  return { conversation: row ? viewConversation(row) : null };
}

/** Close a conversation: a draft landed, or the scholar started another. */
async function endConversation({ profileId, conversationId }) {
  const db = await getDb();
  if (!ObjectId.isValid(String(conversationId))) throw new ApiError(404, "No such conversation.");
  const r = await db.collection(COLLECTIONS.studioConversations).updateOne({ _id: new ObjectId(String(conversationId)), profile_id: profileId, ended_at: null }, { $set: { ended_at: new Date() } });
  if (!r.matchedCount) throw new ApiError(404, "No such conversation.");
  return { ended: true };
}

/**
 * What the scholar means by what they just said.
 *
 * @param {object} p
 * @param {string} p.profileId
 * @param {string} [p.scholarName]
 * @param {string|null} [p.conversationId]   the conversation to continue; a new one when absent
 * @param {string} p.message                 what the scholar just said or tapped
 * @param {string[]} [p.notes]               what the page did since the last turn, in the page's words
 * @param {object} p.state                   what the page says is set
 */
async function converseWith({ profileId, scholarName = null, conversationId = null, message, notes = [], state = {} }) {
  if (!vertex.isConfigured()) throw new ApiError(503, `The studio agent is not available on this deployment. ${vertex.describeMissingConfig()}`);
  const db = await getDb();
  const policy = await getPolicy("studio", { db });
  const spoken = cleanLine(message);
  if (!spoken) throw new ApiError(400, "Say something to the agent.");
  const now = new Date();
  const conversation = await conversationFor(db, { profileId, conversationId, policy, now });
  const noted = (Array.isArray(notes) ? notes : []).map(cleanLine).filter(Boolean).slice(0, Number(policy.converse.maxNotes) || 0).map((text) => ({ role: "page", text, at: now }));
  const lines = [...(conversation.lines || []), ...noted, { role: "scholar", text: spoken, at: now }];
  const clean = lines.filter((l) => l.text).map((l) => ({ role: l.role === "scholar" ? "scholar" : "agent", text: l.text })).slice(-policy.converse.historyMessages);
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
  void recordDecision({ agent: "studio.converse", subject: { kind: "scholar", id: profileId }, decision: { action: out.decision.action, paperKey: out.decision.paperKey, audience: out.decision.audience, voice: out.decision.voice, stage: said.stage, conversationId: String(conversation._id) }, rationale: out.decision.rationale, model: out.model, promptVersion: converse.CONVERSE_VERSION, usage: out.usage[0] || null }, { db });
  const { rationale, paperKnown, ...decision } = out.decision;
  /* The reply joins the thread before the page sees it, with the action it
     carried; an action with no words is still a line in the record. */
  await db.collection(COLLECTIONS.studioConversations).updateOne(
    { _id: conversation._id },
    { $set: { lines: [...lines, { role: "agent", text: cleanLine(decision.reply), action: decision.action, at: now }], state: said, updated_at: now, expires_at: expiryFor(policy, now) } },
  );
  return { conversationId: String(conversation._id), decision };
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
    /* Ideas are read from papers; the brief alone has none to read. */
    const papers = (await papersFor(profileId)).papers.filter((p) => p.key !== BRIEF_KEY);
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

module.exports = { converseWith, latestConversation, endConversation, ideasFor, VOICES, AUDIENCE_LIST };
