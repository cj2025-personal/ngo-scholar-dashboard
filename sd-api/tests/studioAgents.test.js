/**
 * The studio's conversation and ideas agents, against scripted decisions and
 * the test double.
 *
 * What must hold: the decision is carried as the model gave it; a decision
 * the page could not carry out — a paper that is not the scholar's, a plan
 * with no paper or no brief, an outline acted on when none is waiting — is
 * sent back once with the reason, and a second failure becomes a reply that
 * acts on nothing; the prompt says what is set and where the paper came
 * from; ideas are parsed to the count asked for, with unknown actions made
 * safe.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const converse = require("../src/lib/agents/studioConverse");
const ideas = require("../src/lib/agents/studioIdeas");
const fake = require("../src/lib/fakeModel");

const PAPERS = [
  { key: "pmc:1", title: "Adaptive nulling in small antenna arrays", year: 2024 },
  { key: "pmc:2", title: "Second paper" },
];
const AUDIENCES = [{ value: "ages_8_11", label: "Ages 8 to 11" }, { value: "ages_12_14", label: "Ages 12 to 14" }, { value: "ages_15_18", label: "Ages 15 to 18" }, { value: "adults", label: "Adults" }];
const VOICES = [{ value: "author", label: "My own account" }, { value: "about", label: "An account about me" }];
const base = { papers: PAPERS, audiences: AUDIENCES, voices: VOICES, scholarName: "Test Scholar" };

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

test("a decision the page can carry out is returned as given", async () => {
  const { generate, prompts } = scripted({ action: "plan", paper_key: "pmc:1", audience: "ages_15_18", brief: "the field trials", reply: "Planning it." });
  const r = await converse.decide({ ...base, messages: said("Write about the field trials from my antenna paper for teenagers"), state: { stage: "start" }, generate });
  assert.equal(prompts.length, 1);
  assert.equal(r.decision.action, "plan");
  assert.equal(r.decision.paperKey, "pmc:1");
  assert.equal(r.decision.audience, "ages_15_18");
  assert.equal(r.decision.brief, "the field trials");
  assert.match(prompts[0], /pmc:1 — Adaptive nulling in small antenna arrays \(2024\)/);
});

test("a paper that is not the scholar's is sent back once with the reason", async () => {
  const { generate, prompts } = scripted({ action: "plan", paper_key: "pmc:999", brief: "x" }, { action: "ask_paper", reply: "Which one?" });
  const r = await converse.decide({ ...base, messages: said("Write from my other paper"), state: {}, generate });
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /YOUR LAST DECISION COULD NOT BE CARRIED OUT: It named the paper "pmc:999"/);
  assert.equal(r.decision.action, "ask_paper");
});

test("planning with no paper or no brief, or acting on an outline that is not there, is corrected", async () => {
  for (const [first, reason, state] of [
    [{ action: "plan", brief: "x" }, /planned without knowing which paper/, {}],
    [{ action: "plan", paper_key: "pmc:1", brief: "" }, /planned without a brief/, {}],
    [{ action: "approve" }, /no outline waiting/, { stage: "start" }],
  ]) {
    const { generate, prompts } = scripted(first, { action: "reply", reply: "Tell me more." });
    const r = await converse.decide({ ...base, messages: said("hm"), state, generate });
    assert.match(prompts[1], reason);
    assert.equal(r.decision.action, "reply");
  }
});

test("two decisions the page cannot carry out become a reply that acts on nothing", async () => {
  const { generate, prompts } = scripted({ action: "plan", paper_key: "nope:1", brief: "x", reply: "" });
  const r = await converse.decide({ ...base, messages: said("go"), state: {}, generate });
  assert.equal(prompts.length, 2);
  assert.equal(r.decision.action, "reply");
  assert.ok(r.decision.reply.length > 0);
});

test("an illegible decision is retried, and with only one paper a plan needs none named", async () => {
  let n = 0;
  const generate = async () => ({ text: n++ === 0 ? "not json" : JSON.stringify({ action: "plan", paper_key: "", audience: "adults", voice: "", extra_audiences: [], brief: "the method", reply: "ok", rationale: "r" }) });
  const r = await converse.decide({ ...base, papers: [PAPERS[0]], messages: said("the method, for adults"), state: {}, generate });
  assert.equal(n, 2);
  assert.equal(r.decision.paperKey, "pmc:1");
});

test("the prompt says what is set, and whether the paper came from the shelf", () => {
  const p = converse.buildPrompt({ ...base, messages: said("Keep it short."), state: { paperKey: "pmc:1", paperFrom: "shelf", audience: "adults", stage: "start" } });
  assert.match(p, /paper: pmc:1 \(chosen on their Papers shelf, before this conversation\); reader: adults/);
  const q = converse.buildPrompt({ ...base, messages: said("Keep it short."), state: { stage: "outline_waiting", outlineTitle: "What the paper found" } });
  assert.match(q, /paper: \(none\); reader: \(not said\)/);
  assert.match(q, /stage: outline_waiting — the waiting outline is titled "What the paper found"/);
  assert.ok(q.trim().endsWith(`${converse.MARKER} Keep it short.`));
});

test("the test double walks the page's paths: which paper, who for, then a plan", async () => {
  const d1 = await converse.decide({ ...base, messages: said("Explain how the experiment was done, step by step"), state: {}, generate: viaFake });
  assert.equal(d1.decision.action, "ask_paper");
  const d2 = await converse.decide({ ...base, messages: said("Explain how the experiment was done, step by step", d1.decision.reply, "Use “Second paper”."), state: { paperKey: "pmc:2", paperFrom: "conversation" }, generate: viaFake });
  assert.equal(d2.decision.action, "ask_audience");
  const d3 = await converse.decide({ ...base, messages: said("Explain how the experiment was done, step by step", d1.decision.reply, "Use “Second paper”.", d2.decision.reply, "For ages 12 to 14."), state: { paperKey: "pmc:2", paperFrom: "conversation", audience: "ages_12_14" }, generate: viaFake });
  assert.equal(d3.decision.action, "plan");
  assert.equal(d3.decision.paperKey, "pmc:2");
  assert.equal(d3.decision.brief, "Explain how the experiment was done, step by step");
  const named = await converse.decide({ ...base, messages: said("From my adaptive nulling antenna arrays paper: why the limit matters, for teenagers"), state: {}, generate: viaFake });
  assert.equal(named.decision.action, "plan");
  assert.equal(named.decision.paperKey, "pmc:1");
  assert.equal(named.decision.audience, "ages_15_18");
  const replan = await converse.decide({ ...base, messages: said("Lead with the limitations."), state: { paperKey: "pmc:1", stage: "outline_waiting" }, generate: viaFake });
  assert.equal(replan.decision.action, "replan");
});

test("ideas are parsed to the count asked for, with unknown actions made safe", () => {
  const raw = JSON.stringify({ groups: [
    { title: "Needs a look", ideas: [{ text: "Rewrite paragraph 2", action: "prefill" }, { text: "Rewrite paragraph 4", action: "launch" }] },
    { title: "", ideas: [{ text: "orphan", action: "prefill" }] },
    { title: "The whole article", ideas: [{ text: "Shorten the opening", action: "prefill" }, { text: "Over the count", action: "prefill" }] },
  ] });
  const groups = ideas.parseGroups(raw, 3);
  assert.deepEqual(groups.map((g) => g.title), ["Needs a look", "The whole article"]);
  assert.equal(groups[0].ideas[1].action, "prefill");
  assert.deepEqual(groups[1].ideas.map((i) => i.text), ["Shorten the opening"]);
  assert.deepEqual(ideas.parseGroups("not json", 3), []);
});

test("ideas for a draft read its flags and the paragraph in focus; for a new story, the chosen paper", async () => {
  const s = await ideas.ideasForStory({
    title: "T", audience: "adults", focusIndex: 2, count: 8, generate: viaFake,
    blocks: [{ index: 1, type: "paragraph", text: "a", fidelity: "supported" }, { index: 2, type: "paragraph", text: "b", fidelity: "unsupported" }, { index: 3, type: "subheading", text: "How it was done." }],
  });
  assert.deepEqual(s.groups[0], { title: "Needs a look", ideas: [{ text: "Rewrite paragraph 2 so every claim stays within the paper", action: "prefill" }] });
  assert.ok(s.groups.some((g) => g.title === "The paragraph you are on"));
  assert.ok(s.groups.some((g) => g.ideas.some((i) => i.text === "Tighten the section “How it was done”")));
  const n = await ideas.ideasForNewStory({ papers: PAPERS, chosen: PAPERS[0], count: 8, generate: viaFake });
  assert.deepEqual(n.groups[0].ideas, [{ text: "What could this paper become?", action: "propose" }]);
});
