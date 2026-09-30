"use strict";

/**
 * The reading companion's routes. Every one is public: a reader has a
 * device cookie, not an account.
 *
 *   POST   /api/reader/stories/:slug/ask     ask; answered as a stream of events
 *   GET    /api/reader/stories/:slug/turns   this reader's thread on this story
 *   GET    /api/reader/me/turns              everything this reader asked
 *   DELETE /api/reader/me                    forget this reader
 *
 * ── Why the answer is a stream ──────────────────────────────────────────────
 * A question takes a few model calls: read, maybe search, answer, and the
 * Sentinel's reading of it. Ten seconds is a long time to look at a
 * spinner. So the response is Server-Sent Events on the POST itself: each
 * tool call is a `step` frame as it happens, and the answer is one `answer`
 * frame at the end. Nothing is written to the stream until the Sentinel has
 * passed it. No job row, no polling: a turn is short enough to hold a
 * connection for.
 */

const express = require("express");

const { asyncHandler } = require("../lib/async-handler");
const { ApiError } = require("../lib/api-error");
const { readerIdentity } = require("../middleware/reader.middleware");
const { rateLimit } = require("../middleware/rate-limit.middleware");
const reader = require("../services/reader.service");
const { env } = require("../config/env");

const router = express.Router();

/* A burst ceiling per address, on top of the per-reader daily count in
   Mongo. Generous, because a classroom sits behind one address. */
const askLimiter = rateLimit({ name: "reader-ask", limit: 120, windowMs: 10 * 60 * 1000 });

router.use(readerIdentity);

function parseLevel(v) {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function parseFocus(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n < 1000 ? n : null;
}

router.post(
  "/stories/:slug/ask",
  askLimiter,
  asyncHandler(async (req, res) => {
    const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
    if (!question) throw new ApiError(400, "Ask something about the story.");
    const level = parseLevel(req.body?.level);
    const focusIndex = parseFocus(req.body?.focusIndex);

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders?.();

    let closed = false;
    const send = (type, data) => {
      if (closed) return;
      res.write(`event: ${type}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    /* The work stops when the reader goes or the deadline passes. The
       response's close, not the request's: a POST's request stream closes
       as soon as its body has been read, which is before anything here has
       been written. The response closes when the reader goes. */
    const control = new AbortController();
    res.on("close", () => { closed = true; if (!control.signal.aborted) control.abort(new Error("the reader left")); });
    const deadline = setTimeout(() => { if (!control.signal.aborted) control.abort(new Error("the deadline passed")); }, env.reader.turnDeadlineMs);
    const heartbeat = setInterval(() => { if (!closed) res.write(": keep-alive\n\n"); }, 10_000);

    send("accepted", { question });
    try {
      const result = await reader.askReader({
        slug: req.params.slug,
        readerKey: req.reader.key,
        question,
        level,
        focusIndex,
        signal: control.signal,
        onProgress: async (e) => send("step", { tool: e.tool, summary: e.summary }),
      });
      send("answer", { text: result.text, turn: result.turn });
      send("done", { remaining: result.remaining });
    } catch (error) {
      /* A refusal the reader should read as written, a turn that ran out of
         time (with its record, so the thread shows it), or one fixed sentence. */
      const status = error.statusCode || 500;
      if (status >= 500 && status !== 504) console.error("[reader] ask failed", error);
      send("error", { status, message: status >= 500 && status !== 504 ? "Something went wrong on our side. Try asking again in a moment." : error.message, ...(error.turn ? { turn: error.turn } : {}) });
    } finally {
      clearTimeout(deadline);
      clearInterval(heartbeat);
      closed = true;
      res.end();
    }
  }),
);

router.get(
  "/stories/:slug/turns",
  asyncHandler(async (req, res) => {
    res.status(200).json(await reader.listStoryTurns({ slug: req.params.slug, readerKey: req.reader.key }));
  }),
);

router.get(
  "/me/turns",
  asyncHandler(async (req, res) => {
    res.status(200).json(await reader.listReaderTurns({ readerKey: req.reader.key }));
  }),
);

router.delete(
  "/me",
  asyncHandler(async (req, res) => {
    const result = await reader.forgetReader({ readerKey: req.reader.key });
    req.reader.rotate();
    res.status(200).json(result);
  }),
);

module.exports = router;
