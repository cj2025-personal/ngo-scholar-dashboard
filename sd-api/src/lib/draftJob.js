/**
 * The draft job: states, moves, keys and caps. Pure.
 *
 * ── Why a job and not a request ─────────────────────────────────────────────
 * A draft is five to eight model calls over a whole paper and takes 30–60
 * seconds. A synchronous request that long times out at a proxy, cannot be
 * resumed, and burns the tokens again when the scholar retries. So a draft is
 * a row: created idempotently, claimed under a lease by one worker, advanced
 * through named steps with an append-only event log the composer streams,
 * parked at `awaiting_review` for the scholar, and closed by the scholar's
 * own act — publish or discard — never by the machine.
 *
 * ── Idempotency ─────────────────────────────────────────────────────────────
 * The key is content-addressed: source, audience, prompt version and a hash
 * of the source text. The same request twice returns the same job instead of
 * paying twice; a change to the paper, the prompt or the audience is a new
 * key and a new draft. That is also why a failed job does not block a retry:
 * the retry is a new job under a suffixed key, and the failed row stays as
 * the record of what happened.
 *
 * ── Shape borrowed from user-dashboard-api's durable execution ─────────────
 * Lease lock with a fixed LOCK_MS, versioned engine constant, sequenced
 * append-only events, a daily cap. The code is not shared — the two runtimes
 * differ — but the shape is, so a reader of one can read the other.
 */

const crypto = require("crypto");

const JOB_ENGINE_VERSION = "draft-job-2026.2";

/**
 * How long a worker's claim lasts without a heartbeat.
 *
 * On Cloud Run with CPU allocated only during requests, a container with no
 * request open is frozen: its heartbeat stops, and the lease is what tells
 * every other container the job is free. A shorter lock is a shorter gap
 * before the instance the scholar is connected to picks the job up.
 */
const LOCK_MS = 60_000;
/** Heartbeat interval; comfortably inside the lock. */
const HEARTBEAT_MS = 15_000;

/**
 * Claims in a row that ended without the job getting any further — no
 * section written, no step finished — before it fails rather than loops.
 * A claim that saves a checkpoint resets the count, so a long draft frozen
 * many times, but moving each time, still finishes.
 */
const MAX_STALLED_CLAIMS = 4;

/**
 * A queued job that nobody has claimed for this long is not "starting": no
 * worker has had the CPU to take it. The page says so instead of spinning.
 */
const PAUSE_AFTER_MS = 20_000;

/**
 * How long a lapsed lease is left alone by a worker's background poll.
 *
 * A lapse usually means a frozen container, not a dead one: it carries on
 * the moment a request gives it CPU again. A background poll that took the
 * job would be running on an instance that is itself about to freeze (its
 * own request is ending), and each such theft costs the section in hand.
 * So a background poll takes only a lease lapsed this long — a container
 * that is gone. The scholar's own open request takes it at once (see
 * nudgeDraftWorker), because that request is CPU for as long as they watch.
 */
const RECLAIM_IDLE_MS = 10 * 60_000;

const STATUS = {
  QUEUED: "queued",
  RUNNING: "running",
  /* The outline is proposed; the scholar approves, edits or cuts sections
     before any prose is written. Only when the job asked for it. */
  AWAITING_OUTLINE: "awaiting_outline",
  AWAITING_REVIEW: "awaiting_review",
  PUBLISHED: "published",
  DISCARDED: "discarded",
  FAILED: "failed",
};

/** States from which nothing further happens. */
const TERMINAL = new Set([STATUS.PUBLISHED, STATUS.DISCARDED, STATUS.FAILED]);

/** Nothing more for a worker to do: the scholar has it, or it ended. */
function isSettled(status) {
  return status === STATUS.AWAITING_REVIEW || status === STATUS.AWAITING_OUTLINE || TERMINAL.has(status);
}

/** The steps a worker reports, in order. Names are stable: the UI shows them. */
const STEPS = ["pick_source", "plan_outline", "draft_blocks", "judge_fidelity", "judge_reach", "assemble", "verify", "create_story"];

/**
 * Every move and who may make it. "worker" is the process holding the lease;
 * "scholar" is the session that owns the job; "system" is lease expiry.
 */
const TRANSITIONS = [
  { from: STATUS.QUEUED, to: STATUS.RUNNING, actors: ["worker"] },
  { from: STATUS.RUNNING, to: STATUS.AWAITING_OUTLINE, actors: ["worker"] },
  /* Approving the outline puts the job back in the queue for the draft phase. */
  { from: STATUS.AWAITING_OUTLINE, to: STATUS.QUEUED, actors: ["scholar"] },
  { from: STATUS.AWAITING_OUTLINE, to: STATUS.DISCARDED, actors: ["scholar"] },
  { from: STATUS.RUNNING, to: STATUS.AWAITING_REVIEW, actors: ["worker"] },
  /* The draft became a story on the server: the job is closed by the worker. */
  { from: STATUS.RUNNING, to: STATUS.PUBLISHED, actors: ["worker"] },
  { from: STATUS.RUNNING, to: STATUS.FAILED, actors: ["worker"] },
  /* A lease that lapses mid-run goes back to queued for another worker; a
     worker hands a job back itself when the model was unreachable or its
     instance is shutting down. Either way it resumes from its checkpoint. */
  { from: STATUS.RUNNING, to: STATUS.QUEUED, actors: ["system", "worker"] },
  { from: STATUS.AWAITING_REVIEW, to: STATUS.PUBLISHED, actors: ["scholar"] },
  { from: STATUS.AWAITING_REVIEW, to: STATUS.DISCARDED, actors: ["scholar"] },
  { from: STATUS.QUEUED, to: STATUS.DISCARDED, actors: ["scholar"] },
];

function canTransition({ from, to, actor }) {
  const move = TRANSITIONS.find((t) => t.from === from && t.to === to);
  if (!move) return { ok: false, reason: `a job cannot go from ${from} to ${to}` };
  if (!move.actors.includes(actor)) return { ok: false, reason: `${actor} cannot move a job from ${from} to ${to}` };
  return { ok: true };
}

/**
 * The content-addressed key.
 *
 * @param {object} p
 * @param {string} p.profileId
 * @param {string} p.origin
 * @param {string} p.sourceId
 * @param {string} p.audience
 * @param {string} p.promptVersion
 * @param {string} p.corpusHash   sha256 of the prepared source text
 */
function idempotencyKey({ profileId, origin, sourceId, audience, promptVersion, corpusHash }) {
  for (const [k, v] of Object.entries({ profileId, origin, sourceId, audience, promptVersion, corpusHash })) {
    if (typeof v !== "string" || !v) throw new TypeError(`idempotencyKey requires ${k}`);
  }
  return crypto
    .createHash("sha256")
    .update([profileId, origin, sourceId, audience, promptVersion, corpusHash].join("|"))
    .digest("hex")
    .slice(0, 40);
}

/** A retry of a failed job is a new job under a suffixed key. */
function retryKey(key, attempt) {
  return `${key}:r${attempt}`;
}

function corpusHash(text) {
  return crypto.createHash("sha256").update(String(text || "")).digest("hex").slice(0, 24);
}

/**
 * May this scholar start another draft today?
 *
 * Counted over jobs created, not jobs finished: a job that fails still cost
 * model calls, and a scholar who hits the cap by retrying is exactly who the
 * cap is for.
 */
function withinDailyCap({ startedToday, cap, noun = "draft" }) {
  const limit = Number.isFinite(cap) && cap > 0 ? cap : 0;
  if (limit === 0) return { ok: false, reason: "drafting is switched off" };
  if (startedToday >= limit) {
    /* Named, because the two budgets are counted apart and a scholar told
       they have "started 3 drafts today" while looking at an empty draft
       list would reasonably think the number was wrong. */
    return { ok: false, reason: `you've asked for ${startedToday} ${noun}${startedToday === 1 ? "" : "s"} today; the daily limit is ${limit}` };
  }
  return { ok: true, remaining: limit - startedToday };
}

/** Start of the current UTC day, for the cap query. */
function dayStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Next event in a sequence, ready to $push. */
function nextEvent(events, type, data = {}, at = new Date()) {
  const sequence = (Array.isArray(events) ? events.length : 0) + 1;
  return { sequence, type, at, data };
}

/**
 * A sentence the scholar can act on, from whatever went wrong.
 *
 * "Draft failed" is the message that generates support tickets. Each branch
 * names the thing that would change the outcome.
 */
function failureSentence(error) {
  const msg = String(error?.message || error || "");
  if (/not configured|GCP_PROJECT_ID|LLM_PROVIDER/i.test(msg)) {
    return "Drafting isn't set up on this deployment yet. Nothing you did caused this; tell us and we'll switch it on.";
  }
  if (/doesn't support|does not support|unsupported/i.test(msg)) {
    return "The draft kept making claims the paper doesn't support, so we stopped rather than hand them to you. Try again; a paper with more text gives the model less reason to guess.";
  }
  if (/first person/i.test(msg)) {
    return "The draft kept writing as you rather than about you, which we don't do on your behalf. Try again, or draft from a different paper.";
  }
  if (/not enough of its text|too little text/i.test(msg)) {
    return "We hold this paper's title but not enough of its text to draft from. Uploading the paper itself would fix that.";
  }
  if (/did not return valid JSON|unusable|no article text|missing its blocks/i.test(msg)) {
    return "The model returned something we couldn't turn into an article. This usually passes on a retry; if it happens twice, try a different paper.";
  }
  if (/\b429\b|rate limit|rate-limit|quota|resource exhausted/i.test(msg)) {
    return "The drafting model is busy right now. Wait a minute and try again.";
  }
  if (/interrupted .* without getting further/i.test(msg)) {
    return "This draft was interrupted several times in a row without getting any further, so we stopped it rather than keep trying. Start it again, and keep the page open while it is written.";
  }
  if (/timed out|timeout|abort/i.test(msg)) {
    return "The model took too long to answer. Try again; a shorter paper drafts faster.";
  }
  if (/Vertex|generateContent|fetch failed/i.test(msg)) {
    return "We couldn't reach the drafting model. Try again in a minute; if it keeps happening, tell us.";
  }
  return "Something went wrong while drafting. Try again; if it happens twice, tell us which paper and we'll look.";
}

/**
 * Was this the platform rather than the draft?
 *
 * A model that timed out, a connection that dropped, a 429 or a 5xx: the
 * same step would very likely pass a minute later, and on Cloud Run a
 * container thawed after a freeze sees exactly these (its abort timers fire
 * the moment it gets CPU back). Such a run is handed back to the queue and
 * resumes from its checkpoint. Everything else — the draft kept speaking as
 * the scholar, the model's answer could not be parsed — is the draft's own
 * failure and ends the job with its sentence, as before.
 */
function isTransient(error) {
  if (!error) return false;
  if (error.name === "AbortError") return true;
  const status = Number(error.status);
  if (status === 408 || status === 429 || (status >= 500 && status < 600)) return true;
  const msg = String(error.message || error);
  if (/not configured|GCP_PROJECT_ID|LLM_PROVIDER/i.test(msg)) return false;
  return /\b(408|429|500|502|503|504)\b|rate limit|resource exhausted|quota|timed out|timeout|aborted|fetch failed|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|socket hang up|network/i.test(msg);
}

/** How long a job handed back for a transient fault waits before the next claim. */
function retryBackoffMs(stalledClaims) {
  const n = Math.max(1, Number(stalledClaims) || 1);
  return Math.min(60_000, 5_000 * 2 ** (n - 1));
}

/**
 * Is this job waiting for a worker that has no CPU?
 *
 * Running with a lease nobody renewed — its container was frozen or is gone
 * — or queued and unclaimed for longer than any live worker takes to poll.
 * Both resume from the checkpoint the moment a worker with CPU sees them;
 * on Cloud Run that is the instance serving the scholar's next request.
 *
 * @returns {{paused: boolean, since: Date|null}}
 */
function pausedState(doc, now = new Date()) {
  if (!doc) return { paused: false, since: null };
  const t = now.getTime();
  const time = (d) => (d instanceof Date ? d.getTime() : d ? new Date(d).getTime() : NaN);
  if (doc.status === STATUS.RUNNING) {
    const lease = time(doc.lease_expires_at);
    if (Number.isFinite(lease) && lease < t) return { paused: true, since: new Date(lease) };
    return { paused: false, since: null };
  }
  if (doc.status === STATUS.QUEUED) {
    const notBefore = time(doc.not_before);
    if (Number.isFinite(notBefore) && notBefore > t) return { paused: false, since: null };
    const from = Math.max(time(doc.updated_at) || 0, Number.isFinite(notBefore) ? notBefore : 0);
    if (from && t - from > PAUSE_AFTER_MS) return { paused: true, since: new Date(from) };
  }
  return { paused: false, since: null };
}

module.exports = {
  JOB_ENGINE_VERSION,
  LOCK_MS,
  HEARTBEAT_MS,
  MAX_STALLED_CLAIMS,
  PAUSE_AFTER_MS,
  RECLAIM_IDLE_MS,
  STATUS,
  TERMINAL,
  isSettled,
  STEPS,
  TRANSITIONS,
  canTransition,
  idempotencyKey,
  retryKey,
  corpusHash,
  withinDailyCap,
  dayStart,
  nextEvent,
  failureSentence,
  isTransient,
  retryBackoffMs,
  pausedState,
};
