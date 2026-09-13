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

const { MongoClient, ObjectId } = require("mongodb");
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
      DRAFT_DAILY_CAP: "4",
      DRAFTING_IMAGES: "true",
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
  const { status, data } = await call("POST", "/api/drafting/jobs", { body: { origin: "harvested", sourceId: "src-e2e-q", audience: "general", createStory: false } });
  assert.equal(status, 403);
  assert.match(data.error, /short quotes only/);
});

test("a draft job is created, streamed to completion, and parked for review", async () => {
  const created = await call("POST", "/api/drafting/jobs", { body: { origin: "harvested", sourceId: "src-e2e-1", audience: "general", createStory: false } });
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
  const again = await call("POST", "/api/drafting/jobs", { body: { origin: "harvested", sourceId: "src-e2e-1", audience: "general", createStory: false } });
  assert.equal(again.status, 200);
  assert.equal(again.data.reused, true);
  assert.equal(again.data.job.id, state.jobId);
  assert.equal(again.data.job.status, "awaiting_review");

  const replay = await readEvents(`/api/drafting/jobs/${state.jobId}/events?after=0`);
  assert.equal(replay[replay.length - 1].event, "done", "a settled job streams its log and closes");
});

test("with outline approval the job pauses, the scholar cuts a section, and the draft becomes a story", async () => {
  const created = await call("POST", "/api/drafting/jobs", { body: { origin: "harvested", sourceId: "src-e2e-2", audience: "ages_15_18", brief: "focus on the limitations", approveOutline: true } });
  assert.equal(created.status, 202, JSON.stringify(created.data));
  const jobId = created.data.job.id;
  assert.equal(created.data.job.approveOutline, true);
  assert.equal(created.data.job.brief, "focus on the limitations");

  const frames = await readEvents(`/api/drafting/jobs/${jobId}/events`);
  const paused = frames[frames.length - 1].data;
  assert.equal(paused.status, "awaiting_outline");
  assert.ok(frames.some((f) => f.event === "outline_ready"));
  assert.ok(paused.outline && paused.outline.beats.length >= 2, JSON.stringify(paused.outline));
  assert.ok(paused.passages.length >= 4, "the passage list is on the job for the outline screen");
  assert.equal(paused.draft, null, "no prose yet");

  /* A follow-up instead of an approval: the outline is replanned from it. */
  const empty = await call("POST", `/api/drafting/jobs/${jobId}/replan`, { body: { instruction: "  " } });
  assert.equal(empty.status, 400, "a follow-up has to say something");
  const replan = await call("POST", `/api/drafting/jobs/${jobId}/replan`, { body: { instruction: "lead with the limitations and keep it to three sections" } });
  assert.equal(replan.status, 202, JSON.stringify(replan.data));
  assert.equal(replan.data.job.status, "queued");
  assert.match(replan.data.job.brief, /^focus on the limitations\nThen the scholar asked: lead with the limitations/);
  assert.equal(replan.data.job.replans, 1);
  assert.equal(replan.data.job.outline, null, "the old outline is gone until the new one lands");
  const framesR = await readEvents(`/api/drafting/jobs/${jobId}/events?after=${Number(frames.filter((f) => f.id).pop().id)}`);
  const paused2 = framesR[framesR.length - 1].data;
  assert.equal(paused2.status, "awaiting_outline", "back with a new outline");
  assert.ok(framesR.some((f) => f.event === "outline_replanned"), "the follow-up is on the record");
  assert.ok(framesR.some((f) => f.event === "outline_ready"));
  assert.ok(paused2.outline && paused2.outline.beats.length >= 2, JSON.stringify(paused2.outline));

  /* The scholar cuts the last section and renames the first. */
  const beats = paused2.outline.beats.slice(0, -1).map((b, i) => ({ ...b, heading: i === 0 ? "Opening, renamed" : b.heading }));
  const bad = await call("POST", `/api/drafting/jobs/${jobId}/outline`, { body: { outline: { beats: [{ heading: "x", passageIds: ["p999"] }] } } });
  assert.equal(bad.status, 400, "an outline that cites no real passage is refused");
  const approved = await call("POST", `/api/drafting/jobs/${jobId}/outline`, { body: { outline: { title: paused2.outline.title, deck: paused2.outline.deck, beats } } });
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  assert.equal(approved.data.job.status, "queued");
  assert.equal(approved.data.job.outlineApproved.beats.length, beats.length);
  const twice = await call("POST", `/api/drafting/jobs/${jobId}/outline`, { body: {} });
  assert.equal(twice.status, 409, "an outline is approved once");
  const late = await call("POST", `/api/drafting/jobs/${jobId}/replan`, { body: { instruction: "too late" } });
  assert.equal(late.status, 409, "an approved outline cannot be replanned");

  const lastId = Number(framesR.filter((f) => f.id).pop().id);
  const frames2 = await readEvents(`/api/drafting/jobs/${jobId}/events?after=${lastId}`);
  const done = frames2[frames2.length - 1].data;
  assert.equal(done.status, "published", "taken into a story by the worker");
  assert.ok(done.storyId, "the story id is on the job");
  assert.ok(frames2.some((f) => f.event === "progress" && f.data.step === "plan_outline" && f.data.approved === true), "the approved outline was used, not replanned");
  assert.ok(frames2.some((f) => f.event === "progress" && f.data.step === "create_story"));

  const story = (await call("GET", `/api/editorial-stories/${done.storyId}`)).data.story;
  assert.equal(story.status, "draft");
  assert.equal(story.bodyBlocks.filter((b) => b.type === "subheading").length, beats.length, "one heading per approved section, the cut one gone");
  assert.ok(story.bodyBlocks.some((b) => b.type === "subheading" && b.html === "Opening, renamed"));
  assert.equal(story.provenance.sourceId, "src-e2e-2");
  assert.equal(story.provenance.audience, "ages_15_18");
  assert.ok(story.bodyBlocks.filter((b) => b.type === "paragraph").every((b) => b.traceable === true && b.sourceRefs.length >= 1 && b.fidelity.verdict === "supported"));
  const stored = await db.collection("scholar_editorials").findOne({ slug: story.slug });
  assert.equal(stored.published_by, null, "the machine did not publish");
  assert.match(stored.created_by, /^drafter:/);

  const passages = await call("GET", `/api/editorial-stories/${done.storyId}/passages`);
  assert.equal(passages.status, 200);
  assert.equal(passages.data.passages[0].id, "p1");
  state.outlineStoryId = done.storyId;
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

  const job = await db.collection("scholar_draft_jobs").findOne({ _id: new ObjectId(state.jobId) });
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

  /* The Sources toggle: the passages behind a published story, with no session. */
  const passages = await fetch(`${base}/api/editorial-stories/public/slug/${state.slug}/passages`);
  assert.equal(passages.status, 200);
  const { passages: list } = await passages.json();
  assert.ok(list.length >= 4);
  assert.equal(list[0].id, "p1");
  assert.match(list[0].text, /Adaptive antenna arrays/);
});

test("the scholar edits by instruction: a proposal with checks, accepted onto the story", async () => {
  const before = (await call("GET", `/api/editorial-stories/${state.storyId}`)).data.story;
  const paragraphs = before.bodyBlocks.map((b, i) => ({ b, n: i + 1 })).filter(({ b }) => b.type === "paragraph");
  const target = paragraphs[1] || paragraphs[0];

  const asked = await call("POST", `/api/editorial-stories/${state.storyId}/agent`, { body: { instruction: `shorten paragraph ${target.n}` } });
  assert.equal(asked.status, 200, JSON.stringify(asked.data));
  const turn = asked.data.turn;
  assert.equal(turn.status, "proposed");
  assert.ok(turn.summary.length > 0);
  assert.ok(turn.calls.some((c) => c.name === "replace_block" && /^ok/.test(c.result)), JSON.stringify(turn.calls));
  assert.equal(turn.changes.length, 1);
  assert.equal(turn.changes[0].kind, "changed");
  assert.equal(turn.changes[0].index, target.n);
  assert.equal(turn.checks.paragraphsChanged, 1);
  assert.equal(turn.checks.supported, 1, "the fact-checker judged the changed paragraph");
  assert.ok(turn.proposal.blocks.length === before.bodyBlocks.length);
  const untouched = turn.proposal.blocks.filter((b, i) => b.type !== "image" && i + 1 !== target.n);
  assert.ok(untouched.every((b, k) => b.html === before.bodyBlocks.filter((x, i) => x.type !== "image" && i + 1 !== target.n)[k].html), "untouched blocks are byte-identical");

  const stillBefore = (await call("GET", `/api/editorial-stories/${state.storyId}`)).data.story;
  assert.equal(stillBefore.bodyBlocks[target.n - 1].html, before.bodyBlocks[target.n - 1].html, "nothing changes until accepted");

  const accepted = await call("POST", `/api/editorial-stories/${state.storyId}/agent/turns/${turn.id}/accept`, { body: {} });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
  assert.equal(accepted.data.turn.status, "accepted");
  const after = accepted.data.story;
  assert.equal(after.bodyBlocks[target.n - 1].html, turn.proposal.blocks[target.n - 1].html);
  assert.ok(after.bodyBlocks[target.n - 1].sourceRefs.length >= 1, "the rewritten block keeps a citation");
  assert.equal(after.bodyBlocks[target.n - 1].traceable, true, "its own text is the new baseline for the chip");
  assert.equal(after.bodyBlocks[target.n - 1].fidelity.verdict, "supported");

  const again = await call("POST", `/api/editorial-stories/${state.storyId}/agent/turns/${turn.id}/accept`, { body: {} });
  assert.equal(again.status, 409, "a proposal is applied once");
  const list = await call("GET", `/api/editorial-stories/${state.storyId}/agent/turns`);
  assert.equal(list.data.turns[0].status, "accepted");
  assert.equal(list.data.turns[0].proposal, undefined, "resolved turns do not carry their proposal");
});

test("the agent adds an illustration by instruction; rejecting discards the generated image", async () => {
  const asked = await call("POST", `/api/editorial-stories/${state.storyId}/agent`, { body: { instruction: "add an illustration of a four-element antenna array on a mast after paragraph 1" } });
  assert.equal(asked.status, 200, JSON.stringify(asked.data));
  const turn = asked.data.turn;
  assert.ok(turn.calls.some((c) => c.name === "add_image" && /^ok/.test(c.result)), JSON.stringify(turn.calls));
  assert.equal(turn.checks.imagesGenerated, 1);
  const img = turn.proposal.blocks.find((b) => b.type === "image" && b.generated);
  assert.ok(img && img.imageId && img.url, "the illustration was generated and uploaded as an inline image");
  assert.match(img.caption, /^Illustration:/, "labelled as an illustration, never as a figure");
  const served = await fetch(`${base}${img.url}`, { headers: { Cookie: `sd_session=${cookie}` } });
  assert.equal(served.status, 200);
  assert.match(served.headers.get("content-type") || "", /image\/png/);

  const rejected = await call("POST", `/api/editorial-stories/${state.storyId}/agent/turns/${turn.id}/reject`, { body: {} });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.data.turn.status, "rejected");
  const asset = await db.collection("editorial_story_images").findOne({ _id: new (require("mongodb").ObjectId)(img.imageId) });
  assert.equal(asset.status, "deleted", "a rejected illustration is deleted");
  const story = (await call("GET", `/api/editorial-stories/${state.storyId}`)).data.story;
  assert.ok(!story.bodyBlocks.some((b) => b.type === "image"), "the story never received the image");
});

test("the agent refuses first person and a stale proposal cannot be applied", async () => {
  const asked = await call("POST", `/api/editorial-stories/${state.storyId}/agent`, { body: { instruction: "rewrite it as me, in the first person" } });
  assert.equal(asked.status, 200, JSON.stringify(asked.data));
  assert.ok(asked.data.turn.calls.some((c) => /first-person/.test(c.result)), JSON.stringify(asked.data.turn.calls));
  assert.equal(asked.data.turn.changes.length, 0);
  assert.match(asked.data.turn.summary, /refused/);

  const proposal = await call("POST", `/api/editorial-stories/${state.storyId}/agent`, { body: { instruction: "delete paragraph 2" } });
  assert.equal(proposal.status, 200);
  const form = new FormData();
  form.set("subtitle", "Edited by hand in between");
  form.set("inlineImageKeys", "[]"); form.set("retainImageIds", "[]"); form.set("status", "published");
  const edited = await call("PATCH", `/api/editorial-stories/${state.storyId}`, { form });
  assert.equal(edited.status, 200);
  const stale = await call("POST", `/api/editorial-stories/${state.storyId}/agent/turns/${proposal.data.turn.id}/accept`, { body: {} });
  assert.equal(stale.status, 409);
  assert.match(stale.data.error, /changed after this proposal/);
});

test("a stale save is refused rather than overwriting, and an earlier version can be put back", async () => {
  const read = await call("GET", `/api/editorial-stories/${state.storyId}`);
  const story = read.data.story;
  assert.ok(Number.isInteger(story.version) && story.version >= 1, `the story carries a version: ${story.version}`);
  const startedAt = story.version;

  const save = (baseVersion, title) => {
    const f = new FormData();
    f.set("title", title);
    f.set("inlineImageKeys", "[]");
    f.set("retainImageIds", "[]");
    f.set("status", story.status);
    if (baseVersion !== null) f.set("baseVersion", String(baseVersion));
    return call("PATCH", `/api/editorial-stories/${state.storyId}`, { form: f });
  };

  /* A save made against the version the editor was reading lands. */
  const first = await save(startedAt, "Edited by the scholar");
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.equal(first.data.story.version, startedAt + 1);
  assert.equal(first.data.story.title, "Edited by the scholar");

  /* The same save again, from an editor that never reloaded, is refused
     instead of quietly erasing the version that landed in between. */
  const stale = await save(startedAt, "Written from a stale tab");
  assert.equal(stale.status, 409, JSON.stringify(stale.data));
  assert.match(stale.data.error, /changed/);
  assert.match(stale.data.error, new RegExp(`version ${startedAt + 1}`));
  const unchanged = await call("GET", `/api/editorial-stories/${state.storyId}`);
  assert.equal(unchanged.data.story.title, "Edited by the scholar", "the stale save wrote nothing");
  assert.equal(unchanged.data.story.version, startedAt + 1);

  /* A malformed claim is refused outright rather than silently unguarded. */
  const nonsense = await save("not-a-version", "x");
  assert.equal(nonsense.status, 400, JSON.stringify(nonsense.data));

  /* The history holds every version, with the machine's draft at version 1. */
  const history = await call("GET", `/api/editorial-stories/${state.storyId}/revisions`);
  assert.equal(history.status, 200, JSON.stringify(history.data));
  const versions = history.data.revisions;
  assert.ok(versions.length >= 2, JSON.stringify(versions.map((v) => v.version)));
  assert.equal(history.data.version, startedAt + 1);
  const first_ = versions.find((v) => v.version === 1);
  assert.ok(first_, "version 1 is kept");
  assert.equal(first_.source, "scholar", "a person saved this story, even though a job wrote the words");
  assert.equal(first_.createdBy, EMAIL);
  assert.ok(versions.some((v) => v.source === "agent"), "the agent's accepted change is on the record");
  assert.ok(versions.every((v) => v.words >= 0 && !("body_blocks" in v)), "a listing carries no bodies");

  /* Putting version 1 back is itself a new version, so the restore can be undone. */
  const restored = await call("POST", `/api/editorial-stories/${state.storyId}/revisions/1/restore`, { body: { baseVersion: startedAt + 1 } });
  assert.equal(restored.status, 200, JSON.stringify(restored.data));
  assert.equal(restored.data.restoredFrom, 1);
  assert.equal(restored.data.version, startedAt + 2);
  assert.equal(restored.data.story.version, startedAt + 2);
  assert.match(restored.data.story.title, /^What the paper found/, "the machine's title is back");

  const afterRestore = await call("GET", `/api/editorial-stories/${state.storyId}/revisions`);
  assert.ok(afterRestore.data.revisions.some((v) => v.source === "restore" && /Restored version 1/.test(v.note || "")));

  /* A version that was never kept cannot be restored. */
  const missing = await call("POST", `/api/editorial-stories/${state.storyId}/revisions/9999/restore`, { body: {} });
  assert.equal(missing.status, 404);
});

test("the scholar deletes a draft and a published story: gone from every read, and only the owner can", async () => {
  const draftId = state.outlineStoryId;
  const anon = await call("DELETE", `/api/editorial-stories/${draftId}`, { cookieValue: "nope" });
  assert.equal(anon.status, 401);
  const gone = await call("DELETE", `/api/editorial-stories/${draftId}`);
  assert.equal(gone.status, 200, JSON.stringify(gone.data));
  assert.equal(gone.data.previousStatus, "draft");
  assert.equal((await call("GET", `/api/editorial-stories/${draftId}`)).status, 404, "not readable by its owner");
  assert.equal((await call("DELETE", `/api/editorial-stories/${draftId}`)).status, 404, "deleting twice is a miss");
  assert.equal((await call("POST", `/api/editorial-stories/${draftId}/agent`, { body: { instruction: "shorten paragraph 2" } })).status, 404, "the agent cannot touch it");
  const list = await call("GET", "/api/editorial-stories?status=all");
  assert.ok(!list.data.stories.some((s) => s.id === draftId), "not listed");
  const row = await db.collection("scholar_editorials").findOne({ _id: new ObjectId(draftId) });
  assert.equal(row.status, "deleted");
  assert.ok(row.deleted_at instanceof Date);
  assert.equal(row.deleted_by, EMAIL);

  /* The published one: off the public site the moment it is deleted. */
  const live = (await call("GET", `/api/editorial-stories/${state.storyId}`)).data.story;
  assert.equal(live.status, "published");
  assert.equal((await call("GET", `/api/editorial-stories/public/slug/${live.slug}`, { cookieValue: "" })).status, 200);
  const removed = await call("DELETE", `/api/editorial-stories/${state.storyId}`);
  assert.equal(removed.status, 200, JSON.stringify(removed.data));
  assert.equal(removed.data.previousStatus, "published");
  assert.equal((await call("GET", `/api/editorial-stories/public/slug/${live.slug}`, { cookieValue: "" })).status, 404, "the public link is dead");
  assert.equal((await call("GET", `/api/editorial-stories/public/slug/${live.slug}/passages`, { cookieValue: "" })).status, 404);
  const assets = await db.collection("scholar_editorial_image_assets").find({ story_id: new ObjectId(state.storyId), status: "active" }).toArray();
  assert.equal(assets.length, 0, "no image of a deleted story stays active");
});

test("the daily cap holds, and a failed draft says something the scholar can act on", async () => {
  const second = await call("POST", "/api/drafting/jobs", { body: { origin: "harvested", sourceId: "src-e2e-2", audience: "students", createStory: false } });
  assert.equal(second.status, 202);
  await readEvents(`/api/drafting/jobs/${second.data.job.id}/events`);
  const third = await call("POST", "/api/drafting/jobs", { body: { origin: "harvested", sourceId: "src-e2e-3", audience: "general", createStory: false } });
  assert.equal(third.status, 202);
  await readEvents(`/api/drafting/jobs/${third.data.job.id}/events`);
  const fourth = await call("POST", "/api/drafting/jobs", { body: { origin: "harvested", sourceId: "src-e2e-3", audience: "students", createStory: false } });
  assert.equal(fourth.status, 429);
  assert.match(fourth.data.error, /daily limit is 4/);

  /* Discard the third so the list shows a scholar's choice, not only the machine's. */
  const discarded = await call("POST", `/api/drafting/jobs/${third.data.job.id}/resume`, { body: { action: "discard" } });
  assert.equal(discarded.status, 200);
  assert.equal(discarded.data.job.status, "discarded");
  const again = await call("POST", `/api/drafting/jobs/${third.data.job.id}/resume`, { body: { action: "publish", storyId: state.storyId } });
  assert.equal(again.status, 409, "a discarded job cannot be published");

  const list = await call("GET", "/api/drafting/jobs");
  assert.equal(list.status, 200);
  assert.deepEqual(list.data.jobs.map((j) => j.status).sort(), ["awaiting_review", "discarded", "published", "published"], "the outline job became a story too");
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
    const created = await call("POST", "/api/drafting/jobs", { body: { origin: "harvested", sourceId: "src-e2e-3", audience: "general", createStory: false } });
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
    const refused = await call("POST", "/api/drafting/jobs", { body: { origin: "harvested", sourceId: "src-e2e-1", audience: "general", createStory: false } });
    assert.equal(refused.status, 403);
  } finally {
    base = prev;
    pilot.child.kill();
  }
});
