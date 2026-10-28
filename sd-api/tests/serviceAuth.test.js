/**
 * The secret that can mint an invitation for any of 9,925 scholars.
 *
 * An invitation is the authority to create credentials for a named person's
 * record, so this secret is more powerful than any single scholar's password.
 * These tests cover the ways a comparison could leak it or wrongly accept.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  SERVICE_TOKEN_HEADER,
  SERVICE_NAME_HEADER,
  secretsMatch,
  readServiceToken,
} = require("../src/lib/service-auth");
const { rateLimit, resetRateLimits } = require("../src/middleware/rate-limit.middleware");

test("a matching secret is accepted", () => {
  assert.equal(secretsMatch("a-long-shared-secret", "a-long-shared-secret"), true);
});

test("everything else is refused", () => {
  const secret = "a-long-shared-secret";
  const attacks = [
    [secret, "a-long-shared-secreT", "one character differs"],
    [secret, "a-long-shared-secre", "a prefix must not match"],
    [secret, `${secret}x`, "a suffix must not match"],
    ["", "", "two empty secrets are not a match"],
    [secret, "", "an unset expectation must never match"],
    ["", secret, "an empty presentation must never match"],
    [null, secret, "null is not a secret"],
    [undefined, secret, "undefined is not a secret"],
    [123, "123", "a number is not a secret"],
    [{}, secret, "an object is not a secret"],
  ];

  for (const [presented, expected, why] of attacks) {
    assert.equal(secretsMatch(presented, expected), false, why);
  }
});

test("secrets of different lengths compare without throwing", () => {
  // timingSafeEqual throws on length mismatch, and guarding with a length check
  // would itself leak the secret's length. Hashing both sides first removes the
  // question — this asserts the guard did not reintroduce it.
  assert.doesNotThrow(() => secretsMatch("a", "a-very-much-longer-secret-value"));
  assert.equal(secretsMatch("a", "a-very-much-longer-secret-value"), false);
});

test("the token header is read in both forms callers send", () => {
  // A token rejected for formatting produces an outage that looks like an auth
  // failure, which is an expensive thing to debug across two services.
  assert.equal(readServiceToken({ [SERVICE_TOKEN_HEADER]: "tok" }), "tok");
  assert.equal(readServiceToken({ [SERVICE_TOKEN_HEADER]: "Bearer tok" }), "tok");
  assert.equal(readServiceToken({ [SERVICE_TOKEN_HEADER]: "bearer  tok" }), "tok");
  assert.equal(readServiceToken({ [SERVICE_TOKEN_HEADER]: "  tok  " }), "tok");
});

test("an absent or unusable token reads as null, never as empty-string", () => {
  // An empty string that reached secretsMatch would be compared rather than
  // rejected outright; null makes the caller's check unambiguous.
  for (const headers of [
    {},
    undefined,
    { [SERVICE_TOKEN_HEADER]: "" },
    { [SERVICE_TOKEN_HEADER]: "   " },
    { [SERVICE_TOKEN_HEADER]: "Bearer " },
    { [SERVICE_TOKEN_HEADER]: 12345 },
    { [SERVICE_TOKEN_HEADER]: ["a", "b"] },
    { "x-other-header": "tok" },
  ]) {
    assert.equal(readServiceToken(headers), null, JSON.stringify(headers));
  }
});

test("the calling service name is a separate, advisory header", () => {
  // It is recorded for the audit trail and never used to decide access.
  assert.notEqual(SERVICE_NAME_HEADER, SERVICE_TOKEN_HEADER);
});

// ── Rate limiting ──────────────────────────────────────────────────────────

const fakeReq = (ip = "1.2.3.4") => ({ ip, headers: {} });
const fakeRes = () => ({ set() {} });
/* The count lives in the database in production; these tests inject the
   memory store, which the limiter also falls back to when the database
   refuses a count. */
const { memoryStore } = require("../src/middleware/rate-limit.middleware");
const limiterWith = (options) => rateLimit({ ...options, store: memoryStore() });
const run = (limiter, req) => new Promise((resolve) => { limiter(req, fakeRes(), resolve); });

test("requests are allowed up to the limit, then refused", async () => {
  const limiter = limiterWith({ name: "t1", limit: 3, windowMs: 60_000 });
  const errors = [];
  for (let i = 0; i < 5; i += 1) errors.push(await run(limiter, fakeReq()));
  assert.equal(errors.filter((e) => !e).length, 3, "three should pass");
  const refused = errors.filter(Boolean);
  assert.equal(refused.length, 2);
  assert.equal(refused[0].statusCode ?? refused[0].status, 429);
});

test("callers have separate budgets", async () => {
  // One abusive caller must not lock out every scholar redeeming an invitation.
  const limiter = limiterWith({ name: "t2", limit: 1, windowMs: 60_000 });
  assert.equal(await run(limiter, fakeReq("10.0.0.1")), undefined);
  assert.equal(await run(limiter, fakeReq("10.0.0.2")), undefined, "a different caller has its own budget");
});

test("endpoints have separate budgets", async () => {
  // Exhausting the describe endpoint must not block redemption.
  const describe = limiterWith({ name: "describe", limit: 1, windowMs: 60_000 });
  const redeem = limiterWith({ name: "redeem", limit: 1, windowMs: 60_000 });
  assert.equal(await run(describe, fakeReq()), undefined);
  assert.equal(await run(redeem, fakeReq()), undefined);
});

test("the window resets", async () => {
  const limiter = limiterWith({ name: "t3", limit: 1, windowMs: 1 });
  assert.equal(await run(limiter, fakeReq()), undefined);
  await new Promise((r) => setTimeout(r, 3));
  assert.equal(await run(limiter, fakeReq()), undefined, "a new window starts with a fresh budget");
});

test("a forwarded client address is used when present", async () => {
  const limiter = limiterWith({ name: "t4", limit: 1, windowMs: 60_000 });
  const behindProxy = (forwarded) => ({ ip: "10.0.0.1", headers: { "x-forwarded-for": forwarded } });
  assert.equal(await run(limiter, behindProxy("203.0.113.9, 10.0.0.1")), undefined);
  assert.ok(await run(limiter, behindProxy("203.0.113.9, 10.0.0.1")), "the same real client must share one budget behind a proxy");
});

test("a signed-in route's budget is the account's, not the address's", async () => {
  const limiter = limiterWith({ name: "t5", limit: 1, windowMs: 60_000, key: (req) => req.auth?.user?.profile_id || null });
  const as = (profile, ip) => ({ ip, headers: {}, auth: profile ? { user: { profile_id: profile } } : undefined });
  assert.equal(await run(limiter, as("scholar-a", "10.0.0.1")), undefined);
  assert.equal(await run(limiter, as("scholar-b", "10.0.0.1")), undefined, "two scholars behind one address have two budgets");
  assert.ok(await run(limiter, as("scholar-a", "10.0.0.2")), "one scholar on two devices has one budget");
  assert.equal(await run(limiter, as(null, "10.0.0.3")), undefined);
  assert.ok(await run(limiter, as(null, "10.0.0.3")), "without an account the address is the budget, as before");
});

test("a limit read from policy is read on every request, and a count the database refuses is kept in memory", async () => {
  resetRateLimits();
  let limit = 1;
  const refusing = { async take() { throw new Error("no database"); } };
  const limiter = rateLimit({ name: "t6", limit: async () => limit, windowMs: 60_000, store: refusing });
  assert.equal(await run(limiter, fakeReq("9.9.9.9")), undefined);
  assert.ok(await run(limiter, fakeReq("9.9.9.9")), "counted in memory when the database refuses");
  limit = 3;
  assert.equal(await run(limiter, fakeReq("9.9.9.9")), undefined, "the raised limit applies without a restart");
});

test("a window is aligned to the clock, so two replicas agree on it", async () => {
  /* The store loads the database module, which insists on a URL at load;
     the collection it then uses is the fake below. */
  process.env.MONGODB_URI ||= "mongodb://localhost:27017/rate-limit-test";
  process.env.MONGODB_DB ||= "rate-limit-test";
  const { mongoStore } = require("../src/middleware/rate-limit.middleware");
  /* The store's arithmetic, against a fake collection: the row's window
     start is the same from any replica within the window. */
  const rows = new Map();
  const fakeDb = { collection: () => ({ async findOneAndUpdate(q, u) { const k = `${q.key}|${q.window_start.getTime()}`; const row = rows.get(k) || { count: 0, expires_at: u.$setOnInsert.expires_at }; row.count += u.$inc.count; rows.set(k, row); return { ...row }; } }) };
  const store = mongoStore();
  const mongo = require("../src/db/mongo");
  const real = mongo.getDb;
  mongo.getDb = async () => fakeDb;
  try {
    const a = await store.take("k", 60_000, 120_000 + 5_000);
    const b = await store.take("k", 60_000, 120_000 + 50_000);
    assert.equal(a.count, 1);
    assert.equal(b.count, 2, "the same window from a later moment");
    assert.equal(a.resetAt, 180_000);
    assert.equal(b.resetAt, 180_000);
    const c = await store.take("k", 60_000, 180_000 + 1);
    assert.equal(c.count, 1, "the next window starts fresh");
    assert.ok([...rows.values()].every((r) => r.expires_at.getTime() > 180_000), "rows expire after the window");
  } finally {
    mongo.getDb = real;
  }
});
