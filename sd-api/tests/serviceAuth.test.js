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

test("requests are allowed up to the limit, then refused", () => {
  resetRateLimits();
  const limiter = rateLimit({ name: "t1", limit: 3, windowMs: 60_000 });

  const errors = [];
  for (let i = 0; i < 5; i += 1) {
    limiter(fakeReq(), fakeRes(), (err) => errors.push(err));
  }

  assert.equal(errors.filter((e) => !e).length, 3, "three should pass");
  const refused = errors.filter(Boolean);
  assert.equal(refused.length, 2);
  assert.equal(refused[0].statusCode ?? refused[0].status, 429);
});

test("callers have separate budgets", () => {
  // One abusive caller must not lock out every scholar redeeming an invitation.
  resetRateLimits();
  const limiter = rateLimit({ name: "t2", limit: 1, windowMs: 60_000 });

  let firstErr;
  let secondErr;
  limiter(fakeReq("10.0.0.1"), fakeRes(), (e) => (firstErr = e));
  limiter(fakeReq("10.0.0.2"), fakeRes(), (e) => (secondErr = e));

  assert.equal(firstErr, undefined);
  assert.equal(secondErr, undefined, "a different caller has its own budget");
});

test("endpoints have separate budgets", () => {
  // Exhausting the describe endpoint must not block redemption.
  resetRateLimits();
  const describe = rateLimit({ name: "describe", limit: 1, windowMs: 60_000 });
  const redeem = rateLimit({ name: "redeem", limit: 1, windowMs: 60_000 });

  let a;
  let b;
  describe(fakeReq(), fakeRes(), (e) => (a = e));
  redeem(fakeReq(), fakeRes(), (e) => (b = e));

  assert.equal(a, undefined);
  assert.equal(b, undefined);
});

test("the window resets", () => {
  resetRateLimits();
  const limiter = rateLimit({ name: "t3", limit: 1, windowMs: 1 });

  let first;
  limiter(fakeReq(), fakeRes(), (e) => (first = e));
  assert.equal(first, undefined);

  const start = Date.now();
  while (Date.now() - start < 3) {
    /* wait out a 1ms window without importing timers into a sync test */
  }

  let second;
  limiter(fakeReq(), fakeRes(), (e) => (second = e));
  assert.equal(second, undefined, "a new window starts with a fresh budget");
});

test("a forwarded client address is used when present", () => {
  resetRateLimits();
  const limiter = rateLimit({ name: "t4", limit: 1, windowMs: 60_000 });

  const behindProxy = (forwarded) => ({
    ip: "10.0.0.1",
    headers: { "x-forwarded-for": forwarded },
  });

  let first;
  let second;
  limiter(behindProxy("203.0.113.9, 10.0.0.1"), fakeRes(), (e) => (first = e));
  limiter(behindProxy("203.0.113.9, 10.0.0.1"), fakeRes(), (e) => (second = e));

  assert.equal(first, undefined);
  assert.ok(second, "the same real client must share one budget behind a proxy");
});
