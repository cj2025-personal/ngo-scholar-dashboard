"use strict";

/**
 * The reading companion, wired to published stories.
 *
 * ── One question, start to finish ───────────────────────────────────────────
 *   1. The question is made safe to keep: addresses and numbers replaced,
 *      and a flag set when the reader wrote about themselves. The model and
 *      the database both see this version, never the original.
 *   2. The story is loaded as the public sees it: published, with only the
 *      approved, current reading levels. The reader's level picks the blocks.
 *   3. The passages of the paper are re-derived, exactly as the Sources
 *      toggle shows them, so a citation here points where a chip points.
 *   4. The agent reads and answers. Each tool call is reported as it
 *      happens, which is what the reader watches while waiting.
 *   5. The Sentinel reads the answer. Pass: the reader sees it. Rewrite: the
 *      agent tries once more with the reasons, and the Sentinel reads that.
 *      Refuse, or a second rewrite: the reader sees the fixed refusal.
 *   6. The turn is stored under the reader's key: what was asked, what was
 *      done, what was said, and what the Sentinel found. That row is the
 *      reader's own audit trail, and it expires. One line goes to the log
 *      with the numbers and nothing a person wrote.
 *
 * ── When the work is stopped ────────────────────────────────────────────────
 * The route aborts the turn when the reader leaves or the deadline passes.
 * The model call in flight ends, the turn is stored as failed so the trail
 * is honest about it, and the reader, if still there, is told to ask again.
 *
 * ── What the reader is never told ───────────────────────────────────────────
 * Whether a slug exists is public anyway (the story page is), so a missing
 * story is a plain 404. Everything else about a failure is one sentence.
 */

const { COLLECTIONS, getDb } = require("../db/mongo");
const { ApiError } = require("../lib/api-error");
const { serializeMongoValue } = require("../lib/serialize");
const { AUDIENCES, normaliseAudience } = require("../lib/audiences");
const agent = require("../lib/readingAgent");
const sentinel = require("../lib/sentinel");
const companion = require("../lib/companion");
const { redactPersonal } = require("../lib/redact");
const vertex = require("../lib/vertex");
const { traced } = require("../lib/tracing");
const { env } = require("../config/env");
const editorial = require("./editorial.service");
const { passagesFor } = require("./passages.service");
const quota = require("./readerQuota.service");

const MAX_HISTORY_TURNS = 6;
const OUTCOME = { ANSWERED: "answered", NOT_HERE: "not_here", REFUSED: "refused", FAILED: "failed" };

/** What the reader sees when a turn was stopped before it finished. Fixed, like the refusal. */
const FAILED_TEXT = "That one took too long, so I stopped. Ask again and I'll have another go.";
/** What earlier turns say in the model's history when the reader had written about themselves. */
const HISTORY_ABOUT_READER = "(a question that mentioned the reader themselves)";

/** Gemini's strict thresholds, for a reader who is a child. */
const YOUNG_SAFETY = ["HARM_CATEGORY_HARASSMENT", "HARM_CATEGORY_HATE_SPEECH", "HARM_CATEGORY_SEXUALLY_EXPLICIT", "HARM_CATEGORY_DANGEROUS_CONTENT"]
  .map((category) => ({ category, threshold: "BLOCK_LOW_AND_ABOVE" }));

function shownText(doc) {
  if (doc.answer) return doc.answer.text;
  return doc.outcome === OUTCOME.FAILED ? FAILED_TEXT : sentinel.REFUSAL_TEXT;
}

function viewTurn(doc) {
  return serializeMongoValue({
    id: doc._id,
    storySlug: doc.story_slug,
    storyTitle: doc.story_title,
    level: doc.audience,
    question: doc.question,
    questionRedacted: Array.isArray(doc.question_redacted) ? doc.question_redacted : [],
    focusIndex: doc.focus_index,
    steps: (doc.steps || []).map((s) => ({ tool: s.tool, summary: s.summary })),
    outcome: doc.outcome,
    /* What the reader was shown: the answer, or one fixed sentence. */
    text: shownText(doc),
    answer: doc.answer ? { text: doc.answer.text, grounding: doc.answer.grounding, blockIds: doc.answer.blockIds, passageIds: doc.answer.passageIds, term: doc.answer.term || null } : null,
    sentinel: doc.sentinel ? { verdict: doc.sentinel.verdict, reasons: doc.sentinel.reasons, attempts: doc.sentinel.attempts } : null,
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
function logTurn(doc, ms) {
  const tokens = (doc.usage || []).reduce((a, u) => ({ input: a.input + (u?.input || 0), output: a.output + (u?.output || 0) }), { input: 0, output: 0 });
  console.log("[reader] turn", JSON.stringify({
    story: doc.story_slug, audience: doc.audience, outcome: doc.outcome,
    verdict: doc.sentinel?.verdict || null, reasons: doc.sentinel?.reasons || [], attempts: doc.sentinel?.attempts || 0,
    grounding: doc.answer?.grounding || null, calls: (doc.calls || []).length, tokens, ms, redacted: doc.question_redacted || [],
  }));
}

/**
 * Answer one question about one story.
 *
 * @param {object} p
 * @param {string} p.slug
 * @param {string} p.readerKey
 * @param {string} p.question
 * @param {string|null} [p.level]        the reading level the reader is on
 * @param {number|null} [p.focusIndex]   the paragraph they are looking at, 1-based among text blocks
 * @param {AbortSignal} [p.signal]       the route's: the reader left, or the deadline passed
 * @param {(e:object)=>Promise<void>} [p.onProgress]
 */
async function askReader({ slug, readerKey, question, level = null, focusIndex = null, signal = null, onProgress = async () => {} }) {
  if (!vertex.isConfigured()) throw new ApiError(503, "The reading companion is not available on this deployment.");
  const raw = String(question || "").replace(/\s+/g, " ").trim();
  if (!raw) throw new ApiError(400, "Ask something about the story.");
  if (raw.length > agent.MAX_QUESTION_CHARS) throw new ApiError(400, `Keep a question under ${agent.MAX_QUESTION_CHARS} characters.`);
  const safe = redactPersonal(raw);
  const q = safe.text;

  const db = await getDb();
  const story = await loadPublicStory(db, slug);
  const { remaining } = await quota.takeAsk(db, { readerKey });

  const mapped = editorial.mapStoryDocument(story, null, null);
  mapped.levels = mapped.levels.filter((l) => l.approved && !l.stale);
  const { audience, blocks } = blocksForLevel(mapped, level);
  const passages = await passagesFor(db, story);
  const young = Boolean(AUDIENCES[audience]?.young);

  const turns = db.collection(COLLECTIONS.readerTurns);
  const prior = await turns.find({ reader_key: readerKey, story_id: story._id }).sort({ created_at: -1 }).limit(MAX_HISTORY_TURNS).toArray();
  const history = prior.reverse().flatMap((t) => [
    { role: "user", text: t.question_about_reader ? HISTORY_ABOUT_READER : t.question },
    { role: "model", text: shownText(t) },
  ]);

  const withSafety = (req) => vertex.generateContent({ ...req, ...(young ? { safetySettings: YOUNG_SAFETY } : {}) });
  const generate = traced("reader.generateContent", withSafety, { metadata: { storyId: String(story._id), audience } });
  const judge = traced("reader.sentinel", withSafety, { metadata: { storyId: String(story._id), audience } });

  const focus = Number.isInteger(focusIndex) && focusIndex > 0 ? focusIndex : null;
  const startedAt = Date.now();
  const base = {
    reader_key: readerKey,
    story_id: story._id,
    story_slug: story.slug,
    story_title: mapped.title,
    story_version: mapped.version,
    audience,
    focus_index: focus,
    question: q,
    question_redacted: safe.redacted,
    question_about_reader: safe.aboutReader,
    agent_version: agent.AGENT_VERSION,
  };
  const stamp = (doc) => {
    const now = new Date();
    return { ...doc, created_at: now, expires_at: new Date(now.getTime() + env.reader.turnsTtlDays * 24 * 60 * 60 * 1000) };
  };

  let result;
  try {
    result = await companion.answerQuestion({
      blocks, passages, question: q, audience, storyTitle: mapped.title, focusIndex: focus, history, generate, judge, signal, onProgress,
    });
  } catch (error) {
    if (error?.name !== "AbortError") throw error;
    /* Stopped, not finished. Recorded as such, so the trail does not show
       a question that vanished; the reason is the route's to know. */
    const doc = stamp({ ...base, steps: [], calls: [], answer: null, outcome: OUTCOME.FAILED, sentinel: null, usage: [], stopped: String(signal?.reason || error.message).slice(0, 80), ms: Date.now() - startedAt });
    const inserted = await turns.insertOne(doc);
    logTurn(doc, doc.ms);
    const stopped = new ApiError(504, FAILED_TEXT);
    stopped.turn = viewTurn({ ...doc, _id: inserted.insertedId });
    throw stopped;
  }

  const { answer, check, attempts, steps, calls, usage } = result;
  const passed = Boolean(answer);
  const outcome = !passed ? OUTCOME.REFUSED : answer.grounding === agent.GROUNDING.NOT_HERE ? OUTCOME.NOT_HERE : OUTCOME.ANSWERED;
  const ms = Date.now() - startedAt;
  const doc = stamp({
    ...base,
    steps: steps.map((s) => ({ tool: s.tool, summary: s.summary, result: String(s.result || "").slice(0, 400) })),
    calls: calls.map((c) => ({ name: c.name, args: c.args, result: String(c.result || "").slice(0, 400) })),
    answer: passed ? answer : null,
    outcome,
    sentinel: check ? { verdict: check.verdict, reasons: check.reasons, claims: check.claims || [], readability: check.readability || null, attempts, version: sentinel.SENTINEL_VERSION } : null,
    usage: (usage || []).filter(Boolean),
    ms,
  });
  const inserted = await turns.insertOne(doc);
  logTurn(doc, ms);
  const turn = viewTurn({ ...doc, _id: inserted.insertedId });
  return { turn, text: turn.text, remaining };
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

module.exports = { askReader, listStoryTurns, listReaderTurns, forgetReader, viewTurn, blocksForLevel, OUTCOME, FAILED_TEXT, YOUNG_SAFETY };
