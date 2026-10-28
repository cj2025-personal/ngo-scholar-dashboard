const { ApiError } = require("../lib/api-error");

/**
 * A small fixed-window limiter.
 *
 * ── What it is and is not for ──────────────────────────────────────────────
 * Invitation tokens are 48 random bytes, so this is not brute-force defence —
 * an attacker who can guess one has already defeated something far stronger
 * than a rate limit. What it stops is cheap abuse of the endpoints that create
 * credentials and hash passwords, and runaway spend on the ones that call a
 * model: argon2 and a model turn are both deliberately expensive, and a path
 * that runs either on demand is a denial-of-service lever.
 *
 * ── Counted in the database, so every replica sees one budget ──────────────
 * The count lives in Mongo, in a row per budget per window, so ten replicas
 * behind one load balancer enforce one limit rather than ten. A window is
 * aligned to the clock (the minute, the ten minutes) rather than to a
 * caller's first request, so two replicas never disagree about when it
 * started. Rows expire on their own.
 *
 * If the database cannot be reached the request is counted in this
 * process's memory instead, and the fact is logged once: a limiter that
 * refuses everyone when the database blinks is a worse outage than one that
 * is briefly per-replica. Tests inject the memory store directly.
 */

/** Buckets, keyed by `${name}:${caller}`. Entries expire lazily on read. */
function memoryStore() {
  const buckets = new Map();
  let writesSinceSweep = 0;
  return {
    async take(key, windowMs, now) {
      if (++writesSinceSweep >= 500) {
        writesSinceSweep = 0;
        for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
      }
      const bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
        const fresh = { count: 1, resetAt: now + windowMs };
        buckets.set(key, fresh);
        return fresh;
      }
      bucket.count += 1;
      return bucket;
    },
    reset() { buckets.clear(); writesSinceSweep = 0; },
  };
}

/** One row per budget per clock-aligned window, incremented atomically. */
function mongoStore() {
  return {
    async take(key, windowMs, now) {
      const { getDb, COLLECTIONS } = require("../db/mongo");
      const db = await getDb();
      const windowStart = Math.floor(now / windowMs) * windowMs;
      const resetAt = windowStart + windowMs;
      const row = await db.collection(COLLECTIONS.rateLimits).findOneAndUpdate(
        { key, window_start: new Date(windowStart) },
        { $inc: { count: 1 }, $setOnInsert: { expires_at: new Date(resetAt + windowMs) } },
        { upsert: true, returnDocument: "after" },
      );
      return { count: row?.count ?? row?.value?.count ?? 1, resetAt };
    },
  };
}

const fallback = memoryStore();
let warnedFallback = false;

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
 * @param {number|(() => Promise<number>)} options.limit     requests allowed per window
 * @param {number|(() => Promise<number>)} options.windowMs
 * @param {(req: object) => (string|null|undefined)} [options.key]
 *        who the budget belongs to, when not the caller's address: on a
 *        signed-in route, the account, so two scholars behind one proxy do
 *        not share a budget and one scholar on two devices does. A key the
 *        function cannot give falls back to the address.
 * @param {{take: Function}} [options.store]   where the count lives; the database unless a test says otherwise
 */
function rateLimit({ name, limit: limitOption, windowMs: windowOption, key: keyOption = null, store = null }) {
  const counts = store || mongoStore();
  /* A limit may be a number, or a function that reads it from policy each
     time, so a change to the policy applies without a restart. */
  const read = async (v) => (typeof v === "function" ? Number(await v()) : v);
  return function rateLimitMiddleware(req, res, next) {
    return apply(req, res, next).catch(next);
  };

  async function apply(req, res, next) {
    const [limit, windowMs] = await Promise.all([read(limitOption), read(windowOption)]);
    const now = Date.now();
    const own = typeof keyOption === "function" ? keyOption(req) : null;
    const key = `${name}:${own ? `account:${own}` : callerKey(req)}`;

    let bucket;
    try {
      bucket = await counts.take(key, windowMs, now);
    } catch (error) {
      if (!warnedFallback) { warnedFallback = true; console.warn(`[rate-limit] counting in memory on this replica; the database refused the count (${error.message})`); }
      bucket = await fallback.take(key, windowMs, now);
    }

    if (bucket.count > limit) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.set("Retry-After", String(retryAfter));
      return next(new ApiError(429, `Too many attempts. Try again in ${retryAfter} seconds.`));
    }
    return next();
  }
}

/** Exposed for tests, which must not inherit counts from one another. */
function resetRateLimits() {
  fallback.reset();
}

module.exports = { rateLimit, resetRateLimits, memoryStore, mongoStore };
