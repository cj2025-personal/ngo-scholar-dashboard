/**
 * The error handler, tested for the one thing it must never do: hand a
 * driver's internal message to a browser.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { errorHandler, notFoundHandler } = require("../src/middleware/error.middleware");
const { ApiError } = require("../src/lib/api-error");

function fakeRes() {
  const res = { headersSent: false, statusCode: null, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}
const req = { method: "GET", originalUrl: "/api/things" };

/** Silence the handler's own logging for one call, and return what it logged. */
function captureErrors(run) {
  const original = console.error;
  const lines = [];
  console.error = (...args) => lines.push(args);
  try {
    run();
  } finally {
    console.error = original;
  }
  return lines;
}

test("a 4xx is returned as written: those sentences are the product", () => {
  const res = fakeRes();
  errorHandler(new ApiError(403, "This source can't be drafted from: licence allows short quotes only."), req, res, () => {});
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, "This source can't be drafted from: licence allows short quotes only.");
  assert.equal(res.body.reference, undefined, "nothing to reference: the caller can act on this themselves");

  const withDetails = fakeRes();
  errorHandler(Object.assign(new ApiError(400, "Bad input."), { details: { field: "audience" } }), req, withDetails, () => {});
  assert.deepEqual(withDetails.body.details, { field: "audience" });
});

test("a 5xx says nothing about the inside, and logs the detail under a reference", () => {
  const res = fakeRes();
  const leaky = new Error("connect ECONNREFUSED mongodb://admin:hunter2@10.0.0.4:27017/ngo_profiles");
  const logged = captureErrors(() => errorHandler(leaky, req, res, () => {}));

  assert.equal(res.statusCode, 500);
  assert.ok(!/mongodb:\/\/|hunter2|10\.0\.0\.4|ECONNREFUSED/.test(JSON.stringify(res.body)), JSON.stringify(res.body));
  assert.match(res.body.error, /Something went wrong on our side/);
  assert.match(res.body.reference, /^[0-9a-f]{12}$/);

  /* The detail is not lost — it is on the log line, findable by the same
     reference the caller was given. */
  assert.equal(logged.length, 1);
  const line = logged[0].join(" ") + " " + logged[0][1]?.message;
  assert.ok(line.includes(res.body.reference), "the log names the reference the caller got");
  assert.ok(line.includes("GET /api/things"));
  assert.ok(line.includes("hunter2"), "the operator still gets everything");
});

test("two failures get two references, so one report names one request", () => {
  const a = fakeRes();
  const b = fakeRes();
  captureErrors(() => {
    errorHandler(new Error("x"), req, a, () => {});
    errorHandler(new Error("x"), req, b, () => {});
  });
  assert.notEqual(a.body.reference, b.body.reference);
});

test("an error after the response has begun is passed on, not written over", () => {
  const res = fakeRes();
  res.headersSent = true;
  let passed = null;
  errorHandler(new Error("too late"), req, res, (e) => { passed = e; });
  assert.equal(passed.message, "too late");
  assert.equal(res.statusCode, null, "nothing was written");
});

test("an unrouted path becomes a 404 that names what was asked for", () => {
  let err = null;
  notFoundHandler({ method: "POST", originalUrl: "/api/nope" }, fakeRes(), (e) => { err = e; });
  assert.equal(err.statusCode, 404);
  assert.match(err.message, /POST \/api\/nope/);
});
