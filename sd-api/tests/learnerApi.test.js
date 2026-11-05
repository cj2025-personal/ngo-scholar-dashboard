"use strict";
process.env.MONGODB_URI ||= "mongodb://localhost:27017";
process.env.MONGODB_DB ||= "learner-api-test";

/*
 * The studio's calls to the learner app's API (lib/learnerApi), 2026-11-05:
 * the reading checks learners answer after a scholar's story live there, and
 * the scholar reviews them from here. In production the call carries this
 * service's own Google ID token (no shared secret); outside it, the studio
 * token. The scholar is always named.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const { env } = require("../src/config/env");
const { callLearnerApi, _resetLearnerApiToken } = require("../src/lib/learnerApi");

const withEnv = async (values, fn) => {
  const saved = Object.fromEntries(Object.keys(values).map((k) => [k, env[k]]));
  Object.assign(env, values);
  _resetLearnerApiToken();
  try {
    return await fn();
  } finally {
    Object.assign(env, saved);
    _resetLearnerApiToken();
  }
};

const recorder = (answer) => {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).startsWith("http://metadata.google.internal")) return new Response("id-token-for-learner-api", { status: 200 });
    const { status = 200, body = {} } = typeof answer === "function" ? answer(String(url)) : answer;
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  };
  return { calls, fetcher };
};

test("in production the call carries this service's own ID token, minted for the learner API, and names the scholar", async () => {
  const { calls, fetcher } = recorder({ body: { checks: [] } });
  await withEnv({ isProduction: true, learnerApiUrl: "https://learner.example", learnerApiStudioToken: "never-used-in-production-000000" }, async () => {
    const body = await callLearnerApi("GET", "/stories/abc/reading-checks", { profileId: "p-1", fetcher });
    assert.deepEqual(body, { checks: [] });
    await callLearnerApi("GET", "/stories/abc/reading-checks", { profileId: "p-1", fetcher });
  });
  const metadata = calls.filter((c) => c.url.startsWith("http://metadata.google.internal"));
  assert.equal(metadata.length, 1, "the token is cached, not minted per call");
  assert.match(metadata[0].url, /audience=https%3A%2F%2Flearner\.example$/);
  assert.equal(metadata[0].init.headers["Metadata-Flavor"], "Google");
  const call = calls.find((c) => c.url === "https://learner.example/internal/studio/stories/abc/reading-checks");
  assert.equal(call.init.headers.Authorization, "Bearer id-token-for-learner-api");
  assert.equal(call.init.headers["x-scholar-profile"], "p-1");
  assert.equal(call.init.headers["x-studio-token"], undefined, "the shared token is never sent in production");
});

test("outside production the studio token stands in", async () => {
  const { calls, fetcher } = recorder({ body: { check: {} } });
  await withEnv({ isProduction: false, learnerApiUrl: "http://localhost:4000", learnerApiStudioToken: "dev-studio-token-0000000000000000" }, async () => {
    await callLearnerApi("POST", "/reading-checks/c1/questions", { profileId: "p-2", body: { question: "Q?", dropped: true }, fetcher });
  });
  assert.equal(calls.length, 1, "no metadata server outside production");
  assert.equal(calls[0].init.headers["x-studio-token"], "dev-studio-token-0000000000000000");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), { question: "Q?", dropped: true });
});

test("a missing address, a 404, a refusal and no answer each say what happened", async () => {
  await withEnv({ isProduction: false, learnerApiUrl: null }, async () => {
    await assert.rejects(callLearnerApi("GET", "/x", { profileId: "p" }), (e) => e.statusCode === 503);
  });
  await withEnv({ isProduction: false, learnerApiUrl: "http://localhost:4000", learnerApiStudioToken: null }, async () => {
    await assert.rejects(callLearnerApi("GET", "/x", { profileId: "p", fetcher: recorder({ status: 404, body: { message: "Not found." } }).fetcher }), (e) => e.statusCode === 404);
    await assert.rejects(callLearnerApi("GET", "/x", { profileId: "p", fetcher: recorder({ status: 401, body: { code: "STUDIO_CALLER_REFUSED" } }).fetcher }), (e) => e.statusCode === 502 && /STUDIO_CALLER_REFUSED/.test(e.message));
    const down = async () => { throw new TypeError("fetch failed"); };
    await assert.rejects(callLearnerApi("GET", "/x", { profileId: "p", fetcher: down }), (e) => e.statusCode === 502);
  });
});
