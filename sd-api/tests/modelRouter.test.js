/**
 * The model router, against scripted transports.
 *
 * What must hold: a purpose runs on its route's primary with the route's
 * settings; a failure moves to the next model; a model that keeps failing is
 * skipped until its cooling-off ends; a safety block and an abort are never
 * retried on another model; reasoning budgets are lifted to what a model
 * accepts; a route with no primary means the deployment's model; embeddings
 * follow the same chain, or the one model the caller names.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { createRouter, resetBreakers, thinkingFor } = require("../src/lib/modelRouter");
const { merge } = require("../src/lib/policyDefaults");

const models = {
  routes: {
    default: { primary: null, fallback: ["backup"], thinkingBudget: 0, temperature: 0.4, maxOutputTokens: 100, timeoutMs: 1000 },
    "x.judge": { primary: "pro", fallback: ["flash"], thinkingBudget: 0, temperature: 0, maxOutputTokens: 200, timeoutMs: 2000 },
  },
  modelLimits: { pro: { minThinkingBudget: 128 }, lite: { minThinkingBudgetWhenOn: 512 } },
  embeddings: { primary: "emb-a", fallback: ["emb-b"], batchSize: 8, timeoutMs: 500 },
  breaker: { failureThreshold: 2, cooldownSeconds: 30 },
};

test("a purpose runs on its primary with the route's settings, lifted to what the model accepts", async () => {
  resetBreakers();
  const seen = [];
  const r = createRouter({ models, call: async (req) => { seen.push(req); return { text: "ok", usage: { input: 1 } }; } });
  const out = await r.generate("x.judge", { prompt: "p" });
  assert.equal(out.model, "pro");
  assert.equal(out.fallback, false);
  assert.equal(seen[0].temperature, 0);
  assert.equal(seen[0].maxOutputTokens, 200);
  assert.equal(seen[0].thinkingBudget, 128, "pro cannot think less than 128");
  assert.equal(thinkingFor("lite", 100, models.modelLimits), 512);
  assert.equal(thinkingFor("lite", 0, models.modelLimits), 0);
});

test("a failure moves on; a model that keeps failing is skipped until it cools off", async () => {
  resetBreakers();
  let clock = 1000;
  const tried = [];
  const calls = [];
  const r = createRouter({ models, now: () => clock, onCall: (e) => calls.push(e), call: async (req) => { tried.push(req.model); if (req.model === "pro") throw new Error("503"); return { text: "ok" }; } });
  assert.equal((await r.generate("x.judge", {})).model, "flash");
  assert.equal((await r.generate("x.judge", {})).model, "flash");
  assert.deepEqual(tried, ["pro", "flash", "pro", "flash"]);
  tried.length = 0;
  await r.generate("x.judge", {});
  assert.deepEqual(tried, ["flash"], "pro's breaker is open");
  clock += 31_000;
  tried.length = 0;
  await r.generate("x.judge", {});
  assert.deepEqual(tried, ["pro", "flash"], "tried again after cooling off");
  assert.ok(calls.some((c) => c.fallback && c.ok && c.model === "flash"));
});

test("a safety block and an abort are never retried on another model", async () => {
  resetBreakers();
  for (const make of [() => Object.assign(new Error("blocked"), { code: "BLOCKED" }), () => Object.assign(new Error("gone"), { name: "AbortError" })]) {
    const tried = [];
    const r = createRouter({ models, call: async (req) => { tried.push(req.model); throw make(); } });
    await assert.rejects(r.generate("x.judge", {}));
    assert.deepEqual(tried, ["pro"]);
  }
});

test("a route with no primary means the deployment's model; an unknown purpose uses the default", async () => {
  resetBreakers();
  const tried = [];
  const r = createRouter({ models, deploymentModel: "deploy-m", call: async (req) => { tried.push(req.model); return { text: "ok" }; } });
  await r.generate("nothing.like.this", {});
  assert.deepEqual(tried, ["deploy-m"]);
  const bound = r.bound("x.judge", { safetySettings: [1] });
  const seen = [];
  const r2 = createRouter({ models, call: async (req) => { seen.push(req); return { text: "ok" }; } });
  await r2.bound("x.judge", { safetySettings: [1] })({ prompt: "p" });
  assert.deepEqual(seen[0].safetySettings, [1]);
  assert.equal(typeof bound, "function");
});

test("embeddings follow the chain, or only the model the caller names", async () => {
  resetBreakers();
  const tried = [];
  const r = createRouter({ models, call: async () => ({}), embedCall: async (req) => { tried.push(req.model); if (req.model === "emb-a") throw new Error("down"); return { vectors: req.texts.map(() => [1]) }; } });
  assert.equal((await r.embed(["a"])).model, "emb-b");
  tried.length = 0;
  await assert.rejects(r.embed(["a"], { model: "emb-a" }));
  assert.deepEqual(tried, ["emb-a"]);
});

test("policy overrides merge key by key; arrays and scalars replace", () => {
  const out = merge({ a: { b: 1, c: [1, 2] }, d: 2 }, { a: { c: [9] }, e: 3 });
  assert.deepEqual(out, { a: { b: 1, c: [9] }, d: 2, e: 3 });
});
