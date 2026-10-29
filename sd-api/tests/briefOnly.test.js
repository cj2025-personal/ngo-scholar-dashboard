/**
 * Writing from the brief alone, drawing on none of the scholar's papers.
 *
 * What must hold: the conversation agent may plan with no paper only when
 * that is chosen (or there is no paper at all), never by default when a paper
 * exists; an angle is never proposed from no paper; the outline from a brief
 * is every section the author's own and cites nothing, and an approved
 * outline keeps it that way; the writer is told there is no paper; a story
 * drafted this way carries no source id, so nothing reads a paper for it.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const converse = require("../src/lib/agents/studioConverse");
const plan = require("../src/lib/draftPlan");
const composer = require("../src/lib/draftComposer");
const { normaliseApprovedOutline } = require("../src/lib/draftGraph");
const { storyProvenanceFromJob } = require("../src/lib/provenance");
const { BRIEF_KEY, BRIEF_TITLE, isBriefOnly } = require("../src/lib/briefSource");
const fake = require("../src/lib/fakeModel");

const AUDIENCES = [{ value: "adults", label: "Adults" }, { value: "ages_15_18", label: "Ages 15 to 18" }];
const VOICES = [{ value: "author", label: "My own account" }, { value: "about", label: "An account about me" }];
const BRIEF = { key: BRIEF_KEY, title: BRIEF_TITLE };
const ONE_PAPER = [{ key: "pmc:1", title: "Adaptive nulling in small antenna arrays" }, BRIEF];
const base = { audiences: AUDIENCES, voices: VOICES, scholarName: "Test Scholar" };
const said = (...texts) => texts.map((t, i) => ({ role: i % 2 === 0 ? "scholar" : "agent", text: t }));
const scripted = (...decisions) => {
  const prompts = [];
  const generate = async ({ prompt }) => {
    prompts.push(prompt);
    const d = decisions[Math.min(prompts.length - 1, decisions.length - 1)];
    return { text: JSON.stringify({ action: "reply", paper_key: "", audience: "", voice: "", extra_audiences: [], brief: "", reply: "ok", rationale: "r", ...d }), usage: { input: 1 }, model: "m" };
  };
  return { generate, prompts };
};
const viaFake = (p) => fake.generateContent(p).then((r) => ({ ...r, model: "fake" }));

test("planning from the brief alone is carried out when it is chosen", async () => {
  const { generate, prompts } = scripted({ action: "plan", paper_key: BRIEF_KEY, audience: "adults", brief: "how cities plan for heat", reply: "Planning it from your brief alone." });
  const r = await converse.decide({ ...base, papers: ONE_PAPER, messages: said("Without my papers: how cities plan for heat, for adults"), state: { stage: "start" }, generate });
  assert.equal(prompts.length, 1);
  assert.equal(r.decision.action, "plan");
  assert.equal(r.decision.paperKey, BRIEF_KEY);
  assert.match(prompts[0], new RegExp(`${BRIEF_KEY} — No paper`));
});

test("a plan with nothing chosen binds the only paper, never the brief, while a paper exists", async () => {
  const { generate } = scripted({ action: "plan", audience: "adults", brief: "the field trials" });
  const r = await converse.decide({ ...base, papers: ONE_PAPER, messages: said("the field trials, for adults"), state: {}, generate });
  assert.equal(r.decision.paperKey, "pmc:1");
});

test("with no paper at all, a plan binds the brief alone", async () => {
  const { generate } = scripted({ action: "plan", audience: "adults", brief: "how cities plan for heat" });
  const r = await converse.decide({ ...base, papers: [BRIEF], messages: said("how cities plan for heat, for adults"), state: {}, generate });
  assert.equal(r.decision.paperKey, BRIEF_KEY);
});

test("with two papers and nothing chosen, a plan is sent back; an angle from no paper is too", async () => {
  const two = [{ key: "pmc:1", title: "One" }, { key: "pmc:2", title: "Two" }, BRIEF];
  let s = scripted({ action: "plan", brief: "x" }, { action: "ask_paper", reply: "Which one, or none?" });
  let r = await converse.decide({ ...base, papers: two, messages: said("write something"), state: {}, generate: s.generate });
  assert.match(s.prompts[1], /planned without knowing which paper, or whether from none/);
  assert.equal(r.decision.action, "ask_paper");
  s = scripted({ action: "propose", paper_key: BRIEF_KEY }, { action: "reply", reply: "What should it be about?" });
  r = await converse.decide({ ...base, papers: two, messages: said("suggest an angle"), state: {}, generate: s.generate });
  assert.match(s.prompts[1], /proposed an angle with no paper/);
  assert.equal(r.decision.action, "reply");
});

test("the test double chooses the brief alone only when asked, and plans from it", async () => {
  const asked = await converse.decide({ ...base, papers: ONE_PAPER, messages: said("Write without my papers about how cities plan for heatwaves, for adults"), state: { stage: "start" }, generate: viaFake });
  assert.equal(asked.decision.action, "plan");
  assert.equal(asked.decision.paperKey, BRIEF_KEY);
  assert.match(asked.decision.reply, /None of your papers will be used/);
  const notAsked = await converse.decide({ ...base, papers: ONE_PAPER, messages: said("Write about what the field trials showed, for adults"), state: { stage: "start" }, generate: viaFake });
  assert.equal(notAsked.decision.paperKey, "pmc:1");
});

test("the outline from a brief is every section the author's own, citing nothing", async () => {
  const prompt = plan.buildBriefOutlinePrompt({ scholar: { name: "Test Scholar" }, audience: "adults", brief: "how cities plan for heat", voice: composer.VOICE.AUTHOR });
  assert.match(prompt, /There is no paper behind it/);
  assert.doesNotMatch(prompt, /PAPER, IN NUMBERED PASSAGES/);
  const r = await fake.generateContent({ prompt });
  const outline = plan.parseBriefOutline(r.text);
  assert.ok(outline.beats.length >= 2);
  for (const b of outline.beats) {
    assert.equal(b.kind, plan.BEAT_KIND.CONTEXT);
    assert.deepEqual(b.passageIds, []);
  }
  /* A kind or a passage the model or the page slips in does not survive. */
  const sloppy = plan.parseBriefOutline(JSON.stringify({ title: "T", deck: "D", beats: [{ heading: "A", goal: "a", kind: "paper", passage_ids: ["p1"] }, { heading: "B", goal: "b", kind: "extension", passage_ids: [] }], brief_map: null, brief_coverage: null }));
  assert.deepEqual(sloppy.beats.map((b) => [b.kind, b.passageIds.length]), [["context", 0], ["context", 0]]);
  const approved = normaliseApprovedOutline(outline, { ...outline, beats: [{ ...outline.beats[0], kind: "paper", passageIds: ["p1"] }] }, [], { briefOnly: true });
  assert.equal(approved.beats.length, 1);
  assert.equal(approved.beats[0].kind, plan.BEAT_KIND.CONTEXT);
  assert.deepEqual(approved.beats[0].passageIds, []);
});

test("the writer is told there is no paper, and the section shows none", () => {
  const sys = composer.buildSystemInstruction({ voice: composer.VOICE.AUTHOR, scholarName: "Test Scholar", briefOnly: true });
  assert.match(sys, /no paper of theirs is behind it/);
  assert.doesNotMatch(sys, /must come from the paper you are given/);
  const beat = { index: 1, heading: "Where it starts", goal: "g", kind: plan.BEAT_KIND.CONTEXT, passageIds: [] };
  const section = plan.buildSectionPrompt({ scholar: { name: "Test Scholar" }, beat, passages: [], outline: { title: "T", beats: [beat] }, audience: "adults", brief: "x", briefOnly: true });
  assert.match(section, /There is no paper behind this article/);
  assert.match(section, /\(none: there is no paper behind this article\)/);
});

test("a story drafted from a brief names no source, so nothing reads a paper for it", () => {
  const p = storyProvenanceFromJob({ _id: "j1", source: { origin: "brief", id: "only", title: null }, audience: "adults", voice: "author" });
  assert.equal(p.origin, "brief");
  assert.equal(p.source_id, null);
  assert.ok(isBriefOnly(p));
  const q = storyProvenanceFromJob({ _id: "j2", source: { origin: "harvested", id: "src-1", title: "A paper" } });
  assert.equal(q.source_id, "src-1");
  assert.ok(!isBriefOnly(q));
});
