/**
 * A draft whose worker stops part-way, against a throwaway database.
 *
 * ── Why ─────────────────────────────────────────────────────────────────────
 * On Cloud Run with CPU allocated only during requests, the drafting worker
 * inside the API gets CPU only while some request is open on its container.
 * A scholar who closes the tab freezes the draft mid-call; a container scaled
 * to zero takes it away; a thawed container's timers all fire at once and
 * its model call "times out". Each of those is simulated here, and each must
 * end in the draft the scholar asked for: resumed from what was finished,
 * nothing finished done twice, nothing finished lost, and the stopped run
 * unable to write anything once another holds the job.
 *
 * ── What runs ───────────────────────────────────────────────────────────────
 * An in-memory MongoDB seeded with the e2e scholar; the real drafting routes
 * and service in this process, with LLM_PROVIDER=fake. The test double is
 * wrapped so a model call can be held open (a frozen container) or made to
 * fail (a thawed one), and so every section the writer is asked for is
 * counted. A lease outlasted by a freeze is a lease whose expiry is in the
 * past, written so.
 *
 *   npm run test:e2e
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");

const { MongoClient, ObjectId } = require("mongodb");
const { MongoMemoryServer } = require("mongodb-memory-server");

const { seedScholar } = require("./seed");

const DB_NAME = "sd_resume";
const SECTION = /Write section (\d+) of/;

let mongod;
let client;
let db;
let server;
let base;
let cookie;
let svc;
let jobLib;
let serviceDb;
const state = {};

/* The model, as the service reaches it: the shared test double, wrapped. */
const hooks = {
  written: {},
  freezeAt: null,
  failAt: null,
  gate: null,
  frozen: null,
};

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

function installModelHooks() {
  const fake = require("../src/lib/fakeModel");
  const real = fake.generateContent;
  fake.generateContent = async (req) => {
    const m = String(req.prompt || "").match(SECTION);
    if (m) {
      const n = Number(m[1]);
      hooks.written[n] = (hooks.written[n] || 0) + 1;
      if (hooks.freezeAt === n) {
        /* The container is frozen with this call in flight. */
        hooks.freezeAt = null;
        hooks.gate = deferred();
        hooks.frozen.resolve();
        await hooks.gate.promise;
      }
      if (hooks.failAt === n) {
        /* The container thawed and its model call had timed out. */
        hooks.failAt = null;
        throw Object.assign(new Error("Vertex generateContent error 503: The service is currently unavailable."), { status: 503 });
      }
    }
    return real(req);
  };
}

function resetHooks() {
  hooks.written = {};
  hooks.freezeAt = null;
  hooks.failAt = null;
  hooks.gate = null;
  hooks.frozen = deferred();
}

const call = async (method, p, body) => {
  const init = { method, headers: { Cookie: `sd_session=${cookie}` } };
  if (body !== undefined) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
  const res = await fetch(`${base}${p}`, init);
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  return { status: res.status, data };
};

const jobs = () => db.collection("scholar_draft_jobs");
const stored = (id) => jobs().findOne({ _id: new ObjectId(String(id)) });
const types = (doc) => doc.events.map((e) => e.type);

async function createJob(body) {
  const r = await call("POST", "/api/drafting/jobs", { origin: "harvested", audience: "general", ...body });
  assert.equal(r.status, 202, JSON.stringify(r.data));
  return r.data.job.id;
}

/**
 * Nothing written twice: every call the writer made for a section is one the
 * finished draft kept and paid for — its run's record lists them, carried
 * calls included — except the one call that was in flight when the run was
 * stopped, which is lost with it. (A section may legitimately be written
 * more than once in any run: the voice and fact-check judges send it back.)
 */
async function assertNothingWrittenTwice(jobId, { lostIn = null } = {}) {
  const run = await db.collection("scholar_draft_runs").findOne({ job_id: new ObjectId(String(jobId)), outcome: "delivered" });
  const kept = {};
  for (const c of run.calls) if (c.step === "draft_blocks") kept[c.beat] = (kept[c.beat] || 0) + 1;
  assert.deepEqual(Object.keys(hooks.written).sort(), Object.keys(kept).sort(), "every section was written and kept");
  for (const [n, made] of Object.entries(hooks.written)) {
    assert.equal(made, kept[n] + (Number(n) === lostIn ? 1 : 0), `section ${n}: ${made} writer call(s) made, ${kept[n]} kept in the draft`);
  }
}

/** Claim this job and run it to wherever it stops, as a worker tick would. */
async function claimAndRun(id) {
  const doc = await svc.claimNextJob(serviceDb, { jobId: id });
  assert.ok(doc, "the job was claimable");
  await svc.runClaimedJob(serviceDb, doc);
}

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongod.getUri());
  db = client.db(DB_NAME);
  cookie = (await seedScholar(db)).token;

  /* Set before any of the service is loaded: its config is read once. No
     .env is read here, so nothing can reach a real database or model. */
  Object.assign(process.env, {
    NODE_ENV: "test",
    MONGODB_URI: mongod.getUri(),
    MONGODB_DB: DB_NAME,
    LLM_PROVIDER: "fake",
    DRAFT_DAILY_CAP: "20",
    RECORD_CHECKS: "false",
    CORS_ORIGIN: "http://localhost:3000",
    GCP_PROJECT_ID: "",
    GCP_SERVICE_ACCOUNT_JSON: "",
    GCP_SERVICE_ACCOUNT_KEY_FILE: "",
    GOOGLE_APPLICATION_CREDENTIALS: "",
    LANGSMITH_API_KEY: "",
  });
  const express = require("express");
  const cookieParser = require("cookie-parser");
  const mongo = require("../src/db/mongo");
  await mongo.connectToMongo();
  serviceDb = (await mongo.getCollections()).db;
  svc = require("../src/services/draftJob.service");
  jobLib = require("../src/lib/draftJob");
  installModelHooks();
  resetHooks();

  const { errorHandler, notFoundHandler } = require("../src/middleware/error.middleware");
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use("/api/drafting", require("../src/routes/drafting.routes"));
  app.use(notFoundHandler);
  app.use(errorHandler);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (hooks.gate) hooks.gate.resolve();
  if (server) { server.closeAllConnections?.(); await new Promise((resolve) => server.close(resolve)); }
  await require("../src/db/mongo").closeMongo();
  if (client) await client.close();
  if (mongod) await mongod.stop();
});

test("an uninterrupted draft, for comparison", async () => {
  resetHooks();
  const id = await createJob({ sourceId: "src-e2e-1", createStory: false });
  await claimAndRun(id);
  const doc = await stored(id);
  assert.equal(doc.status, "awaiting_review", JSON.stringify(doc.failure));
  state.baseline = doc.draft;
  state.sections = doc.draft.outline.length;
  assert.ok(state.sections >= 3, `enough sections to stop in the middle of (${state.sections})`);
  await assertNothingWrittenTwice(id);
  state.baselineWritten = { ...hooks.written };
  assert.equal(doc.checkpoint, null, "a finished job keeps no checkpoint");
});

test("frozen while writing section 2, past its lease: a later request resumes it, and nothing is written twice or lost", async () => {
  resetHooks();
  const id = await createJob({ sourceId: "src-e2e-1", createStory: true });

  /* A worker claims it and is frozen with section 2's call in flight. */
  hooks.freezeAt = 2;
  const first = await svc.claimNextJob(serviceDb, { jobId: id });
  const staleRun = svc.runClaimedJob(serviceDb, first);
  await hooks.frozen.promise;
  let doc = await stored(id);
  assert.equal(doc.status, "running");
  assert.equal(doc.checkpoint.next, "draft_blocks", "the outline is kept");
  assert.deepEqual(Object.keys(JSON.parse(doc.checkpoint.sections).done), ["1"], "section 1 is kept");
  assert.equal(doc.checkpoint.summary.sections_written, 1);
  assert.equal(doc.stalled_claims, 0, "getting further resets the count of claims that got nowhere");

  /* The freeze outlasts the lease: nothing renewed it. */
  await jobs().updateOne({ _id: doc._id }, { $set: { lease_expires_at: new Date(Date.now() - 1000) } });

  /* The page reads the job: it says paused, and how far it got, rather than "being written". A
     short read takes nothing: a claim made as a request ends is frozen a moment later. */
  const look = await call("GET", `/api/drafting/jobs/${id}`);
  assert.equal(look.status, 200);
  assert.equal(look.data.job.status, "running");
  assert.equal(look.data.job.paused, true);
  assert.ok(look.data.job.pausedSince);
  assert.deepEqual(look.data.job.progress, { next: "draft_blocks", round: 0, sectionsWritten: 1, sectionsTotal: state.sections });
  assert.equal((await stored(id)).lease_token, first.lease_token, "a short read claims nothing");
  assert.equal(await svc.claimNextJob(serviceDb), null, "a background poll leaves a freshly lapsed lease alone: its holder is more likely frozen than gone");

  /* The scholar comes back: the page's status poll, held open, is what gives the instance CPU, and
     the instance it lands on takes the job and resumes it. */
  let after = look.data.job.lastSequence;
  let seen = look.data.job;
  for (let i = 0; i < 40 && !jobLib.isSettled(seen.status); i += 1) {
    const r = await call("GET", `/api/drafting/jobs/${id}?wait=10&after=${after}`);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    seen = r.data.job;
    after = seen.lastSequence;
  }
  assert.equal(seen.status, "published", JSON.stringify(seen.failure));
  assert.equal(seen.paused, false);
  assert.ok(seen.storyId);

  doc = await stored(id);
  assert.notEqual(doc.lease_token, first.lease_token);
  const reclaimed = doc.events.find((e) => e.type === "lease_reclaimed");
  assert.ok(reclaimed, types(doc).join(","));
  assert.equal(reclaimed.data.previousOwner, svc.WORKER_ID);
  const started = doc.events.filter((e) => e.type === "job_started");
  assert.equal(started.length, 2);
  assert.deepEqual(started[1].data.resumed, { next: "draft_blocks", sectionsWritten: 1, sectionsTotal: state.sections });
  assert.ok(doc.events.some((e) => e.type === "progress" && e.data.step === "resume"));
  assert.ok(!doc.events.slice(doc.events.indexOf(started[1])).some((e) => e.type === "progress" && e.data.step === "plan_outline"), "the outline was not planned again");

  /* Nothing finished was done twice: section 1 by the frozen run only, section 2 again because its
     call was in flight, every other as often as in the run never interrupted. */
  await assertNothingWrittenTwice(id, { lostIn: 2 });
  assert.deepEqual(hooks.written, { ...state.baselineWritten, 2: state.baselineWritten[2] + 1 });
  const announced = doc.events.filter((e) => e.type === "progress" && e.data.step === "section_drafted").map((e) => e.data.index);
  assert.deepEqual(announced, Array.from({ length: state.sections }, (_, k) => k + 1), "each section reached the page once, in order");

  /* Nothing finished was lost: the same draft as a run never interrupted. */
  assert.deepEqual(doc.draft.bodyBlocks, state.baseline.bodyBlocks);
  assert.deepEqual(doc.draft.warnings, state.baseline.warnings);
  assert.equal(doc.checkpoint, null);
  const stories = await db.collection("scholar_editorials").find({ "provenance.job_id": doc._id }).toArray();
  assert.equal(stories.length, 1, "one story");
  assert.equal(String(stories[0]._id), String(doc.story_id));
  assert.equal(await db.collection("scholar_editorial_revisions").countDocuments({ story_id: stories[0]._id }), 1);

  /* The frozen run thaws. It holds nothing now, and writes nothing. */
  const before = await stored(id);
  hooks.gate.resolve();
  await staleRun;
  const afterThaw = await stored(id);
  assert.equal(afterThaw.events.length, before.events.length, "no event from the stale run");
  assert.equal(afterThaw.status, "published");
  assert.deepEqual(afterThaw.draft, before.draft);
  assert.equal(await db.collection("scholar_editorials").countDocuments({ "provenance.job_id": doc._id }), 1, "still one story");
  const runs = await db.collection("scholar_draft_runs").find({ job_id: doc._id }).toArray();
  assert.deepEqual(runs.map((r) => r.outcome), ["delivered"], "only the run that finished is on the record");
  assert.deepEqual(runs[0].resumed_from, { next: "draft_blocks", seq: runs[0].resumed_from.seq });
});

/** Read an SSE stream until a `done` frame. */
async function readEvents(p) {
  const res = await fetch(`${base}${p}`, { headers: { Cookie: `sd_session=${cookie}` } });
  assert.equal(res.status, 200);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const frames = [];
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let at;
    while ((at = buffer.indexOf("\n\n")) >= 0) {
      const raw = buffer.slice(0, at);
      buffer = buffer.slice(at + 2);
      if (!raw.trim() || raw.startsWith(":")) continue;
      const frame = {};
      for (const line of raw.split("\n")) {
        const m = line.match(/^(\w+): ?(.*)$/);
        if (m) frame[m[1]] = m[2];
      }
      if (frame.data) { try { frame.data = JSON.parse(frame.data); } catch { /* keep raw */ } }
      frames.push(frame);
      if (frame.event === "done") { await reader.cancel(); return frames; }
    }
  }
  return frames;
}

test("the event stream the page holds open says the draft paused, takes it, and streams it to the end", async () => {
  resetHooks();
  const id = await createJob({ sourceId: "src-e2e-1", audience: "ages_15_18", createStory: false });
  hooks.freezeAt = 2;
  const first = await svc.claimNextJob(serviceDb, { jobId: id });
  const staleRun = svc.runClaimedJob(serviceDb, first);
  await hooks.frozen.promise;
  await jobs().updateOne({ _id: new ObjectId(id) }, { $set: { lease_expires_at: new Date(Date.now() - 1000) } });

  /* The scholar opens the page again; it replays the log and watches. */
  const frames = await readEvents(`/api/drafting/jobs/${id}/events?after=0`);
  const paused = frames.find((f) => f.event === "progress" && f.data.step === "paused");
  assert.ok(paused, frames.map((f) => `${f.event}:${f.data?.step || ""}`).join(","));
  assert.match(paused.data.message, /1 of \d+ sections are written and kept/);
  assert.equal(paused.id, undefined, "said, not logged: it is the stream's reading of the job, not an event in it");
  const after = frames.slice(frames.indexOf(paused));
  assert.ok(after.some((f) => f.event === "lease_reclaimed"), "taken by the instance holding the stream");
  assert.ok(after.some((f) => f.event === "progress" && f.data.step === "resume"));
  const done = frames[frames.length - 1];
  assert.equal(done.event, "done");
  assert.equal(done.data.status, "awaiting_review", JSON.stringify(done.data.failure));
  assert.equal(done.data.paused, false);

  const count = (await stored(id)).events.length;
  hooks.gate.resolve();
  await staleRun;
  assert.equal((await stored(id)).events.length, count, "the thawed run wrote nothing");
  await assertNothingWrittenTwice(id, { lostIn: 2 });
});

test("a model call that fails as a thawed container's would hands the job back; it resumes from its checkpoint after the wait", async () => {
  resetHooks();
  const id = await createJob({ sourceId: "src-e2e-2", createStory: false });
  hooks.failAt = 3;
  await claimAndRun(id);
  let doc = await stored(id);
  assert.equal(doc.status, "queued", "handed back, not failed");
  assert.equal(doc.failure, null);
  assert.equal(doc.lease_token, null);
  assert.ok(doc.not_before > new Date(), "due again after a wait");
  assert.equal(doc.last_interruption.reason, "transient");
  assert.equal(doc.checkpoint.summary.sections_written, 2, "sections 1 and 2 are kept");
  const interrupted = doc.events.find((e) => e.type === "run_interrupted");
  assert.match(interrupted.data.sentence, /picks up from where it stopped/);

  assert.equal(await svc.claimNextJob(serviceDb, { jobId: id }), null, "not claimed before it is due");
  await jobs().updateOne({ _id: doc._id }, { $set: { not_before: new Date(Date.now() - 1) } });
  await claimAndRun(id);
  doc = await stored(id);
  assert.equal(doc.status, "awaiting_review", JSON.stringify(doc.failure));
  await assertNothingWrittenTwice(id, { lostIn: 3 });
  const runs = await db.collection("scholar_draft_runs").find({ job_id: doc._id }).sort({ started_at: 1 }).toArray();
  assert.deepEqual(runs.map((r) => r.outcome), ["interrupted", "delivered"]);
});

test("a shutdown hands the job back at once, and the stopped run writes nothing after it", async () => {
  resetHooks();
  const id = await createJob({ sourceId: "src-e2e-3", createStory: false });
  hooks.freezeAt = 2;
  const claimed = await svc.claimNextJob(serviceDb, { jobId: id });
  const stopped = svc.runClaimedJob(serviceDb, claimed);
  await hooks.frozen.promise;

  assert.equal(await svc.releaseHeldJob("instance_shutdown"), true);
  let doc = await stored(id);
  assert.equal(doc.status, "queued");
  assert.equal(doc.lease_token, null);
  assert.equal(doc.not_before, null, "due at once: no lease to wait out");
  assert.equal(doc.stalled_claims, 0, "a shutdown is not the job's fault");
  assert.equal(doc.events[doc.events.length - 1].data.reason, "instance_shutdown");

  const count = doc.events.length;
  hooks.gate.resolve();
  await stopped;
  doc = await stored(id);
  assert.equal(doc.events.length, count, "the stopped run wrote nothing");
  assert.equal(doc.status, "queued");

  await claimAndRun(id);
  doc = await stored(id);
  assert.equal(doc.status, "awaiting_review", JSON.stringify(doc.failure));
  await assertNothingWrittenTwice(id, { lostIn: 2 });
});

test("a container that took the job and is gone: once its lease has long lapsed, any worker's background poll takes the job and finishes it", async () => {
  resetHooks();
  const id = await createJob({ sourceId: "src-e2e-2", createStory: true });
  const lost = await svc.claimNextJob(serviceDb, { jobId: id });
  assert.ok(lost, "claimed, and then the container was taken away before it wrote anything");
  await jobs().updateOne({ _id: new ObjectId(id) }, { $set: { lease_expires_at: new Date(Date.now() - jobLib.RECLAIM_IDLE_MS - 1000) } });
  const taken = await svc.claimNextJob(serviceDb);
  assert.equal(String(taken?._id), id);
  assert.equal(taken.claimed_from.status, "running");
  await svc.runClaimedJob(serviceDb, taken);
  const doc = await stored(id);
  assert.equal(doc.status, "published", JSON.stringify(doc.failure));
  assert.ok(doc.events.some((e) => e.type === "lease_reclaimed"));
  assert.equal(await db.collection("scholar_editorials").countDocuments({ "provenance.job_id": doc._id }), 1);
  await assertNothingWrittenTwice(id);
});

test("a job claimed again and again without getting further fails with a sentence, not a loop", async () => {
  resetHooks();
  const id = await createJob({ sourceId: "src-e2e-3", createStory: true });
  await jobs().updateOne({ _id: new ObjectId(id) }, { $set: { stalled_claims: jobLib.MAX_STALLED_CLAIMS } });
  await claimAndRun(id);
  const doc = await stored(id);
  assert.equal(doc.status, "failed");
  assert.match(doc.failure.sentence, /interrupted several times in a row/);
  assert.deepEqual(hooks.written, {}, "no model was called");
});
