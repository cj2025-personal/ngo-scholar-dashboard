/**
 * The whole path a scholar's click takes, against a throwaway database.
 *
 * ── What runs ───────────────────────────────────────────────────────────────
 * An in-memory MongoDB, seeded with one Legacy scholar, their credential and
 * session, and one licensed paper. The real API process, started as a child
 * with LLM_PROVIDER=fake so the model answers from the passages it is given.
 * Then HTTP, as the composer would send it: inventory, draft job, event
 * stream, save with provenance, edit past traceability, publish, public read.
 *
 * Nothing here touches a real database or a real model, and nothing here
 * stubs the service under test. What passes here is what a scholar would
 * get, minus the prose.
 *
 *   npm run test:e2e
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("child_process");
const crypto = require("crypto");
const path = require("path");

const { MongoClient } = require("mongodb");
const { MongoMemoryServer } = require("mongodb-memory-server");

const API_DIR = path.resolve(__dirname, "..");
const DB_NAME = "sd_e2e";
const { PROFILE_ID, EMAIL, seedScholar } = require("./seed");

const PAPER = [
  "Adaptive antenna arrays reduce interference by steering nulls toward unwanted sources. The method updates weights with a least-mean-squares rule every two milliseconds, which is fast enough for fixed interferers. Four patch elements were spaced at half a wavelength.",
  "In field trials the array improved the signal-to-noise ratio by eleven decibels with one interferer and by seven with two. The desired signal arrived at broadside in every trial, which is the easiest case for the array. Convergence took between forty and three hundred updates.",
  "The authors note that performance degrades when more than four interferers are present, because the array has only three degrees of freedom left once one is spent on the desired direction. In seventeen of forty trials the array reduced desired-signal gain by more than two decibels.",
  "All trials were run in an anechoic chamber. Multipath in a real building would present many more apparent sources, so the degradation is expected to appear at lower interferer counts outdoors. The array was not tested with moving interferers.",
  "Future work should test a six- or eight-element array under multipath and with moving sources. A larger step size converged faster but oscillated in the two-interferer geometry.",
  "The weight update runs on a small digital signal processor mounted behind the array. Each update reads four complex samples, forms the error against a reference tone, and adjusts the weights by a fraction of that error. The processor spends most of its time waiting for samples, so a faster update rate is possible if the geometry demands it.",
  "Power consumption was measured at 1.8 watts for the processor and 0.6 watts for the four low-noise amplifiers. That is within the budget of a battery-powered sensor node for about nine hours, which the authors consider adequate for the field trials described but not for a permanent installation.",
  "Two of the forty trials in the four-interferer geometry were repeated after a cable fault was found. The repeated trials produced results within one decibel of the originals, and the originals were kept in the analysis.",
].join("\n\n");

let mongod;
let client;
let db;
let api;
let base;
let cookie;
let systemCookie;
const state = {};

const sha = (t) => crypto.createHash("sha256").update(t).digest("hex");

async function startApi(extraEnv = {}) {
  const port = 41000 + Math.floor(Math.random() * 2000);
  /* The test runner marks its own children; the API must not inherit that
     mark or Node runs it as a test file and swallows its output. */
  const inherited = { ...process.env };
  delete inherited.NODE_TEST_CONTEXT;
  delete inherited.NODE_OPTIONS;
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: API_DIR,
    env: {
      ...inherited,
      NODE_ENV: "test",
      PORT: String(port),
      MONGODB_URI: mongod.getUri(),
      MONGODB_DB: DB_NAME,
      LLM_PROVIDER: "fake",
      DRAFTING_POLL_MS: "150",
      DRAFT_DAILY_CAP: "3",
      CORS_ORIGIN: "http://localhost:3000",
      GCP_PROJECT_ID: "",
      GCP_SERVICE_ACCOUNT_JSON: "",
      GCP_SERVICE_ACCOUNT_KEY_FILE: "",
      GOOGLE_APPLICATION_CREDENTIALS: "",
      LANGSMITH_API_KEY: "",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (d) => { log += d; });
  child.stderr.on("data", (d) => { log += d; });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i += 1) {
    try {
      const r = await fetch(`${url}/health`);
      if (r.status === 200) return { child, url, log: () => log };
    } catch { /* not up yet */ }
    if (child.exitCode !== null) throw new Error(`api exited early:\n${log}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`api did not come up:\n${log}`);
}

const call = async (method, p, { body, form, cookieValue = cookie, headers = {} } = {}) => {
  const init = { method, headers: { Cookie: `sd_session=${cookieValue}`, ...headers } };
  if (form) init.body = form;
  else if (body !== undefined) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
  const res = await fetch(`${base}${p}`, init);
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  return { status: res.status, data };
};

/** Read an SSE stream until a `done` frame. */
async function readEvents(p) {
  const res = await fetch(`${base}${p}`, { headers: { Cookie: `sd_session=${cookie}` } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /text\/event-stream/);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const frames = [];
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (!raw.trim() || raw.startsWith(":")) continue;
      const frame = {};
      for (const line of raw.split("\n")) {
        const m = line.match(/^(\w+): ?(.*)$/);
        if (m) frame[m[1]] = m[2];
      }
      if (frame.data) { try { frame.data = JSON.parse(frame.data); } catch { /* keep raw */ } }
      frames.push(frame);
      if (frame.event === "done") return frames;
    }
  }
  return frames;
}

async function seed(dbName) {
  return seedScholar(client.db(dbName));
}

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongod.getUri());
  db = client.db(DB_NAME);
  const tokens = await seed(DB_NAME);
  cookie = tokens.token;
  systemCookie = tokens.systemToken;
  api = await startApi();
  base = api.url;
});

test.after(async () => {
  if (api?.child && api.child.exitCode === null) api.child.kill();
  if (client) await client.close();
  if (mongod) await mongod.stop();
});

test("health reports the database", async () => {
  const r = await fetch(`${base}/health`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { status: "ok", db: "ok" });
});

test("the inventory shows what may be drafted from, and refuses an unauthenticated caller", async () => {
  const anon = await fetch(`${base}/api/drafting/sources`);
  assert.equal(anon.status, 401);

  const { status, data } = await call("GET", "/api/drafting/sources");
  assert.equal(status, 200);
  assert.equal(data.eligible, true);
  assert.equal(data.rollout, "all");
  assert.equal(data.counts.draftable, 3);
  assert.equal(data.counts.citable, 1);
  assert.equal(data.nudge, null);
  assert.ok(data.draftable.every((s) => s.use === "draftable" && s.origin === "harvested"));
  state.source = data.draftable.find((s) => s.id === "src-e2e-1");
  assert.equal(state.source.title, "Adaptive nulling in small antenna arrays");
});

test("a quotable-only source is refused as a draft job with the panel's own sentence", async () => {
  const { status, data } = await call("POST", "/api/drafting/jobs", { body: { origin: "harvested", sourceId: "src-e2e-q", audience: "general" } });
  assert.equal(status, 403);
  assert.match(data.error, /short quotes only/);
});

test("a draft job is created, streamed to completion, and parked for review", async () => {
  const created = await call("POST", "/api/drafting/jobs", { body: { origin: "harvested", sourceId: "src-e2e-1", audience: "general" } });
  assert.equal(created.status, 202, JSON.stringify(created.data));
  assert.equal(created.data.reused, false);
  const job = created.data.job;
  assert.equal(job.status, "queued");
  state.jobId = job.id;

  const frames = await readEvents(`/api/drafting/jobs/${job.id}/events`);
  const types = frames.map((f) => f.event);
  assert.ok(types.includes("job_created"), types.join(","));
  assert.ok(types.includes("job_started"));
  assert.ok(types.includes("progress"));
  assert.ok(types.includes("draft_ready"));
  assert.equal(types[types.length - 1], "done");
  const steps = frames.filter((f) => f.event === "progress").map((f) => f.data.step);
  for (const s of ["pick_source", "plan_outline", "draft_blocks", "judge_fidelity", "assemble", "verify"]) assert.ok(steps.includes(s), `missing step ${s} in ${steps.join(",")}`);
  const ids = frames.filter((f) => f.id).map((f) => Number(f.id));
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b), "event ids are sequenced");

  const done = frames[frames.length - 1].data;
  assert.equal(done.status, "awaiting_review");
  assert.ok(done.draft && done.draft.bodyBlocks.length >= 4);
  assert.ok(done.draft.title.startsWith("What the paper found"));
  const paragraphs = done.draft.bodyBlocks.filter((b) => b.type === "paragraph");
  assert.ok(paragraphs.length >= 2);
  assert.ok(paragraphs.every((b) => b.sourceRefs.length >= 1 && b.fidelity.verdict === "supported"));
  assert.ok(done.draft.readability && typeof done.draft.readability.fkGrade === "number");
  assert.ok(done.tokens.input > 0);
  state.draft = done.draft;

  const stored = await db.collection("scholar_draft_jobs").findOne({ _id: new (require("mongodb").ObjectId)(job.id) });
  assert.equal(stored.status, "awaiting_review");
  assert.equal(stored.lease_owner, null, "the lease is released when the run ends");
  const runs = await db.collection("scholar_draft_runs").find({ job_id: stored._id }).toArray();
  assert.equal(runs.length, 1);
  assert.equal(runs[0].outcome, "delivered");
  assert.ok(runs[0].calls.length >= 4);
});

test("the same request again is the same job, not a second bill", async () => {
  const again = await call("POST", "/api/drafting/jobs", { body: { origin: "harvested", sourceId: "src-e2e-1", audience: "general" } });
  assert.equal(again.status, 200);
  assert.equal(again.data.reused, true);
  assert.equal(again.data.job.id, state.jobId);
  assert.equal(again.data.job.status, "awaiting_review");

  const replay = await readEvents(`/api/drafting/jobs/${state.jobId}/events?after=0`);
  assert.equal(replay[replay.length - 1].event, "done", "a settled job streams its log and closes");
});

test("saving the draft into a story stores provenance, links the job, and returns chips", async () => {
  const form = new FormData();
  form.set("title", state.draft.title);
  form.set("subtitle", state.draft.subtitle);
  form.set("excerpt", state.draft.excerpt);
  const serialized = state.draft.bodyBlocks.map((b) => (b.type === "image" ? b : {
    type: b.type, html: b.html,
    ...(b.sourceRefs?.length ? { sourceRefs: b.sourceRefs, draftedText: b.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(), fidelity: b.fidelity || null } : {}),
  }));
  form.set("bodyBlocks", JSON.stringify(serialized));
  form.set("content", serialized.filter((b) => b.type !== "image").map((b) => b.html).join("\n\n"));
  form.set("inlineImageKeys", "[]");
  form.set("status", "draft");
  form.set("retainImageIds", "[]");
  form.set("draftJobId", state.jobId);

  const saved = await call("POST", "/api/editorial-stories", { form });
  assert.equal(saved.status, 201, JSON.stringify(saved.data));
  const story = saved.data.story;
  state.storyId = story.id;
  state.slug = story.slug;
  assert.equal(story.status, "draft");

  const read = await call("GET", `/api/editorial-stories/${story.id}`);
  assert.equal(read.status, 200);
  const s = read.data.story;
  assert.equal(s.author.name, "Test Scholar");
  assert.equal(s.provenance.sourceId, "src-e2e-1");
  assert.equal(s.provenance.line, "Drawn from the author's research: Adaptive nulling in small antenna arrays (2024)".replace(" (2024)", ""), "no year on the seeded source, so no year in the line");
  assert.equal(s.provenance.url, "https://pmc.example/src-e2e-1");
  const drafted = s.bodyBlocks.filter((b) => b.sourceRefs);
  assert.ok(drafted.length >= 2);
  assert.ok(drafted.every((b) => b.traceable === true && b.overlap >= 0.99));
  state.firstDrafted = drafted[0];

  const job = await db.collection("scholar_draft_jobs").findOne({ idempotency_key: { $exists: true } });
  assert.equal(job.status, "published");
  assert.equal(String(job.story_id), story.id);
  assert.equal(job.events[job.events.length - 1].type, "draft_taken_into_story");
});

test("editing a block past its source drops the chip; a light edit keeps it", async () => {
  const read = await call("GET", `/api/editorial-stories/${state.storyId}`);
  const blocks = read.data.story.bodyBlocks;
  const i = blocks.findIndex((b) => b.sourceRefs);
  const edited = blocks.map((b, k) => {
    const base = { type: b.type, html: b.html, ...(b.sourceRefs ? { sourceRefs: b.sourceRefs, draftedText: b.draftedText, fidelity: b.fidelity } : {}) };
    if (k === i) base.html = "An entirely new paragraph the scholar wrote from scratch about something else altogether, sharing no words.";
    if (k === i + 1 && b.sourceRefs) base.html = `${b.html} Lightly edited.`;
    return base;
  });
  const form = new FormData();
  form.set("bodyBlocks", JSON.stringify(edited));
  form.set("content", edited.map((b) => b.html).join("\n\n"));
  form.set("inlineImageKeys", "[]");
  form.set("retainImageIds", "[]");
  form.set("status", "draft");
  const patched = await call("PATCH", `/api/editorial-stories/${state.storyId}`, { form });
  assert.equal(patched.status, 200, JSON.stringify(patched.data));
  const after = patched.data.story.bodyBlocks;
  assert.equal(after[i].traceable, false);
  assert.match(after[i].traceReason, /edited beyond its source/);
  assert.deepEqual(after[i].sourceRefs, blocks[i].sourceRefs, "the refs stay stored; nothing is claimed for the block");
  if (blocks[i + 1]?.sourceRefs) assert.equal(after[i + 1].traceable, true);
});

test("a machine identity cannot publish; a person can, and is recorded", async () => {
  const form = () => { const f = new FormData(); f.set("status", "published"); f.set("inlineImageKeys", "[]"); f.set("retainImageIds", "[]"); return f; };

  /* The system actor owns no story, so first prove the guard on its own story. */
  const own = new FormData();
  own.set("title", "By a machine"); own.set("content", "Some text."); own.set("bodyBlocks", JSON.stringify([{ type: "paragraph", html: "Some text." }]));
  own.set("inlineImageKeys", "[]"); own.set("retainImageIds", "[]"); own.set("status", "published");
  const refused = await call("POST", "/api/editorial-stories", { form: own, cookieValue: systemCookie });
  assert.equal(refused.status, 403);
  assert.match(refused.data.error, /service identity, not a person/);

  const published = await call("PATCH", `/api/editorial-stories/${state.storyId}`, { form: form() });
  assert.equal(published.status, 200, JSON.stringify(published.data));
  assert.equal(published.data.story.status, "published");
  assert.equal(published.data.story.publicUrl, `/stories/${state.slug}`);
  const stored = await db.collection("scholar_editorials").findOne({ slug: state.slug });
  assert.equal(stored.published_by, EMAIL);
  assert.equal(stored.provenance.source_id, "src-e2e-1");
});

test("the public reads the story with its byline and its source line, and never a draft", async () => {
  const pub = await fetch(`${base}/api/editorial-stories/public/slug/${state.slug}`);
  assert.equal(pub.status, 200);
  const { story } = await pub.json();
  assert.equal(story.author.name, "Test Scholar");
  assert.match(story.provenance.line, /^Drawn from the author's research: Adaptive nulling/);
  assert.ok(story.bodyBlocks.length >= 4);

  const missing = await fetch(`${base}/api/editorial-stories/public/slug/does-not-exist`);
  assert.equal(missing.status, 404);
});

test("the daily cap holds, and a failed draft says something the scholar can act on", async () => {
  const second = await call("POST", "/api/drafting/jobs", { body: { origin: "harvested", sourceId: "src-e2e-2", audience: "students" } });
  assert.equal(second.status, 202);
  await readEvents(`/api/drafting/jobs/${second.data.job.id}/events`);
  const third = await call("POST", "/api/drafting/jobs", { body: { origin: "harvested", sourceId: "src-e2e-3", audience: "general" } });
  assert.equal(third.status, 202);
  await readEvents(`/api/drafting/jobs/${third.data.job.id}/events`);
  const fourth = await call("POST", "/api/drafting/jobs", { body: { origin: "harvested", sourceId: "src-e2e-3", audience: "students" } });
  assert.equal(fourth.status, 429);
  assert.match(fourth.data.error, /daily limit is 3/);

  /* Discard the third so the list shows a scholar's choice, not only the machine's. */
  const discarded = await call("POST", `/api/drafting/jobs/${third.data.job.id}/resume`, { body: { action: "discard" } });
  assert.equal(discarded.status, 200);
  assert.equal(discarded.data.job.status, "discarded");
  const again = await call("POST", `/api/drafting/jobs/${third.data.job.id}/resume`, { body: { action: "publish", storyId: state.storyId } });
  assert.equal(again.status, 409, "a discarded job cannot be published");

  const list = await call("GET", "/api/drafting/jobs");
  assert.equal(list.status, 200);
  assert.deepEqual(list.data.jobs.map((j) => j.status).sort(), ["awaiting_review", "discarded", "published"]);
});

test("a first-person draft is refused end to end, with a sentence", async () => {
  /* Its own database: a second worker on the shared one would race the
     first instance for the job (the lease is designed for exactly that), and
     the clean worker would win. */
  const voiceTokens = await seed("sd_e2e_voice");
  const bad = await startApi({ FAKE_MODEL_FIRST_PERSON: "1", DRAFT_DAILY_CAP: "10", MONGODB_DB: "sd_e2e_voice" });
  const prev = base;
  const prevCookie = cookie;
  base = bad.url;
  cookie = voiceTokens.token;
  try {
    const created = await call("POST", "/api/drafting/jobs", { body: { origin: "harvested", sourceId: "src-e2e-3", audience: "general" } });
    assert.equal(created.status, 202, JSON.stringify(created.data));
    const frames = await readEvents(`/api/drafting/jobs/${created.data.job.id}/events`);
    const done = frames[frames.length - 1].data;
    assert.equal(done.status, "failed");
    assert.match(done.failure.sentence, /about you/);
    assert.ok(frames.some((f) => f.event === "job_failed"));
  } finally {
    base = prev;
    cookie = prevCookie;
    bad.child.kill();
  }
});

test("in pilot mode a scholar outside the list sees the inventory but cannot draft", async () => {
  const pilot = await startApi({ DRAFTING_ROLLOUT: "pilot", DRAFTING_PILOT_PROFILES: "someone-else" });
  const prev = base;
  base = pilot.url;
  try {
    const { status, data } = await call("GET", "/api/drafting/sources");
    assert.equal(status, 200);
    assert.equal(data.eligible, false);
    assert.equal(data.rollout, "pilot");
    assert.match(data.gateReason, /rolled out gradually/);
    assert.equal(data.counts.draftable, 3, "the inventory is still shown");
    const refused = await call("POST", "/api/drafting/jobs", { body: { origin: "harvested", sourceId: "src-e2e-1", audience: "general" } });
    assert.equal(refused.status, 403);
  } finally {
    base = prev;
    pilot.child.kill();
  }
});
