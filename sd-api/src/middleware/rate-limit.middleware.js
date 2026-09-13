const { ApiError } = require("../lib/api-error");

/**
 * A small fixed-window limiter for unauthenticated endpoints.
 *
 * ── What it is and is not for ──────────────────────────────────────────────
 * Invitation tokens are 48 random bytes, so this is not brute-force defence —
 * an attacker who can guess one has already defeated something far stronger
 * than a rate limit. What it stops is cheap abuse of the endpoints that create
 * credentials and hash passwords: argon2 is deliberately expensive, and an
 * unauthenticated path that runs it on demand is a denial-of-service lever.
 *
 * ── In-memory, and honest about it ─────────────────────────────────────────
 * State lives in this process. Two instances mean two independent budgets, so
 * the effective limit multiplies by the instance count. That is acceptable at
 * current scale — this service runs singly and the endpoints are used a handful
 * of times a week — and it is wrong the day it is scaled out. When that
 * happens the counter belongs in Mongo or Redis, and the interface here does
 * not have to change for it to move.
 *
 * Declared rather than discovered later: a limiter that silently stops limiting
 * when a second replica appears is worse than none, because it is trusted.
 */

/** Buckets, keyed by `${name}:${ip}`. Entries expire lazily on read. */
const buckets = new Map();

/**
 * Swept on write rather than on a timer, so an idle process holds no interval
 * and an unused limiter costs nothing.
 */
const SWEEP_EVERY = 500;
let writesSinceSweep = 0;

function sweep(now) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/**
 * Identify the caller.
 *
 * `x-forwarded-for` is only meaningful behind a proxy that sets it, and Express
 * only trusts it when `trust proxy` is configured. Falling back to `req.ip`
 * means a misconfigured deployment limits everyone as one bucket — noisy, but
 * failing closed is the right direction for a limiter.
 */
function callerKey(req) {
  const forwarded = req.headers["x-forwarded-for"];
  const ip =
    (typeof forwarded === "string" ? forwarded.split(",")[0].trim() : null) ||
    req.ip ||
    "unknown";
  return ip;
}

/**
 * @param {object} options
 * @param {string} options.name      distinct budget per endpoint
 * @param {number} options.limit     requests allowed per window
 * @param {number} options.windowMs
 */
function rateLimit({ name, limit, windowMs }) {
  return function rateLimitMiddleware(req, res, next) {
    const now = Date.now();

    if (++writesSinceSweep >= SWEEP_EVERY) {
      writesSinceSweep = 0;
      sweep(now);
    }

    const key = `${name}:${callerKey(req)}`;
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    bucket.count += 1;

    if (bucket.count > limit) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.set("Retry-After", String(retryAfter));
      return next(
        new ApiError(429, `Too many attempts. Try again in ${retryAfter} seconds.`),
      );
    }

    return next();
  };
}

/** Exposed for tests, which must not inherit counts from one another. */
function resetRateLimits() {
  buckets.clear();
  writesSinceSweep = 0;
}

module.exports = { rateLimit, resetRateLimits };
