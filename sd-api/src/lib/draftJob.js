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

const JOB_ENGINE_VERSION = "draft-job-2026.1";

/** How long a worker's claim lasts without a heartbeat. */
const LOCK_MS = 120_000;
/** Heartbeat interval; comfortably inside the lock. */
const HEARTBEAT_MS = 30_000;

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

/** The steps a worker reports, in order. Names are stable: the UI shows them. */
const STEPS = ["pick_source", "plan_outline", "draft_blocks", "judge_fidelity", "assemble", "verify", "create_story"];

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
  /* A lease that lapses mid-run goes back to queued for another worker. */
  { from: STATUS.RUNNING, to: STATUS.QUEUED, actors: ["system"] },
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
function withinDailyCap({ startedToday, cap }) {
  const limit = Number.isFinite(cap) && cap > 0 ? cap : 0;
  if (limit === 0) return { ok: false, reason: "drafting is switched off" };
  if (startedToday >= limit) {
    return { ok: false, reason: `you've started ${startedToday} drafts today; the daily limit is ${limit}` };
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
  if (/timed out|timeout|abort/i.test(msg)) {
    return "The model took too long to answer. Try again; a shorter paper drafts faster.";
  }
  if (/Vertex|generateContent|fetch failed/i.test(msg)) {
    return "We couldn't reach the drafting model. Try again in a minute; if it keeps happening, tell us.";
  }
  return "Something went wrong while drafting. Try again; if it happens twice, tell us which paper and we'll look.";
}

module.exports = {
  JOB_ENGINE_VERSION,
  LOCK_MS,
  HEARTBEAT_MS,
  STATUS,
  TERMINAL,
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
};
