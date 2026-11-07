/**
 * Kivyn writes for a learning circle (2026-11-06).
 *
 * What must hold in the conversation: the agent is shown the circles the
 * scholar leads and the one set on the page they came from; a circle it
 * names must be one of theirs; an article for a circle is planned for one of
 * the circle's reading ages, never another; "not for a circle" clears one,
 * and saying nothing about it keeps it.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.MONGODB_URI ||= "mongodb://localhost:27017";
process.env.MONGODB_DB ||= "circle-writing-test";

const converse = require("../src/lib/agents/studioConverse");
const plan = require("../src/lib/draftPlan");
const { forWriting, circlesFor, _resetCircleCache } = require("../src/lib/scholarCircles");
const { joinCircle } = require("../src/services/editorial.service");

const AUDIENCES = [
  { value: "ages_8_11", label: "Ages 8 to 11" },
  { value: "ages_12_14", label: "Ages 12 to 14" },
  { value: "adults", label: "Adults" },
];
const VOICES = [{ value: "author", label: "My own account" }];
const PAPERS = [{ key: "pmc:1", title: "Adaptive nulling in small antenna arrays" }];
const CIRCLES = [
  { id: "64b000000000000000000c01", name: "Listening machines", purpose: "Classes read how antennas pick one voice out of a crowd.", bands: ["ages_8_11", "ages_12_14"] },
  { id: "64b000000000000000000c02", name: "Radio for grown-ups", purpose: "Adult learners read how radio reaches us.", bands: ["adults"] },
];
const base = { papers: PAPERS, audiences: AUDIENCES, voices: VOICES, scholarName: "Test Scholar", circles: CIRCLES };
const said = (text) => [{ role: "scholar", text }];
const scripted = (...decisions) => {
  const prompts = [];
  const generate = async ({ prompt, responseSchema }) => {
    prompts.push({ prompt, responseSchema });
    const d = decisions[Math.min(prompts.length - 1, decisions.length - 1)];
    return { text: JSON.stringify({ action: "reply", paper_key: "none", circle_id: "none", audience: "none", voice: "none", extra_audiences: [], brief: "", reply: "ok", rationale: "r", ...d }), usage: { input: 1 }, model: "m" };
  };
  return { generate, prompts };
};

test("the agent is shown the scholar's circles, their reading ages, and the one set on the page", async () => {
  const s = scripted({ action: "reply" });
  await converse.decide({ ...base, messages: said("hello"), state: { circleId: CIRCLES[0].id, circleFrom: "page" }, generate: s.generate });
  const { prompt, responseSchema } = s.prompts[0];
  assert.match(prompt, /THEIR LEARNING CIRCLES/);
  assert.match(prompt, /only for an article the scholar says is for one of them/);
  assert.match(prompt, /64b000000000000000000c01 — Listening machines — Classes read how antennas pick one voice out of a crowd\. — ages_8_11, ages_12_14/);
  assert.match(prompt, /circle: 64b000000000000000000c01 \(Listening machines; chosen on the circle's page/);
  assert.deepEqual(responseSchema.properties.circle_id.enum, ["none", "not_for_circle", CIRCLES[0].id, CIRCLES[1].id], "only theirs, or none, or not for a circle");

  const none = scripted({ action: "reply" });
  await converse.decide({ ...base, circles: [], messages: said("hello"), state: {}, generate: none.generate });
  assert.match(none.prompts[0].prompt, /THEIR LEARNING CIRCLES[^\n]*\n\(none\)/);
});

test("a plan for a circle is for one of its reading ages; any other is sent back once", async () => {
  const s = scripted(
    { action: "plan", paper_key: "pmc:1", circle_id: CIRCLES[0].id, audience: "adults", brief: "how antennas listen" },
    { action: "plan", paper_key: "pmc:1", circle_id: CIRCLES[0].id, audience: "ages_8_11", extra_audiences: ["ages_12_14"], brief: "how antennas listen", reply: "I'll write it for Listening machines, for ages 8 to 11." },
  );
  const r = await converse.decide({ ...base, messages: said("For my Listening machines circle: how antennas listen, from my paper"), state: {}, generate: s.generate });
  assert.equal(s.prompts.length, 2);
  assert.match(s.prompts[1].prompt, /planned for adults, but the circle "Listening machines" is for Ages 8 to 11, Ages 12 to 14/);
  assert.equal(r.decision.circleId, CIRCLES[0].id);
  assert.equal(r.decision.audience, "ages_8_11");
  assert.deepEqual(r.decision.extraAudiences, ["ages_12_14"]);

  /* The circle set on the page, the reader set on the page: the same rule. */
  const fromPage = scripted({ action: "plan", paper_key: "pmc:1", circle_id: "none", audience: "none", brief: "radio" }, { action: "plan", paper_key: "pmc:1", audience: "adults", brief: "radio" });
  const kept = await converse.decide({ ...base, messages: said("about radio"), state: { circleId: CIRCLES[1].id, circleFrom: "page", audience: "ages_8_11" }, generate: fromPage.generate });
  assert.equal(fromPage.prompts.length, 2, "a page's reader outside the page's circle is sent back too");
  assert.equal(kept.decision.audience, "adults");
});

test("a circle that is not theirs is never acted on", async () => {
  const s = scripted({ action: "plan", paper_key: "pmc:1", circle_id: "64b0000000000000000000ff", audience: "adults", brief: "x" });
  const r = await converse.decide({ ...base, messages: said("for my other circle"), state: {}, generate: s.generate });
  assert.equal(s.prompts.length, 2);
  assert.match(s.prompts[1].prompt, /named a circle that is not in the scholar's list/);
  assert.equal(r.decision.action, "reply", "still not something the page can do: nothing is acted on");
});

test("the outline is told who reads it, and a portal's own framing when the circle is in one", () => {
  const viewed = {
    id: "64b000000000000000000c01", name: "Inventors of the South Side", purpose: "Classes read about Black inventors in Chicago.", bands: ["ages_8_11"], status: "open",
    placement: { community: "black", status: "placed", withdrawn: false },
    portals: [{ community: "black", name: "Black", framing: "Do not use trauma as the default frame." }],
  };
  const circle = forWriting(viewed);
  assert.deepEqual(circle.portal, { community: "black", name: "Black", framing: "Do not use trauma as the default frame." });
  const outline = plan.buildBriefOutlinePrompt({ scholar: { name: "Test Scholar" }, audience: "ages_8_11", brief: "patents and workshops", circle });
  assert.match(outline, /learning circle "Inventors of the South Side"/);
  assert.match(outline, /What the circle reads: Classes read about Black inventors in Chicago\./);
  assert.match(outline, /The brief, not the circle, decides what the article covers\./);
  assert.match(outline, /shown in the Black community's portal, which frames its reading this way: Do not use trauma as the default frame\./);
  const fromPaper = plan.buildOutlinePrompt({ scholar: { name: "Test Scholar" }, source: { title: "t" }, passages: [], audience: "ages_8_11", brief: "x", circle });
  assert.match(fromPaper, /learning circle "Inventors of the South Side"/);

  /* Withdrawn, declined, or never asked for: no portal framing; no circle: no lines at all. */
  assert.equal(forWriting({ ...viewed, placement: { ...viewed.placement, withdrawn: true } }).portal, null);
  assert.equal(forWriting({ ...viewed, placement: { ...viewed.placement, status: "declined" } }).portal, null);
  assert.equal(forWriting({ ...viewed, placement: null }).portal, null);
  assert.doesNotMatch(plan.buildBriefOutlinePrompt({ scholar: {}, audience: "adults", brief: "x" }), /learning circle/);
});

test("the circles Kivyn may write for are the open ones and the not-yet-open; a learner app that cannot answer leaves none", async () => {
  _resetCircleCache();
  const calls = [];
  const call = async (method, path, opts) => {
    calls.push({ method, path, opts });
    return { circles: [
      { id: "a1", name: "Open", purpose: "p", bands: ["adults"], status: "open" },
      { id: "a2", name: "Draft", purpose: "p", bands: ["adults"], status: "draft" },
      { id: "a3", name: "Closed", purpose: "p", bands: ["adults"], status: "archived" },
      { id: "a4", name: "Paused", purpose: "p", bands: ["adults"], status: "suspended" },
    ] };
  };
  const got = await circlesFor("p-1", { call, now: 1000 });
  assert.deepEqual(got.map((c) => c.name), ["Open", "Draft"]);
  assert.equal(calls[0].opts.profileId, "p-1");
  assert.ok(calls[0].opts.timeoutMs <= 5000, "a short wait: a turn is never held up");
  await circlesFor("p-1", { call, now: 2000 });
  assert.equal(calls.length, 1, "kept a minute");
  await circlesFor("p-1", { call, now: 2000, fresh: true });
  assert.equal(calls.length, 2, "read again when the page names one made since");
  _resetCircleCache();
  assert.deepEqual(await circlesFor("p-2", { call: async () => { throw new Error("down"); } }), []);
});

test("a published story written for a circle joins it once; a failure is noted, never a failed publish", async () => {
  const writes = [];
  const db = { collection: () => ({ updateOne: async (filter, update) => { writes.push(update.$set); return { matchedCount: 1 }; } }) };
  const story = { _id: "64b0000000000000000000aa", profile_id: "p-1", status: "published", circle: { id: "64b000000000000000000c01", name: "Inventors", joined_at: null } };
  const calls = [];
  const ok = async (method, path, opts) => { calls.push({ method, path, opts }); return { added: true }; };

  await joinCircle(db, { ...story, status: "draft" }, { call: ok });
  await joinCircle(db, { ...story, status: "scheduled" }, { call: ok });
  await joinCircle(db, { ...story, circle: null }, { call: ok });
  assert.equal(calls.length, 0, "only a published story written for a circle");

  await joinCircle(db, story, { call: ok });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].path, "/circles/64b000000000000000000c01/stories");
  assert.deepEqual(calls[0].opts.body, { editorialId: "64b0000000000000000000aa" });
  assert.equal(calls[0].opts.profileId, "p-1");
  assert.ok(calls[0].opts.timeoutMs > 30_000, "it may wait on the portal's judge");
  assert.ok(writes[0]["circle.joined_at"] instanceof Date);

  await joinCircle(db, { ...story, circle: { ...story.circle, joined_at: new Date() } }, { call: ok });
  assert.equal(calls.length, 1, "once");

  await joinCircle(db, story, { call: async () => { throw new Error("This circle reads 12 stories already."); } });
  assert.equal(writes.at(-1)["circle.problem"], "This circle reads 12 stories already.", "the scholar sees why on the story");
});

test("not for a circle clears it; saying nothing about it keeps it", async () => {
  const cleared = await converse.decide({ ...base, messages: said("this one isn't for a circle"), state: { circleId: CIRCLES[0].id, circleFrom: "page" }, generate: scripted({ action: "reply", circle_id: "not_for_circle" }).generate });
  assert.equal(cleared.decision.circleCleared, true);
  assert.equal(cleared.decision.circleId, null);
  const kept = await converse.decide({ ...base, messages: said("make it short"), state: { circleId: CIRCLES[0].id, circleFrom: "page" }, generate: scripted({ action: "reply" }).generate });
  assert.equal(kept.decision.circleCleared, false);
  assert.equal(kept.decision.circleId, null, "none: the page keeps what it set");
});
