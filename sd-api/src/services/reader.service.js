"use strict";

/**
 * The reading companion, wired to published stories.
 *
 * ── One question, start to finish ───────────────────────────────────────────
 *   1. The guard model reads the question first. It names the personal spans
 *      to mask, says whether the question is about the reader, what kind of
 *      question it is, and whether to answer it at all. The masked question
 *      is the only version stored or shown to another model.
 *   2. The story is loaded as the public sees it, at the reader's level, with
 *      the paper's passages; the companion can search both by meaning.
 *   3. The conversation so far: the recent turns word for word, and a model's
 *      running summary of the ones before.
 *   4. The companion reads, decides and answers, narrating each step.
 *   5. The Sentinel rules on the answer: pass, revise with guidance, or refuse.
 *      The companion revises as many rounds as the policy allows.
 *   6. A refused question gets a refusal a model writes from the reasons.
 *   7. The turn is stored with every decision and its reason, the models
 *      that made them, and what it cost. Each agent's decision is also
 *      written to the audit log.
 *
 * Every limit, model and message comes from the reader and models policies.
 */

const { COLLECTIONS, getDb } = require("../db/mongo");
const { ApiError } = require("../lib/api-error");
const { serializeMongoValue } = require("../lib/serialize");
const { AUDIENCES, normaliseAudience } = require("../lib/audiences");
const agent = require("../lib/readingAgent");
const sentinel = require("../lib/sentinel");
const companion = require("../lib/companion");
const guard = require("../lib/agents/readerGuard");
const memory = require("../lib/agents/readerMemory");
const suggest = require("../lib/agents/readerSuggest");
const vertex = require("../lib/vertex");
const { env } = require("../config/env");
const editorial = require("./editorial.service");
const { passagesFor } = require("./passages.service");
const quota = require("./readerQuota.service");
const { getPolicy } = require("./policy.service");
const { routerFor } = require("./models.service");
const { searcherFor } = require("./readerIndex.service");
const { recordDecision } = require("./agentAudit.service");

const OUTCOME = { ANSWERED: "answered", NOT_HERE: "not_here", CLARIFY: "clarify", REFUSED: "refused", FAILED: "failed" };

function viewTurn(doc) {
  return serializeMongoValue({
    id: doc._id,
    storySlug: doc.story_slug,
    storyTitle: doc.story_title,
    level: doc.audience,
    question: doc.question,
    questionRedacted: Array.isArray(doc.question_redacted) ? doc.question_redacted : [],
    intent: doc.answer?.intent || doc.guard?.intent || null,
    focusIndex: doc.focus_index,
    steps: (doc.steps || []).map((s) => ({ tool: s.tool, summary: s.summary })),
    outcome: doc.outcome,
    /* What the reader was shown. */
    text: doc.shown_text ?? doc.answer?.text ?? "",
    answer: doc.answer ? { text: doc.answer.text, grounding: doc.answer.grounding, intent: doc.answer.intent || null, blockIds: doc.answer.blockIds, passageIds: doc.answer.passageIds, term: doc.answer.term || null, followUps: doc.answer.followUps || [] } : null,
    sentinel: doc.sentinel ? { verdict: doc.sentinel.verdict, reasons: doc.sentinel.reasons, attempts: doc.sentinel.attempts } : null,
    declinedBy: doc.declined_by || null,
    createdAt: doc.created_at,
  });
}

async function loadPublicStory(db, slug) {
  const story = await db.collection(COLLECTIONS.scholarEditorials).findOne({ slug: String(slug || "").trim(), ...editorial.buildPublicStoryQuery() });
  if (!story) throw new ApiError(404, "Published story not found.");
  return story;
}

/**
 * Which blocks the reader is reading: the level they chose, if the scholar
 * approved it and it still says what the article says; else the article.
 * Access, not judgement: a level no scholar approved is never read to anyone.
 */
function blocksForLevel(mapped, level) {
  const own = normaliseAudience(mapped.provenance?.audience || "adults");
  const wanted = level ? normaliseAudience(level) : null;
  if (wanted && wanted !== own) {
    const l = mapped.levels.find((x) => x.audience === wanted && x.approved && !x.stale);
    if (l) return { audience: wanted, blocks: agent.blocksFromStory(l.blocks) };
  }
  return { audience: own, blocks: agent.blocksFromStory(mapped.bodyBlocks) };
}

/** One line per turn, numbers only: what the dashboards and alerts read. */
function logTurn(doc) {
  const tokens = (doc.usage || []).reduce((a, u) => ({ input: a.input + (u?.input || 0), output: a.output + (u?.output || 0) }), { input: 0, output: 0 });
  console.log("[reader] turn", JSON.stringify({
    story: doc.story_slug, audience: doc.audience, outcome: doc.outcome, declinedBy: doc.declined_by || null,
    intent: doc.answer?.intent || doc.guard?.intent || null, verdict: doc.sentinel?.verdict || null, reasons: doc.sentinel?.reasons || [], attempts: doc.sentinel?.attempts || 0,
    grounding: doc.answer?.grounding || null, calls: (doc.calls || []).length, models: [...new Set(doc.models || [])], fallbacks: doc.fallbacks || 0, tokens, ms: doc.ms, redacted: doc.question_redacted || [],
  }));
}

/** The models the reader's age calls for, and their safety thresholds. */
function bindings(router, readerPolicy, young) {
  const safety = young ? readerPolicy.safety.young : readerPolicy.safety.older;
  const extra = Array.isArray(safety) && safety.length ? { safetySettings: safety } : {};
  return {
    guard: router.bound("reader.guard", extra),
    agent: router.bound("reader.agent", extra),
    judge: router.bound("reader.sentinel", extra),
    refusal: router.bound("reader.refusal", extra),
    memory: router.bound("reader.memory", extra),
  };
}

/**
 * Answer one question about one story.
 *
 * @param {object} p
 * @param {string} p.slug
 * @param {string} p.readerKey
 * @param {string} p.question
 * @param {string|null} [p.level]
 * @param {number|null} [p.focusIndex]
 * @param {AbortSignal} [p.signal]
 * @param {(e:object)=>Promise<void>} [p.onProgress]
 */
async function askReader({ slug, readerKey, question, level = null, focusIndex = null, signal = null, onProgress = async () => {} }) {
  if (!vertex.isConfigured()) throw new ApiError(503, "The reading companion is not available on this deployment.");
  const db = await getDb();
  const policy = await getPolicy("reader", { db });
  const raw = String(question || "").replace(/\s+/g, " ").trim();
  if (!raw) throw new ApiError(400, "Ask something about the story.");
  if (raw.length > policy.question.maxChars) throw new ApiError(400, `Keep a question under ${policy.question.maxChars} characters.`);

  const story = await loadPublicStory(db, slug);
  const { remaining } = await quota.takeAsk(db, { readerKey });

  const mapped = editorial.mapStoryDocument(story, null, null);
  mapped.levels = mapped.levels.filter((l) => l.approved && !l.stale);
  const { audience, blocks } = blocksForLevel(mapped, level);
  const passages = await passagesFor(db, story);
  const young = Boolean(AUDIENCES[audience]?.young);

  const calls = [];
  const router = await routerFor({ db, collect: calls });
  const gen = bindings(router, policy, young);
  const withSignal = (fn) => (signal ? (req) => fn({ ...req, signal }) : fn);
  const subject = { kind: "reader_turn", id: `${String(story._id)}:${readerKey.slice(0, 12)}` };
  const startedAt = Date.now();
  const focus = Number.isInteger(focusIndex) && focusIndex > 0 ? focusIndex : null;
  const turns = db.collection(COLLECTIONS.readerTurns);
  const stamp = (doc) => {
    const now = new Date();
    return {
      ...doc,
      models: calls.filter((c) => c.ok).map((c) => c.model),
      fallbacks: calls.filter((c) => c.ok && c.fallback).length,
      created_at: now,
      expires_at: new Date(now.getTime() + env.reader.turnsTtlDays * 24 * 60 * 60 * 1000),
    };
  };
  const base = {
    reader_key: readerKey,
    story_id: story._id,
    story_slug: story.slug,
    story_title: mapped.title,
    story_version: mapped.version,
    audience,
    focus_index: focus,
    versions: { agent: agent.AGENT_VERSION, sentinel: sentinel.SENTINEL_VERSION, guard: guard.GUARD_VERSION, memory: memory.MEMORY_VERSION, policy: policy._version },
  };

  /* Stopped, not finished: recorded as such, and said in the policy's words. */
  const stopped = async (error, partial = {}) => {
    const doc = stamp({ ...base, question: partial.question || "[not screened]", question_redacted: partial.redacted || [], steps: partial.steps || [], answer: null, outcome: OUTCOME.FAILED, shown_text: policy.messages.failed, sentinel: null, usage: [], stopped: String(signal?.reason || error.message).slice(0, 80), ms: Date.now() - startedAt });
    const inserted = await turns.insertOne(doc);
    logTurn(doc);
    const e = new ApiError(504, policy.messages.failed);
    e.turn = viewTurn({ ...doc, _id: inserted.insertedId });
    return e;
  };

  /* 1. The guard. A question nobody could screen is not answered or kept. */
  await onProgress({ type: "step", tool: "guard", summary: "Reading your question" });
  let screened;
  try {
    screened = await guard.screenQuestion({ question: raw, audience, storyTitle: mapped.title, headings: blocks.filter((b) => b.type === "subheading" || b.type === "heading").map((b) => b.text), generate: withSignal(gen.guard) });
  } catch (error) {
    if (error?.name === "AbortError") throw await stopped(error);
    if (error?.code === "BLOCKED") {
      screened = { decision: { pii: [], aboutReader: false, intent: "unsafe", route: "decline", declineReason: "unsafe", rationale: "The model declined on safety grounds." }, masked: "[a question the safety filter declined]", applied: [], usage: null, model: null };
    } else {
      console.error("[reader] guard failed", error);
      throw new ApiError(503, "The companion can't read questions right now. Try again in a moment.");
    }
  }
  const q = screened.masked;
  void recordDecision({ agent: "reader.guard", subject, decision: { route: screened.decision.route, intent: screened.decision.intent, aboutReader: screened.decision.aboutReader, declineReason: screened.decision.declineReason, masked: screened.applied }, rationale: screened.decision.rationale, model: screened.model, promptVersion: guard.GUARD_VERSION, usage: screened.usage }, { db });
  const guardDoc = { route: screened.decision.route, intent: screened.decision.intent, about_reader: screened.decision.aboutReader, decline_reason: screened.decision.declineReason, rationale: screened.decision.rationale, model: screened.model };

  if (screened.decision.route === "decline") {
    const written = await sentinel.writeRefusal({ reasons: [screened.decision.declineReason], audience, storyTitle: mapped.title, generate: withSignal(gen.refusal) });
    const doc = stamp({ ...base, question: q, question_redacted: screened.applied, question_about_reader: screened.decision.aboutReader, guard: guardDoc, steps: [{ tool: "guard", summary: "Reading your question" }], answer: null, outcome: OUTCOME.REFUSED, declined_by: "guard", shown_text: written.text || policy.messages.refusalFallback, sentinel: null, usage: [screened.usage, written.usage].filter(Boolean), ms: Date.now() - startedAt });
    const inserted = await turns.insertOne(doc);
    logTurn(doc);
    const turn = viewTurn({ ...doc, _id: inserted.insertedId });
    return { turn, text: turn.text, remaining };
  }

  /* 3. The conversation so far: recent turns verbatim, older ones summarised. */
  const window = Math.max(0, Number(policy.history.recentTurns) || 0);
  const prior = window ? await turns.find({ reader_key: readerKey, story_id: story._id, outcome: { $ne: OUTCOME.FAILED } }).sort({ created_at: -1 }).limit(window).toArray() : [];
  const history = [...prior].reverse().flatMap((t) => [
    { role: "user", text: t.question_about_reader ? policy.messages.historyAboutReader : t.question },
    { role: "model", text: t.shown_text ?? t.answer?.text ?? "" },
  ]);
  const totalBefore = await turns.countDocuments({ reader_key: readerKey, story_id: story._id, outcome: { $ne: OUTCOME.FAILED } });
  const latest = prior[0] || null;
  let threadSummary = latest?.thread_summary || null;
  let summaryCovers = latest?.summary_covers || 0;
  const aged = Math.max(0, totalBefore - window);
  const memoryUsage = [];
  if (aged > summaryCovers) {
    const leaving = await turns.find({ reader_key: readerKey, story_id: story._id, outcome: { $ne: OUTCOME.FAILED } }).sort({ created_at: 1 }).skip(summaryCovers).limit(aged - summaryCovers).toArray();
    try {
      const m = await memory.summarise({ previous: threadSummary, turns: leaving.map((t) => ({ question: t.question_about_reader ? policy.messages.historyAboutReader : t.question, answer: t.shown_text ?? t.answer?.text ?? "" })), maxWords: policy.history.summaryWords, generate: withSignal(gen.memory) });
      threadSummary = m.summary;
      summaryCovers = aged;
      if (m.usage) memoryUsage.push(m.usage);
    } catch (error) {
      if (error?.name === "AbortError") throw await stopped(error, { question: q, redacted: screened.applied });
      /* Memory is a help, not a requirement: carry on with the last summary. */
      console.warn(`[reader] summarising the thread failed: ${error.message}`);
    }
  }

  /* 4–6. Answer, rule, revise, or refuse. */
  const search = searcherFor({
    db, router,
    key: { story_id: story._id, story_version: mapped.version, audience },
    blocks, passages, topK: policy.retrieval.topK, cacheDays: policy.index.cacheDays, signal,
  });
  let result;
  try {
    result = await companion.answerQuestion({
      blocks, passages, question: q, audience, storyTitle: mapped.title, focusIndex: focus, history, threadSummary, search,
      limits: { agent: policy.agent, sentinel: policy.sentinel },
      generate: gen.agent, judge: gen.judge, refusal: gen.refusal, refusalFallback: policy.messages.refusalFallback,
      signal, onProgress,
    });
  } catch (error) {
    if (error?.name !== "AbortError") throw error;
    throw await stopped(error, { question: q, redacted: screened.applied });
  }

  const { answer, check, attempts, rulings, refusalText, steps } = result;
  const passed = Boolean(answer);
  const outcome = !passed ? OUTCOME.REFUSED
    : answer.grounding === agent.GROUNDING.NOT_HERE ? OUTCOME.NOT_HERE
    : answer.grounding === agent.GROUNDING.CLARIFY ? OUTCOME.CLARIFY
    : OUTCOME.ANSWERED;
  if (check) void recordDecision({ agent: "reader.sentinel", subject, decision: { verdict: check.verdict, reasons: check.reasons, attempts, rounds: rulings.map((x) => x.verdict) }, rationale: check.rationale, model: check.model, promptVersion: sentinel.SENTINEL_VERSION, usage: check.usage }, { db });

  const doc = stamp({
    ...base,
    question: q,
    question_redacted: screened.applied,
    question_about_reader: screened.decision.aboutReader,
    guard: guardDoc,
    steps: [{ tool: "guard", summary: "Reading your question" }, ...steps.map((s) => ({ tool: s.tool, summary: s.summary, result: String(s.result || "").slice(0, 400) }))],
    calls: result.calls.map((c) => ({ name: c.name, args: c.args, result: String(c.result || "").slice(0, 400) })),
    answer: passed ? answer : null,
    outcome,
    declined_by: passed ? null : "sentinel",
    shown_text: passed ? answer.text : refusalText || policy.messages.refusalFallback,
    sentinel: check ? { verdict: check.verdict, reasons: check.reasons, guidance: check.guidance, rationale: check.rationale, claims: check.claims || [], overall: check.overall || null, attempts, rulings, version: sentinel.SENTINEL_VERSION } : null,
    thread_summary: threadSummary,
    summary_covers: summaryCovers,
    usage: [screened.usage, ...memoryUsage, ...(result.usage || [])].filter(Boolean),
    ms: Date.now() - startedAt,
  });
  const inserted = await turns.insertOne(doc);
  logTurn(doc);
  const turn = viewTurn({ ...doc, _id: inserted.insertedId });
  return { turn, text: turn.text, remaining };
}

/**
 * Questions worth asking about a story, written by a model, cached per story
 * version, reading level and paragraph in focus.
 */
async function suggestionsFor({ slug, level = null, focusIndex = null }) {
  if (!vertex.isConfigured()) return { groups: [] };
  const db = await getDb();
  const policy = await getPolicy("reader", { db });
  const story = await loadPublicStory(db, slug);
  const mapped = editorial.mapStoryDocument(story, null, null);
  mapped.levels = mapped.levels.filter((l) => l.approved && !l.stale);
  const { audience, blocks } = blocksForLevel(mapped, level);
  const focus = Number.isInteger(focusIndex) && focusIndex > 0 && focusIndex <= blocks.length ? focusIndex : null;
  const key = `${String(story._id)}:${mapped.version}:${audience}:${focus || 0}:${suggest.SUGGEST_VERSION}`;
  const coll = db.collection(COLLECTIONS.readerSuggestions);
  const hit = await coll.findOne({ key });
  if (hit) return { groups: hit.groups, cached: true };
  const router = await routerFor({ db });
  const young = Boolean(AUDIENCES[audience]?.young);
  const safety = young ? policy.safety.young : policy.safety.older;
  const made = await suggest.suggestQuestions({ title: mapped.title, blocks, audience, focus, count: policy.suggestions.count, generate: router.bound("reader.suggest", Array.isArray(safety) && safety.length ? { safetySettings: safety } : {}) });
  if (made.groups.length) {
    await coll.updateOne({ key }, { $set: { key, groups: made.groups, model: made.model, created_at: new Date(), expires_at: new Date(Date.now() + policy.suggestions.cacheHours * 60 * 60 * 1000) } }, { upsert: true });
  }
  return { groups: made.groups, cached: false };
}

/** This reader's questions about one story, oldest first, so a thread reads as one. */
async function listStoryTurns({ slug, readerKey }) {
  const db = await getDb();
  const story = await loadPublicStory(db, slug);
  const rows = await db.collection(COLLECTIONS.readerTurns).find({ reader_key: readerKey, story_id: story._id }).sort({ created_at: 1 }).limit(50).toArray();
  return { turns: rows.map(viewTurn), remaining: await quota.remainingFor(db, { readerKey }) };
}

/** Everything this reader has asked, newest first: the audit trail. */
async function listReaderTurns({ readerKey }) {
  const db = await getDb();
  const rows = await db.collection(COLLECTIONS.readerTurns).find({ reader_key: readerKey }).sort({ created_at: -1 }).limit(200).toArray();
  return { turns: rows.map(viewTurn), remaining: await quota.remainingFor(db, { readerKey }), keepDays: env.reader.turnsTtlDays };
}

/** Forget this reader: every turn under the key goes. The caller rotates the cookie. */
async function forgetReader({ readerKey }) {
  const db = await getDb();
  const r = await db.collection(COLLECTIONS.readerTurns).deleteMany({ reader_key: readerKey });
  return { forgotten: r.deletedCount || 0 };
}

module.exports = { askReader, suggestionsFor, listStoryTurns, listReaderTurns, forgetReader, viewTurn, blocksForLevel, OUTCOME };
