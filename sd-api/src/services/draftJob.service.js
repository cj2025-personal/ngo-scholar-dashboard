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
const { runDraftGraph, runOutlineOnly, normaliseApprovedOutline, GRAPH_VERSION } = require("../lib/draftGraph");
const plan = require("../lib/draftPlan");
const job = require("../lib/draftJob");
const { traced } = require("../lib/tracing");
const vertex = require("../lib/vertex");
const { listDraftSources, loadSourceText } = require("./drafting.service");
const { getPolicy } = require("./policy.service");
const { routerFor } = require("./models.service");

/**
 * The brief a proposal carries when the scholar has not written one.
 *
 * Phrased as a question about the reader rather than an instruction about
 * tone, because the planner answers briefs and the thing worth answering
 * here is the one a scholar writing publicly is always answering. It asks
 * for the limits as well as the finding: an angle that leaves those out is
 * the kind of overstatement the publish check exists to catch, and it should
 * not be this product that proposed it.
 */
const PROPOSAL_BRIEF =
  "Propose the article this paper could become for a reader outside the field: what the work found, why it matters to them, and what it does not show.";

const WORKER_ID = `${os.hostname()}:${process.pid}`;
const MAX_ATTEMPTS = 3;

/* ── create ──────────────────────────────────────────────────────────────── */

/**
 * @param {object} p
 * @param {string} [p.brief]           what the scholar wants the article to focus on
 * @param {boolean} [p.approveOutline] pause after the outline for the scholar's approval
 * @param {boolean} [p.createStory]    when the draft is ready, create the draft story on the
 *                                      server (the review workspace's URL); default true
 * @param {boolean|string[]} [p.levels] once the story exists, write it for every other reading
 *                                      age (true) or for the bands named; each is written and
 *                                      judged on its own
 */
async function createDraftJob({ profileId, origin, sourceId, audience, voice, brief = null, approveOutline = false, createStory = true, levels = false, kind = "draft" }) {
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

  /* Two budgets, counted apart. A proposal is the agent reading a paper and
     offering an angle; it stops at the outline. Charging it to the drafting
     cap would mean that asking what a paper could become costs a slot the
     scholar wanted for writing — so an offer they never asked for could stop
     them working. Jobs written before `kind` existed have none, and are
     drafts. */
  const isProposal = kind === "proposal";
  const startedToday = await jobs.countDocuments({
    profile_id: profileId,
    created_at: { $gte: job.dayStart() },
    ...(isProposal ? { kind: "proposal" } : { kind: { $ne: "proposal" } }),
  });
  const cap = job.withinDailyCap({
    startedToday,
    cap: isProposal ? env.drafting.proposalDailyCap : env.drafting.dailyCap,
    noun: isProposal ? "angle" : "draft",
  });
  if (!cap.ok) {
    throw new ApiError(429, `Can't ${isProposal ? "ask for another angle" : "start another draft"}: ${cap.reason}.`);
  }

  const rawText = await loadSourceText(db, source);
  const prepared = composer.prepareSourceText(rawText);
  if (prepared.words < 200) {
    throw new ApiError(409, "We hold this source's title but not enough of its text to draft from.");
  }

  const chosenAudience = composer.normaliseAudience(audience);
  const chosenVoice = composer.normaliseVoice(voice);
  const asked = typeof brief === "string" && brief.trim() ? brief.trim().slice(0, 1000) : null;
  /* A proposal is the agent being asked what a paper could become, so it
     arrives without a brief — and a plan with no brief is every beat a paper
     beat, which is a faithful summary and not an angle. That would make
     "suggest an angle" a slower way to press "start a story". So a proposal
     carries a standing brief instead: the one thing a scholar writing for a
     public reader is always trying to answer. It goes through the same
     planner, the same context and reach judges, and the same outline the
     scholar approves or argues with, so nothing is taken on trust because
     the agent suggested it rather than the scholar. */
  const cleanBrief = asked || (isProposal ? PROPOSAL_BRIEF : null);
  /* The bands to write after the story: every other band, the ones named
     (the story's own band is never a level of itself), or none. */
  const levelBands = Array.isArray(levels)
    ? [...new Set(levels.map((a) => composer.normaliseAudience(a)))].filter((a) => a !== chosenAudience).sort()
    : null;
  const levelsRequested = createStory ? (levelBands ? (levelBands.length ? levelBands : false) : Boolean(levels)) : false;
  /* A different brief, or asking for outline approval, is a different draft. */
  const baseKey = job.idempotencyKey({
    profileId, origin: source.origin, sourceId: source.id, audience: chosenAudience,
    /* A proposal is a different request from a draft of the same paper, so it
       gets its own key rather than being handed back an existing draft's job.
       Appended only for proposals, so every key already issued for a draft
       stays exactly what it was and in-flight jobs are still reused. */
    promptVersion: `${composer.PROMPT_VERSION}:${chosenVoice}${kind === "proposal" ? ":proposal" : ""}`,
    corpusHash: job.corpusHash(`${prepared.text} ${cleanBrief || ""} ${approveOutline ? "outline" : "full"} ${createStory ? "story" : "draft"} ${Array.isArray(levelsRequested) ? `levels:${levelsRequested.join(",")}` : levelsRequested ? "levels" : ""}`),
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
    /* "draft" (the scholar said what to write) or "proposal" (they asked the
       agent what this paper could become). What the daily budgets count. */
    kind: isProposal ? "proposal" : "draft",
    scholar_name: inventory.scholarName || null,
    source: { origin: source.origin, id: source.id, title: source.title, year: source.year ?? null, words: prepared.totalWords, truncated: prepared.truncated, prepared_words: prepared.words },
    source_text: prepared.text,
    audience: chosenAudience,
    /* Whose account this is: the scholar's own by default, since the only
       papers this pipeline drafts from are theirs. See draftComposer.VOICE. */
    voice: chosenVoice,
    brief: cleanBrief,
    approve_outline: Boolean(approveOutline),
    create_story: Boolean(createStory),
    /* Write other reading ages once the story exists: true for every other
       band, or the bands named. Extra model calls; opt in. */
    levels_requested: levelsRequested,
    outline: null,
    outline_approved: null,
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

/**
 * The scholar approves the outline, possibly edited: sections kept, in their
 * order, with their headings. The job goes back to the queue for the draft
 * phase. Nothing about the outline is trusted from the client beyond that:
 * passage ids are checked against the paper, empty sections are dropped.
 */
async function approveOutline({ jobId, profileId, outline }) {
  const { db } = await getCollections();
  const jobs = db.collection(COLLECTIONS.draftJobs);
  const doc = await findOwnedJob(db, { jobId, profileId });
  const move = job.canTransition({ from: doc.status, to: job.STATUS.QUEUED, actor: "scholar" });
  if (!move.ok) throw new ApiError(409, `Can't approve the outline: ${move.reason}.`);
  if (!doc.outline) throw new ApiError(409, "This job has no outline to approve.");

  const passages = plan.splitPassages(doc.source_text);
  let approved;
  try {
    approved = normaliseApprovedOutline(doc.outline, outline || null, passages);
  } catch (error) {
    throw new ApiError(400, error.message);
  }
  const now = new Date();
  const event = job.nextEvent(doc.events, "outline_approved", { beats: approved.beats.length, edited: Boolean(outline) }, now);
  await jobs.updateOne(
    { _id: doc._id, status: doc.status },
    { $set: { status: job.STATUS.QUEUED, outline_approved: approved, updated_at: now }, $push: { events: event } },
  );
  return { job: view(await jobs.findOne({ _id: doc._id })) };
}

/**
 * The scholar answers the proposed outline with a follow-up instead of
 * approving it ("drop the history, lead with the drought"). The instruction
 * joins the brief and the job goes back to the queue for another outline
 * pass; the passages are the same, the plan is not. Bounded like the brief.
 */
async function replanOutline({ jobId, profileId, instruction }) {
  const { db } = await getCollections();
  const jobs = db.collection(COLLECTIONS.draftJobs);
  const doc = await findOwnedJob(db, { jobId, profileId });
  if (doc.status !== job.STATUS.AWAITING_OUTLINE) throw new ApiError(409, "Only an outline that is waiting for you can be replanned.");
  const ask = typeof instruction === "string" ? instruction.trim() : "";
  if (!ask) throw new ApiError(400, "Say what should change about the outline.");
  const move = job.canTransition({ from: doc.status, to: job.STATUS.QUEUED, actor: "scholar" });
  if (!move.ok) throw new ApiError(409, `Can't replan: ${move.reason}.`);

  const combined = `${doc.brief ? `${doc.brief}\n` : ""}Then the scholar asked: ${ask}`.slice(-1000);
  const replans = (doc.replans || 0) + 1;
  if (replans > 6) throw new ApiError(429, "That outline has been replanned six times; approve it, edit it by hand, or discard the draft.");
  const now = new Date();
  const event = job.nextEvent(doc.events, "outline_replanned", { instruction: ask.slice(0, 200), replans }, now);
  await jobs.updateOne(
    { _id: doc._id, status: doc.status },
    { $set: { status: job.STATUS.QUEUED, brief: combined, outline: null, passages: null, replans, updated_at: now }, $push: { events: event } },
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
  /* The voice and reading-level judges each run on their own route, with
     its own model and fallback; the retries they may cause are policy. */
  const router = await routerFor({ db });
  const judges = { voice: router.bound("drafting.voice"), band: router.bound("drafting.band") };
  const limits = await getPolicy("drafting", { db });

  let calls = [];
  const input = {
    source: { id: doc.source.id, origin: doc.source.origin, title: doc.source.title, year: doc.source.year, use: USE.DRAFTABLE, reason: "draftable at creation" },
    scholar: { name: doc.scholar_name, field: null },
    audience: doc.audience,
    voice: doc.voice || null,
    brief: doc.brief || null,
    outline: doc.outline_approved || null,
    prepared: { text: doc.source_text, words: doc.source.prepared_words, totalWords: doc.source.words, truncated: doc.source.truncated },
  };
  const onProgress = ({ step, message, detail }) => appendEvent(db, doc._id, "progress", { step, message, ...(detail || {}) }, { step });
  const eventsNow = async () => (await jobs.findOne({ _id: doc._id }, { projection: { events: 1 } }))?.events || [];

  try {
    /* Phase one, when asked for: read and outline, then wait for the scholar. */
    if (doc.approve_outline && !doc.outline_approved) {
      const planned = await runOutlineOnly(input, { generate, onProgress, judges, limits });
      calls = planned.calls;
      const finishedAt = new Date();
      const event = job.nextEvent(await eventsNow(), "outline_ready", { beats: planned.outline.beats.length }, finishedAt);
      await jobs.updateOne(
        { _id: doc._id, lease_owner: WORKER_ID },
        {
          $set: { status: job.STATUS.AWAITING_OUTLINE, step: null, outline: planned.outline, passages: planned.passages.map((p) => ({ id: p.id, words: p.words })), tokens: sumTokens(calls), updated_at: finishedAt, lease_owner: null, lease_expires_at: null },
          $push: { events: event },
        },
      );
      await recordJobRun(db, { doc, startedAt, finishedAt, calls, draft: null, outcome: "outline" });
      return;
    }

    const result = await runDraftGraph(input, { generate, onProgress, judges, limits });
    calls = result.calls;
    const tokens = sumTokens([...calls, ...(doc.tokens ? [{ usage: doc.tokens }] : [])]);
    const { calls: _omit, ...draft } = result;
    const finishedAt = new Date();

    if (doc.create_story) {
      /* The draft becomes a draft story here, so the review workspace has a
         URL the moment it is ready. Status "draft"; nothing is published. */
      await onProgress({ step: "create_story", message: "Opening the draft in your workspace…" });
      const { createStoryFromDraft } = require("./editorial.service");
      const { storyId } = await createStoryFromDraft({ job: { ...doc, finished_at: finishedAt }, draft });
      if (doc.levels_requested) {
        /* The other reading ages, from the story just made. A failure here
           is a warning on the job, never a lost draft. */
        try {
          const { generateLevelsForDoc } = require("./levels.service");
          const storyDoc = await db.collection(COLLECTIONS.scholarEditorials).findOne({ _id: storyId });
          const audiences = Array.isArray(doc.levels_requested) ? doc.levels_requested : null;
          const made = await generateLevelsForDoc(db, storyDoc, { audiences, actor: `drafter:${doc.graph_version || "draft-graph"}`, generate, judges, onProgress });
          calls.push(...made.calls);
        } catch (error) {
          console.error(`[drafting] job ${doc._id}: reading levels failed:`, error?.message || error);
          draft.warnings = [...(draft.warnings || []), "The other reading levels could not be written; you can write them from the workspace."];
        }
      }
      const event = job.nextEvent(await eventsNow(), "draft_ready", { words: draft.words, calls: calls.length, tokens, storyId: String(storyId) }, finishedAt);
      await jobs.updateOne(
        { _id: doc._id, lease_owner: WORKER_ID },
        {
          $set: { status: job.STATUS.PUBLISHED, step: null, draft, warnings: draft.warnings, tokens, story_id: storyId, finished_at: finishedAt, reviewed_at: finishedAt, updated_at: finishedAt, lease_owner: null, lease_expires_at: null },
          $push: { events: event },
        },
      );
    } else {
      const event = job.nextEvent(await eventsNow(), "draft_ready", { words: draft.words, calls: calls.length, tokens }, finishedAt);
      await jobs.updateOne(
        { _id: doc._id, lease_owner: WORKER_ID },
        {
          $set: { status: job.STATUS.AWAITING_REVIEW, step: null, draft, warnings: draft.warnings, tokens, finished_at: finishedAt, updated_at: finishedAt, lease_owner: null, lease_expires_at: null },
          $push: { events: event },
        },
      );
    }
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
      /* The process that did the work, and the code it ran. The versions on
         the job are stamped by whoever created it; a stale worker on the same
         queue drafts with older code and nothing else says so. */
      worker: WORKER_ID,
      worker_versions: { graph: GRAPH_VERSION, prompt: composer.PROMPT_VERSION, engine: job.JOB_ENGINE_VERSION },
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
    voice: doc.voice || null,
    brief: doc.brief || null,
    replans: doc.replans || 0,
    approveOutline: Boolean(doc.approve_outline),
    levelsRequested: Array.isArray(doc.levels_requested) ? doc.levels_requested : Boolean(doc.levels_requested),
    outline: doc.outline || null,
    outlineApproved: doc.outline_approved || null,
    passages: doc.passages || null,
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
  approveOutline,
  replanOutline,
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
