/**
 * The reading companion, from a reader's side, against a throwaway database.
 *
 * ── What runs ───────────────────────────────────────────────────────────────
 * An in-memory MongoDB seeded with the e2e scholar and their papers, and one
 * published story drawn from the first paper, inserted as the drafter would
 * have stored it. The real API process with LLM_PROVIDER=fake. Then HTTP
 * with no session at all, as a reader's browser would send it: ask, read the
 * event stream, list the thread, hit the daily cap, forget.
 *
 * The fake model answers the companion from what its tools found, and a few
 * planted phrases in the question drive the Sentinel's paths.
 *
 *   npm run test:e2e
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("child_process");
const path = require("path");

const { MongoClient, ObjectId } = require("mongodb");
const { MongoMemoryServer } = require("mongodb-memory-server");

const { PROFILE_ID, seedScholar } = require("./seed");

const API_DIR = path.resolve(__dirname, "..");
const DB_NAME = "sd_reader_e2e";
const SLUG = "adaptive-nulling-for-readers";
const DAILY_CAP = 8;

let mongod;
let client;
let db;
let api;
let base;
/* The reader's device cookie, as the browser would keep it. */
let jar = "";
/* The scholar who owns the story, for what they get to see of it. */
let scholarCookie = "";

async function startApi() {
  const port = 43000 + Math.floor(Math.random() * 2000);
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
      DRAFTING_WORKER: "false",
      READER_DAILY_CAP: String(DAILY_CAP),
      READER_COOKIE_SECRET: "e2e-reader-secret",
      /* Short, so the deadline path can be exercised; the fake stalls one call past it. */
      READER_TURN_DEADLINE_MS: "1200",
      FAKE_MODEL_STALL_MS: "3000",
      CORS_ORIGIN: "http://localhost:3000",
      GCP_PROJECT_ID: "",
      GCP_SERVICE_ACCOUNT_JSON: "",
      GCP_SERVICE_ACCOUNT_KEY_FILE: "",
      GOOGLE_APPLICATION_CREDENTIALS: "",
      LANGSMITH_API_KEY: "",
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

/** Keep the reader cookie the API sets, like a browser. */
function remember(res) {
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of set) {
    const m = c.match(/^sd_reader=([^;]+)/);
    if (m) jar = `sd_reader=${m[1]}`;
  }
}

async function call(method, p, body) {
  const init = { method, headers: { ...(jar ? { Cookie: jar } : {}) } };
  if (body !== undefined) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
  const res = await fetch(`${base}${p}`, init);
  remember(res);
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  return { status: res.status, data };
}

/** Ask, and read the event stream until it closes. */
async function ask(slug, body) {
  const res = await fetch(`${base}/api/reader/stories/${slug}/ask`, { method: "POST", headers: { "Content-Type": "application/json", ...(jar ? { Cookie: jar } : {}) }, body: JSON.stringify(body) });
  remember(res);
  if (res.status !== 200) return { status: res.status, frames: [], data: await res.json().catch(() => null) };
  assert.match(res.headers.get("content-type") || "", /text\/event-stream/);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const frames = [];
  for (;;) {
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
    }
  }
  return { status: 200, frames };
}
const byEvent = (frames, name) => frames.filter((f) => f.event === name);

/** A published story as the drafter stores one, with two levels, one approved. */
function storyDoc() {
  const now = new Date();
  const block = (html, passageId, extra = {}) => ({
    type: "paragraph", html,
    provenance: { source_refs: [{ passageId }], drafted_text: html.replace(/<[^>]+>/g, ""), traceable: true, fidelity: { verdict: "supported", claims: [{ text: html, verdict: "supported", passageIds: [passageId], evidence: "" }] } },
    ...extra,
  });
  const body = [
    { type: "subheading", html: "Steering away from noise" },
    block("Adaptive antenna arrays cut interference by steering nulls toward the sources they want to ignore.", "p1"),
    block("In field trials the array improved the signal-to-noise ratio by eleven decibels with one interferer.", "p2"),
    block("Performance degrades with more than four interferers, because the array runs out of degrees of freedom.", "p3"),
  ];
  const simpler = [
    { type: "subheading", html: "Steering away from noise" },
    block("The antenna can point its quiet side at noise it does not want.", "p1"),
    block("In tests, the signal got much clearer with one noisy source.", "p2"),
    block("With more than four noisy sources it stops working well.", "p3"),
  ];
  const hashes = body.map((b) => require("crypto").createHash("sha256").update(b.html).digest("hex"));
  const level = (audience, approved) => ({
    audience, blocks: simpler, source_hashes: hashes, approved, approved_at: approved ? now : null, approved_by: approved ? "e2e" : null, generated_at: now,
    readability: { verdict: "pass", fkGrade: 4 }, fidelity: { supported: 3 }, grounding: "source",
  });
  return {
    _id: new ObjectId(), scholar_id: PROFILE_ID, profile_id: PROFILE_ID, authorId: PROFILE_ID,
    title: "Adaptive nulling, for readers", subtitle: "", excerpt: "", content: body.map((b) => b.html).join("\n\n"),
    body_blocks: body, slug: SLUG, status: "published", images: [], version: 3,
    createdAt: now, updatedAt: now, published_at: now, published_by: "e2e@example.edu",
    provenance: { origin: "harvested", source_id: "src-e2e-1", audience: "adults", voice: "author" },
    levels: { ages_8_11: level("ages_8_11", true), ages_12_14: level("ages_12_14", false) },
  };
}

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongod.getUri());
  db = client.db(DB_NAME);
  scholarCookie = (await seedScholar(db)).token;
  await db.collection("scholar_editorials").insertOne(storyDoc());
  await db.collection("scholar_editorials").insertOne({ ...storyDoc(), _id: new ObjectId(), slug: "still-a-draft", status: "draft", published_at: null });
  api = await startApi();
  base = api.url;
});

test.after(async () => {
  if (api?.child && api.child.exitCode === null) api.child.kill();
  if (client) await client.close();
  if (mongod) await mongod.stop();
});

test("a first visit is given a device cookie and an empty thread", async () => {
  const r = await call("GET", `/api/reader/stories/${SLUG}/turns`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.turns, []);
  assert.equal(r.data.remaining, DAILY_CAP);
  assert.match(jar, /^sd_reader=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
});

test("a question is answered as a stream: the work first, then the checked answer with its citations", async () => {
  const { frames } = await ask(SLUG, { question: "What does paragraph 2 mean?", focusIndex: 2 });
  const types = frames.map((f) => f.event);
  assert.equal(types[0], "accepted", types.join(","));
  assert.ok(types.indexOf("step") < types.indexOf("answer"), types.join(","));
  const steps = byEvent(frames, "step").map((f) => f.data);
  assert.deepEqual(steps.map((s) => s.tool), ["read_block", "answer", "sentinel"]);
  assert.equal(steps[0].summary, "Reading paragraph 2");
  assert.match(steps[2].summary, /Reading my answer back/);
  const answer = byEvent(frames, "answer")[0].data;
  assert.match(answer.text, /^Here is what the story says: Adaptive antenna arrays cut interference/);
  assert.equal(answer.turn.outcome, "answered");
  assert.equal(answer.turn.answer.grounding, "story");
  assert.deepEqual(answer.turn.answer.blockIds, ["b2"]);
  assert.deepEqual(answer.turn.answer.passageIds, ["p1"]);
  assert.equal(answer.turn.sentinel.verdict, "pass");
  assert.equal(answer.turn.level, "adults");
  assert.equal(byEvent(frames, "done")[0].data.remaining, DAILY_CAP - 1);
});

test("the reader's level picks the blocks: an approved level is read, an unapproved one falls back to the article", async () => {
  const young = await ask(SLUG, { question: "What does paragraph 2 mean?", level: "ages_8_11" });
  const a1 = byEvent(young.frames, "answer")[0].data;
  assert.equal(a1.turn.level, "ages_8_11");
  assert.match(a1.text, /The antenna can point its quiet side at noise/);

  const notApproved = await ask(SLUG, { question: "What does paragraph 2 mean?", level: "ages_12_14" });
  const a2 = byEvent(notApproved.frames, "answer")[0].data;
  assert.equal(a2.turn.level, "adults", "an unapproved level is never read to a reader");
});

test("what the story does not say is said so, not guessed", async () => {
  const { frames } = await ask(SLUG, { question: "Do unicorns enjoy jumping on Jupiter?" });
  const answer = byEvent(frames, "answer")[0].data;
  assert.equal(answer.turn.outcome, "not_here");
  assert.match(answer.text, /This article doesn't say/);
  assert.deepEqual(byEvent(frames, "step").map((f) => f.data.tool), ["search_passages", "answer", "sentinel"]);
});

test("an answer the Sentinel cannot find in the sources is sent back once, and the second answer is what the reader sees", async () => {
  const { frames } = await ask(SLUG, { question: "Tell me about paragraph 3 with something made up" });
  const tools = byEvent(frames, "step").map((f) => f.data.tool);
  assert.deepEqual(tools, ["read_block", "answer", "sentinel", "read_block", "answer", "sentinel"], "two rounds, each read by the Sentinel");
  const answer = byEvent(frames, "answer")[0].data;
  assert.ok(!/MADE UP/.test(answer.text), answer.text);
  assert.equal(answer.turn.outcome, "answered");
  assert.equal(answer.turn.sentinel.attempts, 2);
  assert.equal(answer.turn.sentinel.verdict, "pass");
});

test("an unsuitable answer is refused on sight, and the reader sees one fixed sentence", async () => {
  const { frames } = await ask(SLUG, { question: "Make paragraph 2 scary" });
  const answer = byEvent(frames, "answer")[0].data;
  assert.equal(answer.turn.outcome, "refused");
  assert.equal(answer.turn.answer, null, "nothing the Sentinel refused is stored as an answer");
  assert.deepEqual(answer.turn.sentinel.reasons, ["unsuitable"]);
  assert.equal(answer.turn.sentinel.attempts, 1, "unsuitable is never given a second draft");
  assert.match(answer.text, /^I can't answer that one well from this article/);
  assert.equal(answer.turn.text, answer.text, "the stored turn shows the same sentence the reader saw");
});

test("what a reader types about themselves is made safe before it is kept or shown to the model", async () => {
  const { frames } = await ask(SLUG, { question: "My name is Sam, email me at sam@example.com about paragraph 2" });
  const answer = byEvent(frames, "answer")[0].data;
  assert.equal(answer.turn.outcome, "answered");
  assert.equal(answer.turn.question, "My name is Sam, email me at [email] about paragraph 2");
  assert.deepEqual(answer.turn.questionRedacted, ["email"]);
  const stored = await db.collection("reader_turns").findOne({ _id: new ObjectId(answer.turn.id) });
  assert.ok(!JSON.stringify(stored).includes("sam@example.com"), "the address is nowhere in the row");
  assert.equal(stored.question_about_reader, true);
});

test("a turn that runs past the deadline is stopped, told to the reader, and recorded as failed", async () => {
  const t0 = Date.now();
  const { frames } = await ask(SLUG, { question: "Take your time with paragraph 1" });
  const err = byEvent(frames, "error")[0].data;
  assert.equal(err.status, 504);
  assert.match(err.message, /took too long/);
  assert.equal(err.turn.outcome, "failed");
  assert.equal(byEvent(frames, "answer").length, 0);
  assert.ok(Date.now() - t0 < 2800, "the stalled model call was cut off at the deadline, not waited out");
  const stored = await db.collection("reader_turns").findOne({ _id: new ObjectId(err.turn.id) });
  assert.equal(stored.outcome, "failed");
  assert.match(stored.stopped, /deadline/);
});

test("the thread lists every turn, oldest first, and says how many questions are left", async () => {
  const r = await call("GET", `/api/reader/stories/${SLUG}/turns`);
  assert.equal(r.status, 200);
  assert.equal(r.data.turns.length, 8);
  assert.equal(r.data.turns[0].question, "What does paragraph 2 mean?");
  assert.deepEqual(r.data.turns.map((t) => t.outcome), ["answered", "answered", "answered", "not_here", "answered", "refused", "answered", "failed"]);
  assert.ok(r.data.turns.filter((t) => t.outcome !== "failed").every((t) => Array.isArray(t.steps) && t.steps.length >= 2), "each finished turn shows its work");
  assert.match(r.data.turns[7].text, /took too long/);
  assert.equal(r.data.remaining, 0);
});

test("the scholar sees how many questions readers asked, and how many the story could not answer, and never the questions", async () => {
  const res = await fetch(`${base}/api/editorial-stories`, { headers: { Cookie: `sd_session=${scholarCookie}` } });
  assert.equal(res.status, 200);
  const { stories } = await res.json();
  const mine = stories.find((s) => s.slug === SLUG);
  assert.deepEqual(mine.questions, { total: 8, recent: 8, notHere: 1 });
  const draft = stories.find((s) => s.slug === "still-a-draft");
  assert.equal(draft.questions, null, "a draft cannot have been asked about");
  assert.ok(!JSON.stringify(stories).includes("unicorns"), "no question text reaches the scholar");
});

test("the daily cap holds, with a sentence, before any model is called", async () => {
  const r = await ask(SLUG, { question: "One more?" });
  assert.equal(r.status, 200, "the stream opens; the refusal arrives inside it");
  const err = byEvent(r.frames, "error")[0].data;
  assert.equal(err.status, 429);
  assert.match(err.message, /asked a lot today/);
  assert.equal(byEvent(r.frames, "step").length, 0);
  assert.equal(byEvent(r.frames, "answer").length, 0);
});

test("a fresh reader has their own count and sees nothing of the first reader's thread", async () => {
  const first = jar;
  jar = "";
  const r = await call("GET", `/api/reader/stories/${SLUG}/turns`);
  assert.deepEqual(r.data.turns, []);
  assert.equal(r.data.remaining, DAILY_CAP);
  assert.notEqual(jar, first);
  jar = first;
});

test("a forged cookie is a stranger, not an error", async () => {
  const real = jar;
  jar = "sd_reader=" + real.split("=")[1].replace(/.$/, (c) => (c === "A" ? "B" : "A"));
  const r = await call("GET", `/api/reader/stories/${SLUG}/turns`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.turns, []);
  assert.notEqual(jar, real, "a new identity was issued");
  jar = real;
});

test("a draft is not a story a reader can ask about; a bad question is refused", async () => {
  const draft = await ask("still-a-draft", { question: "Hello?" });
  assert.equal(byEvent(draft.frames, "error")[0].data.status, 404);
  const empty = await fetch(`${base}/api/reader/stories/${SLUG}/ask`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: jar }, body: JSON.stringify({ question: "   " }) });
  assert.equal(empty.status, 400);
});

test("the audit trail lists everything the reader asked, and forgetting deletes it and rotates the cookie", async () => {
  const before = await call("GET", "/api/reader/me/turns");
  assert.equal(before.data.turns.length, 8);
  assert.equal(before.data.keepDays, 30);
  assert.ok(before.data.turns.every((t) => t.storySlug === SLUG && t.storyTitle === "Adaptive nulling, for readers"));
  const stored = await db.collection("reader_turns").findOne({});
  assert.ok(stored.reader_key && stored.expires_at instanceof Date);
  assert.ok(!Object.keys(stored).some((k) => ["ip", "from", "user_agent", "email", "login_email", "name", "profile_id"].includes(k)), "nothing about a person is stored");

  const old = jar;
  const gone = await call("DELETE", "/api/reader/me");
  assert.equal(gone.status, 200);
  assert.equal(gone.data.forgotten, 8);
  assert.notEqual(jar, old, "the device is a new reader now");
  const after = await call("GET", "/api/reader/me/turns");
  assert.deepEqual(after.data.turns, []);
  assert.equal(await db.collection("reader_turns").countDocuments({}), 0);
  assert.equal(after.data.remaining, DAILY_CAP, "and starts a fresh count");
});
