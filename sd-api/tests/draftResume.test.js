/**
 * A draft that stops part-way and is picked up again.
 *
 * On Cloud Run a container has CPU only while a request is open, so a draft
 * can stop anywhere: the scholar closed the tab, the container was taken
 * away. What must hold: the graph reports every node and every section it
 * finished; a run handed that report enters where the first one stopped,
 * writes nothing again that was already accepted, and ends with exactly the
 * draft an uninterrupted run would have made. And the job's rules for an
 * interruption — what counts as the platform's fault, when a job reads as
 * paused, how long it waits before trying again — say what they mean.
 *
 * Pure: the graph runs on the shared test double; no database.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const composer = require("../src/lib/draftComposer");
const { runDraftGraph, nextNode } = require("../src/lib/draftGraph");
const { USE } = require("../src/lib/draftEligibility");
const shared = require("../src/lib/fakeModel");
const job = require("../src/lib/draftJob");

const PAPER = [
  "Adaptive antenna arrays reduce interference by steering nulls toward unwanted sources. The method updates weights with a least-mean-squares rule every two milliseconds, which is fast enough for fixed interferers. Four patch elements were spaced at half a wavelength.",
  "In field trials the array improved the signal-to-noise ratio by eleven decibels with one interferer and by seven with two. The desired signal arrived at broadside in every trial, which is the easiest case for the array. Convergence took between forty and three hundred updates.",
  "The authors note that performance degrades when more than four interferers are present, because the array has only three degrees of freedom left once one is spent on the desired direction. In seventeen of forty trials the array reduced desired-signal gain by more than two decibels.",
  "All trials were run in an anechoic chamber. Multipath in a real building would present many more apparent sources, so the degradation is expected to appear at lower interferer counts outdoors. The array was not tested with moving interferers.",
  "Future work should test a six- or eight-element array under multipath and with moving sources. A larger step size converged faster but oscillated in the two-interferer geometry.",
  "Power consumption was measured at 1.8 watts for the processor and 0.6 watts for the four low-noise amplifiers. That is within the budget of a battery-powered sensor node for about nine hours.",
].join("\n\n");

const input = {
  source: { id: "src-1", origin: "harvested", title: "Adaptive nulling", year: 2024, use: USE.DRAFTABLE, reason: "licensed in full" },
  scholar: { name: "Test Scholar" },
  audience: "general",
  voice: "about",
  prepared: composer.prepareSourceText(PAPER),
  setAside: [],
};

/** The shared double, counting how often each section was written. */
function model({ failOn = null } = {}) {
  const written = {};
  let calls = 0;
  let failed = false;
  const generate = async (req) => {
    calls += 1;
    const m = String(req.prompt || "").match(/Write section (\d+) of/);
    if (m) {
      if (failOn && Number(m[1]) === failOn && !failed) {
        failed = true;
        throw Object.assign(new Error("Vertex request failed: This operation was aborted"), { name: "AbortError" });
      }
      written[m[1]] = (written[m[1]] || 0) + 1;
    }
    return shared.generateContent(req);
  };
  return { generate, written, count: () => calls };
}

/** What the job keeps, as the job keeps it: through JSON, as stored. */
function keeper() {
  const checkpoints = [];
  const sections = [];
  return {
    checkpoints,
    sections,
    deps: {
      checkpoint: async (c) => { checkpoints.push(JSON.parse(JSON.stringify(c))); },
      onSection: async (s) => { sections.push(JSON.parse(JSON.stringify(s))); },
    },
  };
}

/** The sections kept for a round, in the shape the job stores them. */
const keptFor = (sections, round) => ({ round, done: Object.fromEntries(sections.filter((s) => s.round === round).map((s) => [s.index, { section: s.section, warnings: s.warnings, calls: s.calls }])) });

let baseline = null;
async function uninterrupted() {
  if (!baseline) {
    const m = model();
    baseline = { result: await runDraftGraph(input, { generate: m.generate }), written: m.written, calls: m.count() };
  }
  return baseline;
}

test("reporting what it finished changes nothing about the draft", async () => {
  const base = await uninterrupted();
  const m = model();
  const k = keeper();
  const r = await runDraftGraph(input, { generate: m.generate, ...k.deps });
  assert.deepEqual(r, base.result);
  assert.ok(base.result.outline.length >= 3, `the paper makes at least three sections (${base.result.outline.length})`);

  const nodes = k.checkpoints.map((c) => c.node);
  assert.deepEqual(nodes.slice(0, 5), ["pick_source", "plan_outline", "draft_blocks", "assemble", "verify"]);
  for (const c of k.checkpoints) assert.equal(c.next, nextNode(c.node, c.state), "each checkpoint names the node that runs next");
  assert.equal(k.checkpoints[k.checkpoints.length - 1].next, null, "the last one says the graph is done");
  assert.deepEqual(k.sections.map((s) => s.index), base.result.outline.map((b) => b.index), "every section is kept as it is accepted, in order");
  assert.ok(k.sections.every((s) => s.calls.length >= 2 && s.calls.every((c) => c.beat === s.index)), "each kept section carries the calls it cost");
});

test("interrupted while writing section 2, a resumed run writes sections 2 onward only, and ends with the same draft", async () => {
  const base = await uninterrupted();
  const first = model({ failOn: 2 });
  const k = keeper();
  await assert.rejects(runDraftGraph(input, { generate: first.generate, ...k.deps }), /aborted/);
  assert.deepEqual(first.written, { 1: 1 }, "section 1 was written; section 2 was in hand when it stopped");
  const last = k.checkpoints[k.checkpoints.length - 1];
  assert.equal(last.node, "plan_outline");
  assert.equal(last.next, "draft_blocks");
  assert.deepEqual(k.sections.map((s) => s.index), [1], "section 1 was kept before section 2 started");

  const second = model();
  const progress = [];
  const k2 = keeper();
  const r = await runDraftGraph(
    { ...input, resume: { next: last.next, state: last.state, sections: keptFor(k.sections, 0) } },
    { generate: second.generate, onProgress: (e) => progress.push(e), ...k2.deps },
  );
  assert.equal(second.written[1], undefined, "section 1 is not written again");
  for (const b of base.result.outline.filter((x) => x.index > 1)) assert.equal(second.written[b.index], 1, `section ${b.index} is written once`);
  assert.ok(!progress.some((e) => e.step === "plan_outline" || e.step === "pick_source"), "the paper is not read nor the outline planned again");
  assert.ok(progress.some((e) => e.step === "resume" && /1 of \d+ sections? already written/.test(e.message)), "the resumption is said out loud");
  assert.ok(!progress.some((e) => e.step === "section_drafted" && e.detail.index === 1), "section 1 is not announced twice");
  assert.deepEqual(r, base.result, "the same draft, warnings and calls as a run that was never interrupted");
});

test("resumed from any node it finished, the run ends with the same draft; resumed after the end, it calls no model", async () => {
  const base = await uninterrupted();
  const k = keeper();
  await runDraftGraph(input, { generate: model().generate, ...k.deps });
  for (const c of k.checkpoints) {
    const m = model();
    const r = await runDraftGraph({ ...input, resume: { next: c.next, state: c.state, sections: null } }, { generate: m.generate });
    assert.deepEqual(r, base.result, `resumed after ${c.node}`);
    if (c.next === null) assert.equal(m.count(), 0, "a finished graph is not run again");
    /* Reading the paper calls no model, so only what came after it saves calls. */
    else if (c.node === "pick_source") assert.equal(m.count(), base.calls);
    else assert.ok(m.count() < base.calls, `resumed after ${c.node}, it makes fewer calls than a fresh run`);
  }
});

test("sections kept from an earlier round are not carried into a rewrite for the reader", async () => {
  /* The rewrite round is a new round: what round 0 accepted was judged too
     hard, so it must not stand in for round 1's sections. */
  const k = keeper();
  await runDraftGraph(input, { generate: model().generate, ...k.deps });
  const afterPlan = k.checkpoints.find((c) => c.node === "plan_outline");
  const stale = keptFor(k.sections, 0);
  const m = model();
  const r = await runDraftGraph(
    { ...input, resume: { next: "draft_blocks", state: { ...afterPlan.state, readabilityRounds: 1 }, sections: stale } },
    { generate: m.generate },
  );
  assert.ok(Object.keys(m.written).length === r.outline.length, "every section is written again in the new round");
});

/* ── the job's rules for an interruption ─────────────────────────────────── */

test("a timeout, a dropped connection, a 429 or a 5xx is the platform's fault; a draft's own failure is not", () => {
  const transient = [
    Object.assign(new Error("This operation was aborted"), { name: "AbortError" }),
    Object.assign(new Error("Vertex generateContent error 503: unavailable"), { status: 503 }),
    new Error("Vertex generateContent error 429: quota"),
    new Error("Vertex request failed: fetch failed"),
    new Error("read ECONNRESET"),
    new Error("The model took too long: timed out"),
  ];
  for (const e of transient) assert.equal(job.isTransient(e), true, e.message);
  const own = [
    new Error("Section 2 kept writing in the first person after a retry."),
    new Error("The model did not return valid JSON for the outline."),
    new Error("Drafting is not configured: GCP_PROJECT_ID is not set."),
    Object.assign(new Error("Vertex generateContent error 400: bad request"), { status: 400 }),
    null,
  ];
  for (const e of own) assert.equal(job.isTransient(e), false, String(e?.message));
});

test("a job reads as paused when no worker has had the CPU to hold or take it", () => {
  const now = new Date("2026-11-01T12:00:00Z");
  const ago = (ms) => new Date(now.getTime() - ms);
  assert.deepEqual(job.pausedState({ status: "running", lease_expires_at: ago(-30_000) }, now), { paused: false, since: null }, "a live lease is a run in progress");
  const lapsed = job.pausedState({ status: "running", lease_expires_at: ago(5_000) }, now);
  assert.equal(lapsed.paused, true, "a lease nobody renewed: its container was frozen or is gone");
  assert.equal(lapsed.since.getTime(), ago(5_000).getTime());
  assert.equal(job.pausedState({ status: "queued", updated_at: ago(2_000) }, now).paused, false, "just queued is starting, not paused");
  assert.equal(job.pausedState({ status: "queued", updated_at: ago(job.PAUSE_AFTER_MS + 1) }, now).paused, true, "queued and unclaimed past any poll: nobody has CPU");
  assert.equal(job.pausedState({ status: "queued", updated_at: ago(60_000), not_before: ago(-3_000) }, now).paused, false, "waiting out a backoff is not paused");
  for (const status of ["awaiting_review", "awaiting_outline", "published", "failed", "discarded"]) {
    assert.equal(job.pausedState({ status, lease_expires_at: ago(60_000), updated_at: ago(60_000) }, now).paused, false, status);
    assert.equal(job.isSettled(status), true, status);
  }
  assert.equal(job.isSettled("running"), false);
  assert.equal(job.isSettled("queued"), false);
});

test("a worker may hand a job back to the queue; a scholar may not; the wait grows and is bounded", () => {
  assert.equal(job.canTransition({ from: "running", to: "queued", actor: "worker" }).ok, true);
  assert.equal(job.canTransition({ from: "running", to: "queued", actor: "system" }).ok, true);
  assert.equal(job.canTransition({ from: "running", to: "queued", actor: "scholar" }).ok, false);
  assert.deepEqual([1, 2, 3, 4].map(job.retryBackoffMs), [5_000, 10_000, 20_000, 40_000]);
  assert.equal(job.retryBackoffMs(10), 60_000);
  assert.ok(job.HEARTBEAT_MS * 2 < job.LOCK_MS);
  assert.match(job.failureSentence(new Error("interrupted 4 times in a row without getting further")), /interrupted several times in a row/);
});
