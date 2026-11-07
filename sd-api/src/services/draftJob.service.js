/**
 * The drafting queue: create, claim, run, watch, close.
 *
 * ── One job, one worker, one lease ──────────────────────────────────────────
 * A job is claimed by an atomic findOneAndUpdate that sets a lease and a
 * token unique to that claim; only the holder of the token advances it, and
 * a heartbeat extends the lease while the graph runs. Every write the worker
 * makes is conditional on the token, so a run that lost its lease — its
 * container was frozen, another took the job over — finds out at its next
 * write and stops without writing anything. (The token, not the worker id,
 * is the fence: on Cloud Run every container is `localhost:1`.)
 *
 * ── Resuming rather than restarting ─────────────────────────────────────────
 * On Cloud Run with CPU allocated only during requests, a draft gets CPU only
 * while some request is open on its container — the scholar's event stream,
 * in practice. Close the tab and the draft freezes; scale to zero and the
 * container is gone. So the job keeps a checkpoint: the graph's state after
 * every finished node and every accepted section, the story id before the
 * story is made. A worker that reclaims the job — the instance serving the
 * scholar's stream or long poll, as soon as the lease lapses; any worker's
 * background poll once it has lapsed long enough to mean the container is
 * gone — enters the graph where it stopped: nothing finished is paid for
 * twice, nothing finished is lost. A run that hits a timeout or an unreachable model
 * hands the job back to resume shortly instead of failing it. A job fails
 * for interruptions only after MAX_STALLED_CLAIMS claims in a row get it no
 * further; any checkpoint resets the count.
 *
 * What this cannot do is run with nobody connected: with no request open,
 * no container has CPU. Such a job reads as paused and resumes the moment
 * the scholar (or anyone whose request lands on a worker) comes back.
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
const { BRIEF_ORIGIN, BRIEF_SOURCE_ID, isBriefOnly } = require("../lib/briefSource");
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
const { screenedPassages } = require("./sourceGuard.service");
const { circleFor } = require("../lib/scholarCircles");

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

/* Host and pid say which machine; on Cloud Run every container is
   `localhost:1`, so a few random bytes say which container. For the record
   only: the claim's token is what fences writes. */
const WORKER_ID = `${os.hostname()}:${process.pid}:${crypto.randomBytes(3).toString("hex")}`;

/** A run that no longer holds its job. It stops and writes nothing. */
class LeaseLost extends Error {
  constructor(message = "This run no longer holds the job's lease.") {
    super(message);
    this.name = "LeaseLost";
  }
}

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
 * @param {string} [p.circleId]        a learning circle of theirs it is written for: the outline is
 *                                      told who reads it, the reader must be one of its ages, and the
 *                                      story joins the circle when it is published
 */
async function createDraftJob({ profileId, origin, sourceId, audience, voice, brief = null, approveOutline = false, createStory = true, levels = false, kind = "draft", circleId = null, circleLookup = circleFor }) {
  if (!profileId) throw new TypeError("createDraftJob requires a profile id");
  if (!env.drafting.enabled) {
    throw new ApiError(503, "Drafting is switched off on this deployment.");
  }
  if (!vertex.isConfigured()) {
    throw new ApiError(503, `Drafting is not available on this deployment. ${vertex.describeMissingConfig()}`);
  }

  const inventory = await listDraftSources({ profileId });
  if (!inventory.eligible) throw new ApiError(403, inventory.gateReason);

  /* From the brief alone: no paper, so nothing to find, load or screen, and
     nothing to propose an angle from. It is the scholar's own account, so it
     is written in their voice whatever was asked. */
  const briefOnly = origin === BRIEF_ORIGIN;
  if (briefOnly && kind === "proposal") throw new ApiError(400, "An angle is read from a paper. Say what to write, and it can come from your brief alone.");
  if (briefOnly && !(typeof brief === "string" && brief.trim())) throw new ApiError(400, "With no paper behind it, the article needs a brief: say what it should be about.");
  const wanted = origin === "contributed" ? "contributed" : "harvested";
  const all = [...inventory.draftable, ...inventory.citable, ...inventory.unusable];
  const source = briefOnly
    ? { origin: BRIEF_ORIGIN, id: BRIEF_SOURCE_ID, title: null, year: null, use: USE.DRAFTABLE }
    : all.find((s) => s.id === String(sourceId) && s.origin === wanted);
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

  let prepared = { text: "", words: 0, totalWords: 0, truncated: false };
  let screening = { passages: [], setAside: [] };
  if (!briefOnly) {
    const rawText = await loadSourceText(db, source);
    prepared = composer.prepareSourceText(rawText);
    if (prepared.words < 200) {
      throw new ApiError(409, "We hold this source's title but not enough of its text to draft from.");
    }
    /* The source guard reads the paper before anything else does; what it
       sets aside is kept on the job, so every run of it reads the same paper. */
    screening = await screenedPassages(db, { source, text: prepared.text });
    if (!screening.passages.length) throw new ApiError(409, "Every passage of this paper addresses its reader rather than reporting work, so there is nothing to draft from.");
  }

  const chosenAudience = composer.normaliseAudience(audience);
  /* Written for a circle: one of theirs, still open (or not yet), and for one of its reading ages. */
  const circle = circleId && !isProposal ? await circleLookup(profileId, circleId) : null;
  if (circle && !circle.bands.includes(chosenAudience)) {
    const ages = circle.bands.map((b) => composer.AUDIENCES[b]?.label || b).join(", ");
    throw new ApiError(400, `The circle “${circle.name}” is for ${ages}. Choose one of those readers, or write it without the circle.`);
  }
  const chosenVoice = briefOnly ? composer.VOICE.AUTHOR : composer.normaliseVoice(voice);
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
    corpusHash: job.corpusHash(`${prepared.text}\u0000${cleanBrief || ""}\u0000${approveOutline ? "outline" : "full"}\u0000${createStory ? "story" : "draft"}\u0000${Array.isArray(levelsRequested) ? `levels:${levelsRequested.join(",")}` : levelsRequested ? "levels" : ""}${circle ? `\u0000circle:${circle.id}` : ""}`),
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
    set_aside: screening.setAside,
    audience: chosenAudience,
    /* Whose account this is: the scholar's own by default, since the only
       papers this pipeline drafts from are theirs. See draftComposer.VOICE. */
    voice: chosenVoice,
    brief: cleanBrief,
    /* The learning circle it is written for, as it stood when the draft began
       (lib/scholarCircles): the outline reads it, and the story carries its
       id and name until it is published into it. */
    circle,
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
    /* Claims since the job last got further; see MAX_STALLED_CLAIMS. */
    stalled_claims: 0,
    interruptions: 0,
    last_interruption: null,
    lease_owner: null,
    lease_token: null,
    lease_expires_at: null,
    /* After a transient fault, the earliest a worker may claim it again. */
    not_before: null,
    /* What a resumed run starts from: see runClaimedJob. */
    checkpoint: null,
    events: [job.nextEvent([], "job_created", { source: briefOnly ? "your brief alone" : source.title, audience: chosenAudience, ...(circle ? { circle: circle.name } : {}), retryOf: latest ? String(latest._id) : null }, now)],
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

/* The scholar sent the job on to a new phase: nothing of the last one is
   carried into it, and its interruptions were not this phase's. */
const FRESH_PHASE = { checkpoint: null, stalled_claims: 0, not_before: null };

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

/** The longest a status read may be held open. Well inside Cloud Run's 300s. */
const MAX_WAIT_MS = 25_000;
const WAIT_STEP_MS = 1000;

/**
 * The job, read as a long poll: answered once it has moved past
 * `afterSequence` (or, with none given, past where it was when asked), or
 * settled, or after `waitMs` regardless.
 *
 * This is the page's status polling doing the work of keeping the draft
 * alive. On Cloud Run a container has CPU only while a request is open; a
 * poll answered at once leaves the worker frozen between polls, while one
 * held open keeps it running for as long as the scholar is watching. A job
 * waiting for a worker is taken by this instance on the spot.
 */
async function waitForDraftJob({ jobId, profileId, afterSequence = null, waitMs = 0 }) {
  const { db } = await getCollections();
  const jobs = db.collection(COLLECTIONS.draftJobs);
  let doc = await findOwnedJob(db, { jobId, profileId });
  const wait = Math.min(Math.max(0, Number(waitMs) || 0), MAX_WAIT_MS);
  if (!wait || job.isSettled(doc.status)) return { job: view(doc) };

  const lastSeq = (d) => (Array.isArray(d.events) && d.events.length ? d.events[d.events.length - 1].sequence : 0);
  const from = Number.isFinite(afterSequence) ? afterSequence : lastSeq(doc);
  const waiting = (d) => d.status === job.STATUS.QUEUED || job.pausedState(d).paused;
  const deadline = Date.now() + wait;
  let light = doc;
  while (!job.isSettled(light.status) && lastSeq(light) <= from && Date.now() < deadline) {
    if (waiting(light)) nudgeDraftWorker({ jobId: doc._id });
    await new Promise((resolve) => setTimeout(resolve, Math.min(WAIT_STEP_MS, Math.max(0, deadline - Date.now()))));
    light = await jobs.findOne(
      { _id: doc._id, profile_id: profileId },
      { projection: { status: 1, lease_expires_at: 1, not_before: 1, updated_at: 1, "events.sequence": 1 } },
    );
    if (!light) throw new ApiError(404, "Draft job not found.");
  }
  doc = await findOwnedJob(db, { jobId, profileId });
  return { job: view(doc) };
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
    .find({ profile_id: profileId }, { projection: { source_text: 0, events: 0, draft: 0, "checkpoint.state": 0, "checkpoint.sections": 0 } })
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

  const gone = new Set((doc.set_aside || []).map((x) => x.id));
  const passages = plan.splitPassages(doc.source_text).filter((p) => !gone.has(p.id));
  let approved;
  try {
    approved = normaliseApprovedOutline(doc.outline, outline || null, passages, { briefOnly: isBriefOnly(doc.source) });
  } catch (error) {
    throw new ApiError(400, error.message);
  }
  const now = new Date();
  const event = job.nextEvent(doc.events, "outline_approved", { beats: approved.beats.length, edited: Boolean(outline) }, now);
  /* The reply is the state the approval produced, read in the same
     operation: a worker polling every few hundred milliseconds can pick the
     job up before a second read, and a scholar who approved an outline
     should be told it was queued, not shown a job already running. */
  const after = await jobs.findOneAndUpdate(
    { _id: doc._id, status: doc.status },
    { $set: { status: job.STATUS.QUEUED, outline_approved: approved, updated_at: now, ...FRESH_PHASE }, $push: { events: event } },
    { returnDocument: "after" },
  );
  const row = after?.value ?? after;
  if (!row || !row._id) throw new ApiError(409, "Can't approve the outline: the job changed while you were deciding. Reload to see where it is.");
  return { job: view(row) };
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
    { $set: { status: job.STATUS.QUEUED, brief: combined, outline: null, passages: null, replans, updated_at: now, ...FRESH_PHASE }, $push: { events: event } },
  );
  return { job: view(await jobs.findOne({ _id: doc._id })) };
}

/* ── worker ──────────────────────────────────────────────────────────────── */

/**
 * Claim a job: the oldest queued one that is due, or one whose lease lapsed.
 * With `jobId`, that job only — the scholar's own, when their request asked
 * this instance to take it.
 *
 * The claim carries a fresh token; every write the run makes is conditional
 * on it. `claimed_from` says what the job was before: a job taken from a
 * lapsed lease was being held by a run that went quiet.
 *
 * A background poll leaves a freshly lapsed lease alone (RECLAIM_IDLE_MS):
 * its holder is more likely frozen than gone. A claim for a named job comes
 * from the scholar's own open request, and takes it as soon as it lapses.
 */
async function claimNextJob(db, { jobId = null } = {}) {
  const jobs = db.collection(COLLECTIONS.draftJobs);
  if (jobId && !ObjectId.isValid(String(jobId))) return null;
  const now = new Date();
  const token = crypto.randomUUID();
  const expires = new Date(now.getTime() + job.LOCK_MS);
  const lapsedBefore = jobId ? now : new Date(now.getTime() - job.RECLAIM_IDLE_MS);
  const before = await jobs.findOneAndUpdate(
    {
      ...(jobId ? { _id: new ObjectId(String(jobId)) } : {}),
      $or: [
        { status: job.STATUS.QUEUED, $or: [{ not_before: null }, { not_before: { $lte: now } }] },
        { status: job.STATUS.RUNNING, lease_expires_at: { $lt: lapsedBefore } },
      ],
    },
    {
      $set: { status: job.STATUS.RUNNING, lease_owner: WORKER_ID, lease_token: token, lease_expires_at: expires, not_before: null, updated_at: now, started_at: now },
      $inc: { attempts: 1, stalled_claims: 1 },
    },
    { sort: { created_at: 1 }, returnDocument: "before" },
  );
  if (!before) return null;
  return {
    ...before,
    status: job.STATUS.RUNNING,
    lease_owner: WORKER_ID,
    lease_token: token,
    lease_expires_at: expires,
    not_before: null,
    updated_at: now,
    started_at: now,
    attempts: (before.attempts || 0) + 1,
    stalled_claims: (before.stalled_claims || 0) + 1,
    claimed_from: { status: before.status, owner: before.lease_owner || null },
  };
}

/**
 * The checkpoint as stored.
 *
 * The graph's state and the sections in hand are kept as JSON text: they are
 * model output, whose keys are not Mongo's business, and a value that is
 * absent must come back absent rather than as null. The story id is kept as
 * soon as it is chosen, before the story is made. The summary is what the
 * job list reads, so nothing has to parse the rest to say how far it got.
 */
function storedCheckpoint(cp) {
  const total = cp.state?.outline?.beats?.length ?? null;
  const inHand = cp.sections?.done ? Object.keys(cp.sections.done).length : 0;
  const past = cp.next === "assemble" || cp.next === "verify" || (cp.next === null && cp.state);
  return {
    graph_version: GRAPH_VERSION,
    seq: cp.seq,
    saved_at: cp.saved_at,
    next: cp.next ?? null,
    state: cp.state ? JSON.stringify(cp.state) : null,
    sections: cp.sections ? JSON.stringify(cp.sections) : null,
    story: cp.story || null,
    summary: {
      next: cp.next ?? null,
      round: cp.state?.readabilityRounds || 0,
      sections_total: total,
      sections_written: past ? total : cp.next === "draft_blocks" ? inHand : 0,
    },
  };
}

/**
 * The checkpoint a run resumes from, or null to start from the paper.
 * One written by a different graph is not entered mid-way — the nodes it
 * names may not mean the same thing — unless the graph had finished, in
 * which case its result and its story stand.
 */
function loadCheckpoint(doc) {
  const c = doc?.checkpoint;
  if (!c || !c.state) return null;
  if (c.graph_version !== GRAPH_VERSION && c.next) return null;
  try {
    return {
      seq: c.seq || 0,
      saved_at: c.saved_at || null,
      next: c.next ?? null,
      state: JSON.parse(c.state),
      sections: c.sections ? JSON.parse(c.sections) : null,
      story: c.story || null,
    };
  } catch {
    return null;
  }
}

/** The run in hand in this process, so a shutdown can hand it back. */
let current = null;

async function runClaimedJob(db, doc) {
  const jobs = db.collection(COLLECTIONS.draftJobs);
  const startedAt = new Date();
  const token = doc.lease_token;
  const abort = new AbortController();
  let lost = false;
  const loseLease = () => {
    if (lost) return;
    lost = true;
    abort.abort(new LeaseLost());
  };
  const held = { jobId: doc._id, token, loseLease, progressed: false };
  current = held;

  /* Every write this run makes holds only while the claim is still its own.
     The first one refused stops the run: someone else has the job. */
  const fenced = async (update) => {
    if (lost) throw new LeaseLost();
    const r = await jobs.updateOne({ _id: doc._id, lease_token: token, status: job.STATUS.RUNNING }, update);
    if (r.matchedCount === 0) {
      loseLease();
      throw new LeaseLost();
    }
  };
  const eventsNow = async () => (await jobs.findOne({ _id: doc._id }, { projection: { events: 1 } }))?.events || [];
  const emit = async (type, data = {}, set = {}, at = new Date()) => {
    const event = job.nextEvent(await eventsNow(), type, data, at);
    await fenced({ $push: { events: event }, $set: { updated_at: at, ...set } });
    return event;
  };

  /* The heartbeat renews only this claim. A run thawed after its container
     was frozen renews it if nobody took the job meanwhile, and carries on;
     if somebody did, it stops here. */
  const heartbeat = setInterval(() => {
    jobs.updateOne({ _id: doc._id, lease_token: token, status: job.STATUS.RUNNING }, { $set: { lease_expires_at: new Date(Date.now() + job.LOCK_MS) } })
      .then((r) => { if (r.matchedCount === 0) loseLease(); })
      .catch(() => {});
  }, job.HEARTBEAT_MS);
  heartbeat.unref?.();

  const resumed = loadCheckpoint(doc);
  let cp = resumed ? { ...resumed } : { seq: 0, next: "pick_source", state: null, sections: null, story: null };
  let progressed = false;
  /* Kept before the run goes on: a node finished, a section accepted, a
     story id chosen or a story made. Getting this far resets the count of
     claims that got nowhere. */
  const keep = async (patch) => {
    cp = { ...cp, ...patch, seq: (cp.seq || 0) + 1, saved_at: new Date() };
    await fenced({ $set: { checkpoint: storedCheckpoint(cp), stalled_claims: 0, updated_at: cp.saved_at } });
    progressed = true;
    held.progressed = true;
  };

  let calls = [];
  try {
    if (doc.claimed_from?.status === job.STATUS.RUNNING) {
      await emit("lease_reclaimed", { attempt: doc.attempts, previousOwner: doc.claimed_from.owner });
    }
    if (doc.stalled_claims > job.MAX_STALLED_CLAIMS) {
      const last = doc.last_interruption?.detail;
      throw Object.assign(new Error(last || `interrupted ${doc.stalled_claims - 1} times in a row without getting further`), { giveUp: true });
    }
    const summary = resumed ? storedCheckpoint(resumed).summary : null;
    await emit("job_started", {
      attempt: doc.attempts,
      worker: WORKER_ID,
      ...(summary ? { resumed: { next: summary.next, sectionsWritten: summary.sections_written, sectionsTotal: summary.sections_total } } : {}),
    });

    /* Every model call this run makes stops when the run loses the job. */
    const guard = (fn) => (req) => (lost ? Promise.reject(new LeaseLost()) : fn({ ...req, signal: req?.signal || abort.signal }));
    const generate = guard(traced("draft.generateContent", (req) => vertex.generateContent(req), {
      metadata: { jobId: String(doc._id), profileId: doc.profile_id, promptVersion: doc.prompt_version },
    }));
    /* Every judge runs on its own route, with its own model and fallback; the
       fact-checkers (fidelity, reach, context) on a model other than the
       writer's, so no draft is marked by the model that wrote it. The retries
       they may cause are policy. */
    const router = await routerFor({ db });
    const judges = {
      voice: guard(router.bound("drafting.voice")), band: guard(router.bound("drafting.band")), review: guard(router.bound("drafting.review")),
      fidelity: guard(router.bound("drafting.fidelity")), reach: guard(router.bound("drafting.reach")), context: guard(router.bound("drafting.context")),
    };
    const limits = await getPolicy("drafting", { db });

    const input = {
      source: { id: doc.source.id, origin: doc.source.origin, title: doc.source.title, year: doc.source.year, use: USE.DRAFTABLE, reason: "draftable at creation" },
      scholar: { name: doc.scholar_name, field: null },
      audience: doc.audience,
      voice: doc.voice || null,
      brief: doc.brief || null,
      circle: doc.circle || null,
      outline: doc.outline_approved || null,
      prepared: { text: doc.source_text, words: doc.source.prepared_words, totalWords: doc.source.words, truncated: doc.source.truncated },
      setAside: doc.set_aside || [],
    };
    const onProgress = ({ step, message, detail }) => emit("progress", { step, message, ...(detail || {}) }, { step });

    /* Phase one, when asked for: read and outline, then wait for the scholar.
       One model call; an interruption here simply plans again. */
    if (doc.approve_outline && !doc.outline_approved) {
      const planned = await runOutlineOnly(input, { generate, onProgress, judges, limits });
      calls = planned.calls;
      const finishedAt = new Date();
      const event = job.nextEvent(await eventsNow(), "outline_ready", { beats: planned.outline.beats.length }, finishedAt);
      await fenced({
        $set: { status: job.STATUS.AWAITING_OUTLINE, step: null, outline: planned.outline, passages: planned.passages.map((p) => ({ id: p.id, words: p.words })), tokens: sumTokens(calls), updated_at: finishedAt, lease_owner: null, lease_token: null, lease_expires_at: null, stalled_claims: 0 },
        $push: { events: event },
      });
      await recordJobRun(db, { doc, startedAt, finishedAt, calls, draft: null, outcome: "outline" });
      return;
    }

    const result = await runDraftGraph(
      { ...input, resume: resumed ? { next: resumed.next, state: resumed.state, sections: resumed.sections } : null },
      {
        generate, onProgress, judges, limits,
        checkpoint: ({ next, state }) => keep({ next, state, sections: null }),
        onSection: ({ round, index, section, warnings, calls: spent }) => {
          const done = cp.sections && cp.sections.round === round ? cp.sections.done : {};
          return keep({ sections: { round, done: { ...done, [index]: { section, warnings, calls: spent } } } });
        },
      },
    );
    calls = result.calls;
    const { calls: _omit, ...draft } = result;
    const finishedAt = new Date();

    if (doc.create_story) {
      /* The draft becomes a draft story here, so the review workspace has a
         URL the moment it is ready. Status "draft"; nothing is published.
         Its id is kept before it is made, so a resumed run makes the same
         story and never a second. */
      let story = cp.story;
      if (!story) {
        story = { id: String(new ObjectId()), created: false, levels: null };
        await keep({ story });
      }
      if (!story.created) {
        await onProgress({ step: "create_story", message: "Opening the draft in your workspace…" });
        const { createStoryFromDraft } = require("./editorial.service");
        await createStoryFromDraft({ job: { ...doc, finished_at: finishedAt }, draft, storyId: story.id });
        story = { ...story, created: true };
        await keep({ story });
      }
      const storyId = new ObjectId(story.id);
      if (doc.levels_requested && !story.levels) {
        /* The other reading ages, from the story just made. A failure here
           is a warning on the job, never a lost draft. */
        let levels;
        try {
          const { generateLevelsForDoc } = require("./levels.service");
          const storyDoc = await db.collection(COLLECTIONS.scholarEditorials).findOne({ _id: storyId });
          const audiences = Array.isArray(doc.levels_requested) ? doc.levels_requested : null;
          const made = await generateLevelsForDoc(db, storyDoc, { audiences, actor: `drafter:${doc.graph_version || "draft-graph"}`, generate, judges, onProgress });
          levels = { ok: true, calls: made.calls };
        } catch (error) {
          if (lost || error instanceof LeaseLost) throw error;
          console.error(`[drafting] job ${doc._id}: reading levels failed:`, error?.message || error);
          levels = { ok: false, calls: [] };
        }
        story = { ...story, levels };
        await keep({ story });
      }
      if (story.levels) {
        calls.push(...(story.levels.calls || []));
        if (!story.levels.ok) draft.warnings = [...(draft.warnings || []), "The other reading levels could not be written; you can write them from the workspace."];
      }
      const tokens = sumTokens([...calls, ...(doc.tokens ? [{ usage: doc.tokens }] : [])]);
      const event = job.nextEvent(await eventsNow(), "draft_ready", { words: draft.words, calls: calls.length, tokens, storyId: String(storyId) }, finishedAt);
      await fenced({
        $set: { status: job.STATUS.PUBLISHED, step: null, draft, warnings: draft.warnings, tokens, story_id: storyId, finished_at: finishedAt, reviewed_at: finishedAt, updated_at: finishedAt, lease_owner: null, lease_token: null, lease_expires_at: null, checkpoint: null },
        $push: { events: event },
      });
    } else {
      const tokens = sumTokens([...calls, ...(doc.tokens ? [{ usage: doc.tokens }] : [])]);
      const event = job.nextEvent(await eventsNow(), "draft_ready", { words: draft.words, calls: calls.length, tokens }, finishedAt);
      await fenced({
        $set: { status: job.STATUS.AWAITING_REVIEW, step: null, draft, warnings: draft.warnings, tokens, finished_at: finishedAt, updated_at: finishedAt, lease_owner: null, lease_token: null, lease_expires_at: null, checkpoint: null },
        $push: { events: event },
      });
    }
    await recordJobRun(db, { doc, startedAt, finishedAt, calls, draft, outcome: "delivered", resumed });
  } catch (error) {
    if (lost || error instanceof LeaseLost) {
      /* Another run holds the job now, or this instance is shutting down
         and handed it back. Nothing more is written from here. */
      console.warn(`[drafting] job ${doc._id}: this run no longer holds the job; stopping without writing (${error?.message || error})`);
      return;
    }
    try {
      if (!error?.giveUp && job.isTransient(error)) {
        await handBack(error);
      } else {
        await failJob(error);
      }
    } catch (writeError) {
      if (!(writeError instanceof LeaseLost)) throw writeError;
    }
  } finally {
    clearInterval(heartbeat);
    if (current === held) current = null;
  }

  /**
   * The model was unreachable or timed out — on Cloud Run, typically a
   * container thawed after a freeze, whose abort timers all fire at once.
   * The job goes back to the queue, due again after a short wait, and the
   * next claim resumes it from its checkpoint.
   */
  async function handBack(error) {
    const at = new Date();
    const backoff = job.retryBackoffMs(progressed ? 1 : doc.stalled_claims);
    const detail = String(error?.message || error).slice(0, 300);
    const event = job.nextEvent(await eventsNow(), "run_interrupted", {
      reason: "transient",
      sentence: "The drafting model didn't answer just now. The draft picks up from where it stopped in a few seconds.",
      detail,
      retryInMs: backoff,
    }, at);
    await fenced({
      $set: { status: job.STATUS.QUEUED, step: null, lease_owner: null, lease_token: null, lease_expires_at: null, not_before: new Date(at.getTime() + backoff), last_interruption: { at, reason: "transient", detail }, updated_at: at },
      $inc: { interruptions: 1 },
      $push: { events: event },
    });
    console.warn(`[drafting] job ${doc._id}: handed back after a transient fault (${detail}); due again in ${backoff}ms`);
    await recordJobRun(db, { doc, startedAt, finishedAt: at, calls, draft: null, outcome: "interrupted", error, resumed });
  }

  async function failJob(error) {
    const finishedAt = new Date();
    const sentence = job.failureSentence(error);
    console.error(`[drafting] job ${doc._id} failed:`, error?.message || error);
    const event = job.nextEvent(await eventsNow(), "job_failed", { sentence, detail: String(error?.message || error).slice(0, 300) }, finishedAt);
    await fenced({
      $set: { status: job.STATUS.FAILED, step: null, failure: { sentence, detail: String(error?.message || error).slice(0, 500) }, tokens: sumTokens(calls), finished_at: finishedAt, updated_at: finishedAt, lease_owner: null, lease_token: null, lease_expires_at: null },
      $push: { events: event },
    });
    await recordJobRun(db, { doc, startedAt, finishedAt, calls, draft: null, outcome: "error", error, resumed });
  }
}

/**
 * Hand the job this process is running back to the queue, now.
 *
 * For a shutdown: Cloud Run sends SIGTERM before it takes a container away,
 * scaling to zero included. Waiting out the lease would leave the job looking
 * stuck for a minute; handing it back lets the next instance with CPU resume
 * it from its checkpoint at once. The run in hand is stopped first, so
 * nothing it does afterwards is written. A shutdown is not the job's fault,
 * so the claim it ends is not counted against it (one that got further has
 * already reset the count).
 */
async function releaseHeldJob(reason = "instance_shutdown") {
  const held = current;
  if (!held) return false;
  held.loseLease();
  const { db } = await getCollections();
  const jobs = db.collection(COLLECTIONS.draftJobs);
  const at = new Date();
  const row = await jobs.findOne({ _id: held.jobId }, { projection: { events: 1 } });
  const event = job.nextEvent(row?.events || [], "run_interrupted", {
    reason,
    sentence: "The server writing this draft was shutting down. The draft picks up from where it stopped on the next one.",
  }, at);
  const r = await jobs.updateOne(
    { _id: held.jobId, lease_token: held.token, status: job.STATUS.RUNNING },
    {
      $set: { status: job.STATUS.QUEUED, step: null, lease_owner: null, lease_token: null, lease_expires_at: null, not_before: null, last_interruption: { at, reason, detail: null }, updated_at: at },
      $inc: held.progressed ? { interruptions: 1 } : { interruptions: 1, stalled_claims: -1 },
      $push: { events: event },
    },
  );
  return r.matchedCount === 1;
}

async function recordJobRun(db, { doc, startedAt, finishedAt, calls, draft, outcome, error = null, resumed = null }) {
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
      /* Where this run entered the graph, when it took over from another;
         its calls include the ones the earlier runs made and kept. */
      resumed_from: resumed ? { next: resumed.next, seq: resumed.seq } : null,
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
let stopping = false;

const workerEnabled = () => env.drafting.enabled && env.drafting.worker;

/** One claim and its run. One job at a time per process; the lease handles the rest. */
async function tick({ jobId = null } = {}) {
  if (inFlight || stopping) return false;
  inFlight = true;
  try {
    const { db } = await getCollections();
    const doc = await claimNextJob(db, { jobId });
    if (doc) await runClaimedJob(db, doc);
    return Boolean(doc);
  } catch (error) {
    console.error("[drafting] worker tick failed:", error);
    return false;
  } finally {
    inFlight = false;
  }
}

/** Poll for work. */
function startDraftWorker() {
  if (!workerEnabled()) {
    console.log(`[drafting] worker not started (enabled=${env.drafting.enabled}, worker=${env.drafting.worker})`);
    return null;
  }
  if (workerTimer) return workerTimer;
  stopping = false;
  workerTimer = setInterval(() => { tick(); }, Math.max(500, env.drafting.pollMs));
  workerTimer.unref();
  console.log(`[drafting] worker ${WORKER_ID} polling every ${env.drafting.pollMs}ms`);
  return workerTimer;
}

/**
 * Take this scholar's job now, if it is waiting and this process is free.
 *
 * Called by requests that stay open while the scholar watches — the event
 * stream, a long poll. On Cloud Run such a request is what gives this
 * container CPU, so the instance serving the scholar is the one that should
 * be drafting for them, and it should not wait for its next poll to start.
 * Not called by short requests: a claim made as a request ends is a claim
 * frozen a moment later. Never awaited; the request goes on serving.
 */
function nudgeDraftWorker({ jobId = null } = {}) {
  if (!workerEnabled() || stopping || inFlight) return false;
  tick({ jobId }).catch(() => {});
  return true;
}

function stopDraftWorker() {
  stopping = true;
  if (workerTimer) clearInterval(workerTimer);
  workerTimer = null;
}

/* ── the shape the composer sees ─────────────────────────────────────────── */

function view(doc) {
  /* Whether anything is drafting it right now, and how far it has got: a
     job no worker has CPU for is paused, not "being written", and it
     continues from where the summary says. */
  const paused = job.pausedState(doc);
  const kept = doc.checkpoint?.summary || null;
  return serializeMongoValue({
    id: doc._id,
    status: doc.status,
    step: doc.step,
    attempts: doc.attempts,
    paused: paused.paused,
    pausedSince: paused.since,
    progress: kept ? { next: kept.next, round: kept.round || 0, sectionsWritten: kept.sections_written ?? 0, sectionsTotal: kept.sections_total ?? null } : null,
    interruptions: doc.interruptions || 0,
    source: doc.source ? { origin: doc.source.origin, id: doc.source.id, title: doc.source.title, year: doc.source.year, words: doc.source.words, truncated: doc.source.truncated } : null,
    audience: doc.audience,
    voice: doc.voice || null,
    brief: doc.brief || null,
    circle: doc.circle ? { id: doc.circle.id, name: doc.circle.name } : null,
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
  loadCheckpoint,
  runClaimedJob,
  startDraftWorker,
  stopDraftWorker,
  nudgeDraftWorker,
  releaseHeldJob,
  waitForDraftJob,
  view,
  LeaseLost,
  WORKER_ID,
};
