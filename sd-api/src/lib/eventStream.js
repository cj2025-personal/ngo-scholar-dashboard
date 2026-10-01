"use strict";

/**
 * A response as Server-Sent Events, for work the person is watching happen.
 *
 * Asked for, never imposed: a caller that sends `Accept: text/event-stream`
 * gets the work frame by frame and the result as the last frame; any other
 * caller gets the same result as one JSON reply, exactly as before. Nothing
 * else about the request changes — validation, limits and ownership all run
 * before the stream opens, so a refusal there is an ordinary error reply.
 *
 * Proxies are told not to buffer (`X-Accel-Buffering`, `no-transform`), and a
 * comment line every few seconds keeps an idle connection from being reaped
 * while a model thinks. Once the person goes, frames are dropped rather than
 * written into a closed socket; the work itself is not cancelled, because what
 * it produces is saved and is there when they come back.
 */

const HEARTBEAT_MS = 10_000;

function wantsEventStream(req) {
  return /\btext\/event-stream\b/i.test(String(req.get("accept") || ""));
}

/**
 * @param {import("express").Response} res
 * @returns {{ send: (event: string, data: unknown) => void, end: () => void, readonly closed: boolean }}
 */
function openEventStream(res, { heartbeatMs = HEARTBEAT_MS } = {}) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();

  let closed = false;
  /* The response's close, not the request's: a POST's request stream closes
     as soon as its body has been read, long before anything is written. */
  res.on("close", () => { closed = true; });
  const heartbeat = setInterval(() => { if (!closed) res.write(": keep-alive\n\n"); }, heartbeatMs);
  heartbeat.unref?.();

  return {
    get closed() { return closed; },
    send(event, data) {
      if (closed) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    end() {
      clearInterval(heartbeat);
      if (closed) return;
      closed = true;
      res.end();
    },
  };
}

module.exports = { wantsEventStream, openEventStream };
