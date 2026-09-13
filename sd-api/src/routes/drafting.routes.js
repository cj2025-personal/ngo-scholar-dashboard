const express = require("express");

const { asyncHandler } = require("../lib/async-handler");
const { ApiError } = require("../lib/api-error");
const { requireAuth } = require("../middleware/auth.middleware");
const { canonicalScholarId } = require("../lib/identity");
const { rateLimit } = require("../middleware/rate-limit.middleware");
const { listDraftSources, draftFromSource } = require("../services/drafting.service");
const { createDraftJob, approveOutline, replanOutline, getDraftJob, listDraftJobs, listJobEvents, resumeJob } = require("../services/draftJob.service");
const { STATUS, TERMINAL } = require("../lib/draftJob");

const router = express.Router();

/* Each draft is a paid model call over up to 9,000 words. The limiter is
   per caller address, in memory, and documented as such in its own file; it
   is cost control, not abuse defence — the session cookie is that. */
const draftLimiter = rateLimit({ name: "drafting", limit: 8, windowMs: 10 * 60 * 1000 });

/**
 * What of my work can be drafted from, cited, or neither — and whether the
 * feature is open to me at all.
 *
 * Scoped to the session, never to a parameter, for the same reason as the
 * content inventory: a `?profileId=` here would let any signed-in scholar read
 * which of another scholar's papers we hold and under what licence.
 *
 * Returns the full inventory even when the Legacy gate is closed. A scholar
 * who cannot use the feature yet still deserves to know what we hold about
 * them and what would open it — that is the whole mechanism by which the
 * archive grows.
 */
router.get(
  "/sources",
  requireAuth,
  asyncHandler(async (req, res) => {
    const profileId = canonicalScholarId(req.auth.user);
    if (!profileId) {
      throw new ApiError(403, "This session is not linked to a scholar profile.");
    }

    res.status(200).json(await listDraftSources({ profileId }));
  }),
);

/**
 * Draft an article from one source I hold.
 *
 * The source is named in the path; whose it is comes from the session. The
 * service recomputes the inventory and refuses anything not in its
 * `draftable` list, so a scholar cannot draft from another scholar's paper,
 * or from one of their own we may only quote.
 *
 * Returns the draft; saves nothing. The composer puts it in front of the
 * scholar, and the story is saved by the scholar through the editorial route.
 */
router.post(
  "/from/:origin/:sourceId",
  requireAuth,
  draftLimiter,
  asyncHandler(async (req, res) => {
    const profileId = canonicalScholarId(req.auth.user);
    if (!profileId) {
      throw new ApiError(403, "This session is not linked to a scholar profile.");
    }

    const { origin, sourceId } = req.params;
    if (origin !== "harvested" && origin !== "contributed") {
      throw new ApiError(400, "Source origin must be harvested or contributed.");
    }
    if (!sourceId || sourceId.length > 200) {
      throw new ApiError(400, "Source id is invalid.");
    }

    const draft = await draftFromSource({
      profileId,
      origin,
      sourceId,
      audience: typeof req.body?.audience === "string" ? req.body.audience : undefined,
    });

    res.status(200).json(draft);
  }),
);

/* ── jobs ────────────────────────────────────────────────────────────────── */

function requireProfile(req) {
  const profileId = canonicalScholarId(req.auth.user);
  if (!profileId) throw new ApiError(403, "This session is not linked to a scholar profile.");
  return profileId;
}

/**
 * Start a draft. Returns 202 with the job; the composer then watches
 * `/jobs/:id/events`. Idempotent: the same source, audience and text return
 * the existing job with `reused: true` instead of paying for it twice.
 */
router.post(
  "/jobs",
  requireAuth,
  draftLimiter,
  asyncHandler(async (req, res) => {
    const profileId = requireProfile(req);
    const { origin, sourceId, audience, brief, approveOutline: wantsOutline, createStory } = req.body || {};
    if (origin !== "harvested" && origin !== "contributed") {
      throw new ApiError(400, "Source origin must be harvested or contributed.");
    }
    if (typeof sourceId !== "string" || !sourceId || sourceId.length > 200) {
      throw new ApiError(400, "Source id is invalid.");
    }
    if (brief !== undefined && brief !== null && (typeof brief !== "string" || brief.length > 1000)) {
      throw new ApiError(400, "A brief is a short sentence or two, under 1,000 characters.");
    }
    const result = await createDraftJob({
      profileId, origin, sourceId,
      audience: typeof audience === "string" ? audience : undefined,
      brief: typeof brief === "string" ? brief : null,
      approveOutline: Boolean(wantsOutline),
      createStory: createStory === undefined ? true : Boolean(createStory),
    });
    res.status(result.reused ? 200 : 202).json(result);
  }),
);

/** Approve the proposed outline, edited or not; drafting resumes from it. */
router.post(
  "/jobs/:jobId/outline",
  requireAuth,
  asyncHandler(async (req, res) => {
    const profileId = requireProfile(req);
    const outline = req.body && typeof req.body.outline === "object" ? req.body.outline : null;
    res.status(200).json(await approveOutline({ jobId: req.params.jobId, profileId, outline }));
  }),
);

/** Answer the proposed outline with a follow-up: the job replans from it. */
router.post(
  "/jobs/:jobId/replan",
  requireAuth,
  asyncHandler(async (req, res) => {
    const profileId = requireProfile(req);
    const instruction = req.body && typeof req.body.instruction === "string" ? req.body.instruction : "";
    res.status(202).json(await replanOutline({ jobId: req.params.jobId, profileId, instruction }));
  }),
);

router.get(
  "/jobs",
  requireAuth,
  asyncHandler(async (req, res) => {
    const profileId = requireProfile(req);
    res.status(200).json(await listDraftJobs({ profileId, limit: Number(req.query.limit) || 20 }));
  }),
);

router.get(
  "/jobs/:jobId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const profileId = requireProfile(req);
    res.status(200).json(await getDraftJob({ jobId: req.params.jobId, profileId }));
  }),
);

const STREAM_POLL_MS = 1000;
const STREAM_HEARTBEAT_MS = 15_000;
/* A stream on a job that never finishes should not hold a socket forever. */
const STREAM_MAX_MS = 10 * 60 * 1000;

/**
 * The job's event log as Server-Sent Events.
 *
 * Replays from `Last-Event-ID` (or `?after=`), then polls the job for new
 * events until it reaches review or a terminal state, sends a final `done`
 * frame with the job, and closes. The event log is embedded on the job, so
 * "poll" is one indexed read a second per open stream — fine at 65
 * scholars, and the place to put a change stream if that ever stops being
 * true.
 */
router.get(
  "/jobs/:jobId/events",
  requireAuth,
  asyncHandler(async (req, res) => {
    const profileId = requireProfile(req);
    const jobId = req.params.jobId;
    const headerCursor = Number(req.headers["last-event-id"]);
    const queryCursor = Number(req.query.after);
    let after = Number.isFinite(headerCursor) ? headerCursor : Number.isFinite(queryCursor) ? queryCursor : 0;

    /* Ownership before anything is streamed. */
    const first = await listJobEvents({ jobId, profileId, afterSequence: after });

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders?.();

    let closed = false;
    const send = (type, data, id) => {
      if (closed) return;
      if (id !== undefined) res.write(`id: ${id}\n`);
      res.write(`event: ${type}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    const settled = (status) => status === STATUS.AWAITING_REVIEW || status === STATUS.AWAITING_OUTLINE || TERMINAL.has(status);
    const finish = (snapshot) => {
      send("done", snapshot.job);
      closed = true;
      clearInterval(heartbeat);
      clearInterval(poll);
      clearTimeout(deadline);
      res.end();
    };

    const emit = (snapshot) => {
      for (const event of snapshot.events) {
        send(event.type, { sequence: event.sequence, at: event.at, ...event.data }, event.sequence);
        after = event.sequence;
      }
    };

    emit(first);
    const heartbeat = setInterval(() => { if (!closed) res.write(": keep-alive\n\n"); }, STREAM_HEARTBEAT_MS);
    const deadline = setTimeout(() => { send("timeout", { after }); closed = true; clearInterval(heartbeat); clearInterval(poll); res.end(); }, STREAM_MAX_MS);
    let polling = false;
    const poll = setInterval(async () => {
      if (closed || polling) return;
      polling = true;
      try {
        const next = await listJobEvents({ jobId, profileId, afterSequence: after });
        emit(next);
        if (settled(next.status)) finish(next);
      } catch (error) {
        send("error", { message: error.message });
        closed = true;
        clearInterval(heartbeat);
        clearInterval(poll);
        clearTimeout(deadline);
        res.end();
      } finally {
        polling = false;
      }
    }, STREAM_POLL_MS);

    if (settled(first.status)) finish(first);

    req.on("close", () => {
      closed = true;
      clearInterval(heartbeat);
      clearInterval(poll);
      clearTimeout(deadline);
    });
  }),
);

/** The scholar closes the review: the draft went into a story, or it did not. */
router.post(
  "/jobs/:jobId/resume",
  requireAuth,
  asyncHandler(async (req, res) => {
    const profileId = requireProfile(req);
    const { action, storyId } = req.body || {};
    res.status(200).json(await resumeJob({ jobId: req.params.jobId, profileId, action, storyId: storyId ? String(storyId) : null }));
  }),
);

module.exports = router;
