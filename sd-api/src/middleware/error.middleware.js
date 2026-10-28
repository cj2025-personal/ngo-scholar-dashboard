/**
 * The last thing a request touches.
 *
 * ── Why a 5xx says less than it knows ──────────────────────────────────────
 * Every 4xx in this service carries a sentence written for the person reading
 * it — "This source can't be drafted from: licence allows short quotes only."
 * Those are the product, and they are returned as written.
 *
 * A 5xx is different. Its message was written by a driver or an SDK for an
 * operator, and it routinely carries connection strings, internal hostnames,
 * collection names and stack context. Returning that to a browser hands an
 * attacker a free map of the inside, so the client gets one fixed sentence and
 * a reference, and the detail goes to the log under that same reference. The
 * person reporting the fault can quote the reference; nothing else leaks.
 */

const crypto = require("crypto");

const { ApiError } = require("../lib/api-error");

/** Short, unique enough to find one request in a day's logs, not a secret. */
function reference() {
  return crypto.randomBytes(6).toString("hex");
}

function notFoundHandler(req, res, next) {
  next(new ApiError(404, `Route not found: ${req.method} ${req.originalUrl}`));
}

/**
 * What a failure says to the caller, logged as above: the body of a JSON
 * reply, or the last frame of a stream that was already open when it failed.
 * One function, so a streamed failure can never say more than a replied one.
 */
function describeError(error, req) {
  const status = error.statusCode || 500;

  /* A turn that ran out of time (504) is said as written: it is a deadline
     the policy set, not a fault to hide behind a reference. */
  if (status >= 500 && status !== 504) {
    const ref = reference();
    console.error(`[error] ref=${ref} ${req.method} ${req.originalUrl}`, error);
    return {
      status,
      body: { error: "Something went wrong on our side. Nothing you sent was lost; try again in a moment.", reference: ref },
    };
  }

  /* Deliberate, reader-facing, and safe to return as written. */
  const body = { error: error.message || "Request failed." };
  if (error.details) body.details = error.details;
  return { status, body };
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    next(error);
    return;
  }
  const { status, body } = describeError(error, req);
  res.status(status).json(body);
}

module.exports = {
  describeError,
  errorHandler,
  notFoundHandler,
};
