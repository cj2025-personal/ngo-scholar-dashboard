/**
 * The drafting queue: create, claim, run, watch, close.
 *
 * ── One job, one worker, one lease ──────────────────────────────────────────
 * A job is claimed by an atomic findOneAndUpdate that sets a lease; only the
 * holder advances it, and a heartbeat extends the lease while the graph runs.
 * A worker that dies mid-run leaves a lease that lapses, and the next poll
 * reclaims the job with a `lease_reclaimed` event so the record shows the
 * gap. After three attempts the job fails with a sentence rather than
 * looping.
 *
 * ── Nothing here publishes ──────────────────────────────────────────────────
 * The worker leaves a job at `awaiting_review`. The scholar reads the draft
 * in the composer, edits it, and saves a story through the editorial route;
 * the composer then calls `resumeJob` to record which story took the draft.
 * The move from review to published is the scholar's, checked against the
 * transition table, and the machine cannot make it.
 *
 * ── Why the source text is stored on the job ────────────────────────────────
 * The idempotency key hashes the prepared text, so the job must draft from
 * exactly the text that was hashed — not whatever the source holds by the
 * time a worker picks it up. Up to 9,000 words per job; bounded by the cap.
 */

const os = require("os");
const crypto = require("crypto");

const { ObjectId } = require("mongodb");

const { env } = require("../config/env");
const { COLLECTIONS, getCollections } = require("../db/mongo");
const { ApiError } = require("../lib/api-error");
const { serializeMongoValue } = require("../lib/serialize");
const composer = require("../lib/draftComposer");
const { USE } = require("../lib/draftEligibility");
const { runDraftGraph, GRAPH_VERSION } = require("../lib/draftGraph");
const job = require("../lib/draftJob");
const { traced } = require("../lib/tracing");
const vertex = require("../lib/vertex");
const { listDraftSources, loadSourceText } = require("./drafting.service");

const WORKER_ID = `${os.hostname()}:${process.pid}`;
const MAX_ATTEMPTS = 3;

/* ── create ──────────────────────────────────────────────────────────────── */

async function createDraftJob({ profileId, origin, sourceId, audience }) {
  if (!profileId) throw new TypeError("createDraftJob requires a profile id");
  if (!env.drafting.enabled) {
    throw new ApiError(503, "Drafting is switched off on this deployment.");
  }
  if (!vertex.isConfigured()) {
    throw new ApiError(503, `Drafting is not available on this deployment. ${vertex.describeMissingConfig()}`);
  }

  const inventory = await listDraftSources({ profileId });
  if (!inventory.eligible) throw new ApiError(403, inventory.gateReason);

  const wanted = origin === "contributed" ? "contributed" : "harvested";
  const all = [...inventory.draftable, ...inventory.citable, ...inventory.unusable];
  const source = all.find((s) => s.id === String(sourceId) && s.origin === wanted);
  if (!source) throw new ApiError(404, "That source is not in your inventory.");
  if (source.use !== USE.DRAFTABLE) {
    throw new ApiError(403, `This source can't be drafted from: ${source.reason}.`);
  }

  const { db } = await getCollections();
  const jobs = db.collection(COLLECTIONS.draftJobs);

  const startedToday = await jobs.countDocuments({ profile_id: profileId, created_at: { $gte: job.dayStart() } });
  const cap = job.withinDailyCap({ startedToday, cap: env.drafting.dailyCap });
  if (!cap.ok) throw new ApiError(429, `Can't start another draft: ${cap.reason}.`);

  const rawText = await loadSourceText(db, source);
  const prepared = composer.prepareSourceText(rawText);
  if (prepared.words < 200) {
    throw new ApiError(409, "We hold this source's title but not enough of its text to draft from.");
  }

  const chosenAudience = composer.normaliseAudience(audience);
  const baseKey = job.idempotencyKey({
    profileId, origin: source.origin, sourceId: source.id, audience: chosenAudience,
    promptVersion: composer.PROMPT_VERSION, corpusHash: job.corpusHash(prepared.text),
  });

  /* The same request twice is the same job — unless the first one failed, in
     which case the retry is a new job under a suffixed key. */
  const family = await jobs.find({ idempotency_key: { $regex: `^${baseKey}(:r\\d+)?$` } }).sort({ created_at: -1 }).toArray();
  const latest = family[0] || null;
  if (latest && latest.status !== job.STATUS.FAILED && latest.status !== job.STATUS.DISCARDED) {
    return { job: view(latest), reused: true };
  }
  const key = latest ? job.retryKey(baseKey, family.length) : baseKey;

  const now = new Date();
  const doc = {
    _id: new ObjectId(),
    idempotency_key: key,
    profile_id: profileId,
    scholar_name: inventory.scholarName || null,
    source: { origin: source.origin, id: source.id, title: source.title, year: source.year ?? null, words: prepared.totalWords, truncated: prepared.truncated, prepared_words: prepared.words },
    source_text: prepared.text,
    audience: chosenAudience,
    prompt_version: composer.PROMPT_VERSION,
    graph_version: GRAPH_VERSION,
    engine_version: job.JOB_ENGINE_VERSION,
    model_requested: vertex.resolveResourceName(),
    status: job.STATUS.QUEUED,
    step: null,
    attempts: 0,
    lease_owner: null,
    lease_expires_at: null,
    events: [job.nextEvent([], "job_created", { source: source.title, audience: chosenAudience, retryOf: latest ? String(latest._id) : null }, now)],
    draft: null,
    warnings: [],
    tokens: { input: 0, output: 0 },
    failure: null,
    story_id: null,
    created_at: now,
    updated_at: now,
    started_at: null,
    finished_at: null,
    reviewed_at: null,
  };

  try {
    await jobs.insertOne(doc);
  } catch (error) {
    if (error?.code === 11000) {
      const existing = await jobs.findOne({ idempotency_key: key });
      if (existing) return { job: view(existing), reused: true };
    }
    throw error;
  }
  return { job: view(doc), reused: false };
}

/* ── read ────────────────────────────────────────────────────────────────── */

async function findOwnedJob(db, { jobId, profileId }) {
  if (!ObjectId.isValid(String(jobId))) throw new ApiError(404, "Draft job not found.");
  const doc = await db.collection(COLLECTIONS.draftJobs).findOne({ _id: new ObjectId(String(jobId)), profile_id: profileId });
  if (!doc) throw new ApiError(404, "Draft job not found.");
  return doc;
}

async function getDraftJob({ jobId, profileId }) {
  const { db } = await getCollections();
  return { job: view(await findOwnedJob(db, { jobId, profileId })) };
}

/** Events after a sequence number, for the stream. */
async function listJobEvents({ jobId, profileId, afterSequence = 0 }) {
  const { db } = await getCollections();
  const doc = await findOwnedJob(db, { jobId, profileId });
  const events = (doc.events || []).filter((e) => e.sequence > afterSequence);
  return { status: doc.status, step: doc.step, events: serializeMongoValue(events), job: view(doc) };
}

async function listDraftJobs({ profileId, limit = 20 }) {
  const { db } = await getCollections();
  const rows = await db
    .collection(COLLECTIONS.draftJobs)
    .find({ profile_id: profileId }, { projection: { source_text: 0, events: 0, draft: 0 } })
    .sort({ created_at: -1 })
    .limit(Math.min(Math.max(1, limit), 50))
    .toArray();
  return { jobs: rows.map(view) };
}

/* ── close ───────────────────────────────────────────────────────────────── */

/**
 * The scholar's move: the draft went into a story, or it did not.
 * `publish` records which story took it; `discard` closes it unused.
 */
async function resumeJob({ jobId, profileId, action, storyId = null }) {
  const { db } = await getCollections();
  const jobs = db.collection(COLLECTIONS.draftJobs);
  const doc = await findOwnedJob(db, { jobId, profileId });

  const to = action === "publish" ? job.STATUS.PUBLISHED : action === "discard" ? job.STATUS.DISCARDED : null;
  if (!to) throw new ApiError(400, "Action must be publish or discard.");
  const move = job.canTransition({ from: doc.status, to, actor: "scholar" });
  if (!move.ok) throw new ApiError(409, `Can't ${action} this draft: ${move.reason}.`);

  let story = null;
  if (to === job.STATUS.PUBLISHED) {
    if (!storyId || !ObjectId.isValid(String(storyId))) throw new ApiError(400, "A story id is required to record where the draft went.");
    story = await db.collection(COLLECTIONS.scholarEditorials).findOne({ _id: new ObjectId(String(storyId)), profile_id: profileId }, { projection: { _id: 1, status: 1 } });
    if (!story) throw new ApiError(404, "That story is not yours or does not exist.");
  }

  const now = new Date();
  const event = job.nextEvent(doc.events, to === job.STATUS.PUBLISHED ? "draft_taken_into_story" : "draft_discarded", { storyId: story ? String(story._id) : null }, now);
  await jobs.updateOne(
    { _id: doc._id, status: doc.status },
    { $set: { status: to, story_id: story ? story._id : null, reviewed_at: now, updated_at: now }, $push: { events: event } },
  );
  return { job: view(await jobs.findOne({ _id: doc._id })) };
}

/* ── worker ──────────────────────────────────────────────────────────────── */

async function claimNextJob(db) {
  const jobs = db.collection(COLLECTIONS.draftJobs);
  const now = new Date();
  const claimed = await jobs.findOneAndUpdate(
    {
      $or: [
        { status: job.STATUS.QUEUED },
        { status: job.STATUS.RUNNING, lease_expires_at: { $lt: now } },
      ],
    },
    {
      $set: { status: job.STATUS.RUNNING, lease_owner: WORKER_ID, lease_expires_at: new Date(now.getTime() + job.LOCK_MS), updated_at: now, started_at: now },
      $inc: { attempts: 1 },
    },
    { sort: { created_at: 1 }, returnDocument: "after" },
  );
  return claimed || null;
}

async function appendEvent(db, jobId, type, data = {}, extraSet = {}) {
  const jobs = db.collection(COLLECTIONS.draftJobs);
  const row = await jobs.findOne({ _id: jobId }, { projection: { events: 1 } });
  const event = job.nextEvent(row?.events || [], type, data);
  await jobs.updateOne({ _id: jobId }, { $push: { events: event }, $set: { updated_at: event.at, ...extraSet } });
  return event;
}

async function runClaimedJob(db, doc) {
  const jobs = db.collection(COLLECTIONS.draftJobs);
  const startedAt = new Date();

  if (doc.attempts > 1) {
    await appendEvent(db, doc._id, "lease_reclaimed", { attempt: doc.attempts, previousOwner: doc.lease_owner });
  }
  if (doc.attempts > MAX_ATTEMPTS) {
    const error = new Error(`gave up after ${MAX_ATTEMPTS} attempts`);
    await failJob(db, doc, error, startedAt, []);
    return;
  }
  await appendEvent(db, doc._id, "job_started", { attempt: doc.attempts, worker: WORKER_ID });

  const heartbeat = setInterval(() => {
    jobs.updateOne({ _id: doc._id, lease_owner: WORKER_ID }, { $set: { lease_expires_at: new Date(Date.now() + job.LOCK_MS) } }).catch(() => {});
  }, job.HEARTBEAT_MS);

  const generate = traced("draft.generateContent", (req) => vertex.generateContent(req), {
    metadata: { jobId: String(doc._id), profileId: doc.profile_id, promptVersion: doc.prompt_version },
  });

  let calls = [];
  try {
    const result = await runDraftGraph(
      {
        source: { id: doc.source.id, origin: doc.source.origin, title: doc.source.title, year: doc.source.year, use: USE.DRAFTABLE, reason: "draftable at creation" },
        scholar: { name: doc.scholar_name, field: null },
        audience: doc.audience,
        prepared: { text: doc.source_text, words: doc.source.prepared_words, totalWords: doc.source.words, truncated: doc.source.truncated },
      },
      {
        generate,
        onProgress: ({ step, message, detail }) => appendEvent(db, doc._id, "progress", { step, message, ...(detail || {}) }, { step }),
      },
    );
    calls = result.calls;
    const tokens = sumTokens(calls);
    const { calls: _omit, ...draft } = result;
    const finishedAt = new Date();
    const event = job.nextEvent((await jobs.findOne({ _id: doc._id }, { projection: { events: 1 } }))?.events || [], "draft_ready", { words: draft.words, calls: calls.length, tokens }, finishedAt);
    await jobs.updateOne(
      { _id: doc._id, lease_owner: WORKER_ID },
      {
        $set: { status: job.STATUS.AWAITING_REVIEW, step: null, draft, warnings: draft.warnings, tokens, finished_at: finishedAt, updated_at: finishedAt, lease_owner: null, lease_expires_at: null },
        $push: { events: event },
      },
    );
    await recordJobRun(db, { doc, startedAt, finishedAt, calls, draft, outcome: "delivered" });
  } catch (error) {
    await failJob(db, doc, error, startedAt, calls);
  } finally {
    clearInterval(heartbeat);
  }
}

async function failJob(db, doc, error, startedAt, calls) {
  const jobs = db.collection(COLLECTIONS.draftJobs);
  const finishedAt = new Date();
  const sentence = job.failureSentence(error);
  console.error(`[drafting] job ${doc._id} failed:`, error?.message || error);
  const event = job.nextEvent((await jobs.findOne({ _id: doc._id }, { projection: { events: 1 } }))?.events || [], "job_failed", { sentence, detail: String(error?.message || error).slice(0, 300) }, finishedAt);
  await jobs.updateOne(
    { _id: doc._id },
    {
      $set: { status: job.STATUS.FAILED, step: null, failure: { sentence, detail: String(error?.message || error).slice(0, 500) }, tokens: sumTokens(calls), finished_at: finishedAt, updated_at: finishedAt, lease_owner: null, lease_expires_at: null },
      $push: { events: event },
    },
  );
  await recordJobRun(db, { doc, startedAt, finishedAt, calls, draft: null, outcome: "error", error });
}

async function recordJobRun(db, { doc, startedAt, finishedAt, calls, draft, outcome, error = null }) {
  try {
    await db.collection(COLLECTIONS.draftRuns).insertOne({
      profile_id: doc.profile_id,
      job_id: doc._id,
      source: { origin: doc.source.origin, id: doc.source.id, title: doc.source.title, words: doc.source.words, truncated: doc.source.truncated },
      audience: doc.audience,
      prompt_version: doc.prompt_version,
      graph_version: doc.graph_version,
      engine_version: doc.engine_version,
      model_requested: doc.model_requested,
      model_served: calls.find((c) => c.model)?.model || null,
      attempt: doc.attempts,
      calls: calls.map((c) => ({ step: c.step, beat: c.beat ?? null, strictVoice: Boolean(c.strictVoice), usage: c.usage || null })),
      tokens: sumTokens(calls),
      outcome,
      error: error ? String(error.message || error).slice(0, 500) : null,
      draft_words: draft?.words ?? null,
      draft_hash: draft ? crypto.createHash("sha256").update(JSON.stringify(draft.bodyBlocks)).digest("hex").slice(0, 32) : null,
      readability: draft?.readability || null,
      warnings: draft?.warnings || [],
      started_at: startedAt,
      finished_at: finishedAt,
      duration_ms: finishedAt - startedAt,
    });
  } catch (writeError) {
    console.error("[drafting] failed to record draft run:", writeError);
  }
}

function sumTokens(calls) {
  return calls.reduce(
    (acc, c) => ({ input: acc.input + (c.usage?.input || 0), output: acc.output + (c.usage?.output || 0) }),
    { input: 0, output: 0 },
  );
}

let workerTimer = null;
let inFlight = false;

/** Poll for work. One job at a time per process; the lease handles the rest. */
function startDraftWorker() {
  if (!env.drafting.enabled || !env.drafting.worker) {
    console.log(`[drafting] worker not started (enabled=${env.drafting.enabled}, worker=${env.drafting.worker})`);
    return null;
  }
  if (workerTimer) return workerTimer;
  const tick = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      const { db } = await getCollections();
      const doc = await claimNextJob(db);
      if (doc) await runClaimedJob(db, doc);
    } catch (error) {
      console.error("[drafting] worker tick failed:", error);
    } finally {
      inFlight = false;
    }
  };
  workerTimer = setInterval(tick, Math.max(500, env.drafting.pollMs));
  workerTimer.unref();
  console.log(`[drafting] worker ${WORKER_ID} polling every ${env.drafting.pollMs}ms`);
  return workerTimer;
}

function stopDraftWorker() {
  if (workerTimer) clearInterval(workerTimer);
  workerTimer = null;
}

/* ── the shape the composer sees ─────────────────────────────────────────── */

function view(doc) {
  return serializeMongoValue({
    id: doc._id,
    status: doc.status,
    step: doc.step,
    attempts: doc.attempts,
    source: doc.source ? { origin: doc.source.origin, id: doc.source.id, title: doc.source.title, year: doc.source.year, words: doc.source.words, truncated: doc.source.truncated } : null,
    audience: doc.audience,
    draft: doc.draft || null,
    warnings: doc.warnings || [],
    failure: doc.failure || null,
    storyId: doc.story_id || null,
    tokens: doc.tokens || null,
    promptVersion: doc.prompt_version,
    graphVersion: doc.graph_version,
    createdAt: doc.created_at,
    startedAt: doc.started_at,
    finishedAt: doc.finished_at,
    reviewedAt: doc.reviewed_at,
    terminal: job.TERMINAL.has(doc.status),
    lastSequence: Array.isArray(doc.events) && doc.events.length ? doc.events[doc.events.length - 1].sequence : 0,
  });
}

module.exports = {
  createDraftJob,
  getDraftJob,
  listDraftJobs,
  listJobEvents,
  resumeJob,
  claimNextJob,
  runClaimedJob,
  startDraftWorker,
  stopDraftWorker,
  WORKER_ID,
};
