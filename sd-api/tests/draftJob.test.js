/**
 * The job's rules: who may move it, what makes two requests the same, and
 * where the cap bites.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  STATUS, TERMINAL, STEPS, LOCK_MS, HEARTBEAT_MS,
  canTransition, idempotencyKey, retryKey, corpusHash, withinDailyCap, dayStart, nextEvent, failureSentence,
} = require("../src/lib/draftJob");

test("only the scholar closes a review; only a worker advances a run; only expiry re-queues", () => {
  assert.equal(canTransition({ from: STATUS.QUEUED, to: STATUS.RUNNING, actor: "worker" }).ok, true);
  assert.equal(canTransition({ from: STATUS.RUNNING, to: STATUS.AWAITING_REVIEW, actor: "worker" }).ok, true);
  assert.equal(canTransition({ from: STATUS.AWAITING_REVIEW, to: STATUS.PUBLISHED, actor: "scholar" }).ok, true);
  assert.equal(canTransition({ from: STATUS.AWAITING_REVIEW, to: STATUS.PUBLISHED, actor: "worker" }).ok, false, "a machine must not publish");
  assert.equal(canTransition({ from: STATUS.AWAITING_REVIEW, to: STATUS.PUBLISHED, actor: "system" }).ok, false);
  assert.equal(canTransition({ from: STATUS.RUNNING, to: STATUS.QUEUED, actor: "system" }).ok, true);
  assert.equal(canTransition({ from: STATUS.RUNNING, to: STATUS.QUEUED, actor: "scholar" }).ok, false);
  assert.equal(canTransition({ from: STATUS.PUBLISHED, to: STATUS.QUEUED, actor: "scholar" }).ok, false, "terminal is terminal");
  for (const s of TERMINAL) assert.ok(Object.values(STATUS).includes(s));
});

test("the key is content-addressed and every input matters", () => {
  const base = { profileId: "p", origin: "harvested", sourceId: "s", audience: "general", promptVersion: "v1", corpusHash: corpusHash("text") };
  const k = idempotencyKey(base);
  assert.equal(k, idempotencyKey({ ...base }));
  assert.notEqual(k, idempotencyKey({ ...base, audience: "students" }));
  assert.notEqual(k, idempotencyKey({ ...base, promptVersion: "v2" }));
  assert.notEqual(k, idempotencyKey({ ...base, corpusHash: corpusHash("text changed") }));
  assert.notEqual(k, idempotencyKey({ ...base, profileId: "someone else" }));
  assert.throws(() => idempotencyKey({ ...base, corpusHash: "" }), /requires corpusHash/);
  assert.equal(retryKey(k, 2), `${k}:r2`);
});

test("the daily cap counts starts, refuses at the limit, and zero means off", () => {
  assert.deepEqual(withinDailyCap({ startedToday: 0, cap: 10 }), { ok: true, remaining: 10 });
  assert.equal(withinDailyCap({ startedToday: 9, cap: 10 }).ok, true);
  const at = withinDailyCap({ startedToday: 10, cap: 10 });
  assert.equal(at.ok, false);
  assert.match(at.reason, /daily limit is 10/);
  assert.match(withinDailyCap({ startedToday: 0, cap: 0 }).reason, /switched off/);
  const d = dayStart(new Date("2026-09-12T23:59:59Z"));
  assert.equal(d.toISOString(), "2026-09-12T00:00:00.000Z");
});

test("events are sequenced from what is already there", () => {
  const e1 = nextEvent([], "job_created", { a: 1 }, new Date(0));
  assert.equal(e1.sequence, 1);
  const e2 = nextEvent([e1], "step", {}, new Date(0));
  assert.equal(e2.sequence, 2);
  assert.deepEqual(Object.keys(e2), ["sequence", "type", "at", "data"]);
});

test("every failure becomes a sentence with something the scholar can do", () => {
  const cases = [
    [new Error("Drafting is not configured: GCP_PROJECT_ID is not set."), /isn't set up/],
    [new Error("Section 2 kept writing in the first person after a retry."), /about you/],
    [new Error('Section 3 ("Where it breaks") kept making claims the paper doesn\'t support.'), /doesn't support/],
    [new Error("We hold this source's title but not enough of its text to draft from."), /Uploading the paper/],
    [new Error("The model did not return valid JSON for the outline."), /retry/],
    [new Error("Vertex generateContent error 429: quota"), /busy/],
    [new Error("Vertex request failed: The operation was aborted"), /too long/],
    [new Error("Vertex generateContent error 500: boom"), /couldn't reach/],
    [new Error("something else entirely"), /Try again/],
  ];
  for (const [err, re] of cases) {
    const s = failureSentence(err);
    assert.match(s, re, err.message);
    assert.ok(!/^Draft failed/.test(s));
  }
});

test("constants are the documented shape", () => {
  assert.ok(HEARTBEAT_MS * 2 < LOCK_MS, "heartbeat must fit twice inside the lock");
  assert.deepEqual(STEPS, ["pick_source", "plan_outline", "draft_blocks", "judge_fidelity", "judge_reach", "assemble", "verify", "create_story"]);
  assert.equal(canTransition({ from: STATUS.RUNNING, to: STATUS.AWAITING_OUTLINE, actor: "worker" }).ok, true);
  assert.equal(canTransition({ from: STATUS.AWAITING_OUTLINE, to: STATUS.QUEUED, actor: "scholar" }).ok, true, "approving the outline re-queues");
  assert.equal(canTransition({ from: STATUS.AWAITING_OUTLINE, to: STATUS.QUEUED, actor: "worker" }).ok, false);
  assert.equal(canTransition({ from: STATUS.RUNNING, to: STATUS.PUBLISHED, actor: "worker" }).ok, true, "a draft that became a story closes the job");
});
