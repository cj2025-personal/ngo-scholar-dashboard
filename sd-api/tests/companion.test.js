/**
 * The agent and the Sentinel, run together.
 *
 * What must hold: a passing answer comes back after one round; an answer
 * sent back is tried again with the Sentinel's guidance, as many rounds as
 * the policy allows, and no more; a refusal stops at once and a refusal is
 * written; a failed writer falls back to the policy's sentence; an abort
 * ends the work with a named error and reaches every model call.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const companion = require("../src/lib/companion");
const agent = require("../src/lib/readingAgent");

const blocks = agent.blocksFromStory([{ type: "paragraph", html: "The array steers nulls toward interferers.", sourceRefs: [{ passageId: "p1" }] }]);
const passages = [{ id: "p1", text: "Adaptive antenna arrays reduce interference by steering nulls toward unwanted sources." }];
const limits = (maxRevisions = 2) => ({ agent: { maxSteps: 3, maxToolCalls: 5, maxFollowUps: 2 }, sentinel: { maxRevisions, maxClaims: 12, claimChars: 300 } });
const answerCall = (text) => ({ functionCalls: [{ name: "answer", args: { text, grounding: "story", intent: "explain", block_ids: ["b1"], passage_ids: ["p1"], reason: "Answering" } }], parts: [], usage: { input: 10 }, model: "writer" });
const ruling = (verdict, extra = {}) => ({ text: JSON.stringify({ verdict, reasons: [], guidance: "", rationale: "r", claims: [], link_or_contact: false, asks_about_reader: false, reading_level: "fits", length: "fits", unchecked_specifics: false, story_answers_it: false, ...extra }), usage: { input: 3 }, model: "judge" });
const writer = async () => ({ text: JSON.stringify({ text: "Let's look at the article instead." }), model: "refusal" });

test("a passing answer comes back after one round, with the models that worked on it", async () => {
  const r = await companion.answerQuestion({ blocks, passages, question: "q", limits: limits(), generate: async () => answerCall("It steers nulls."), judge: async () => ruling("pass"), refusal: writer });
  assert.equal(r.answer.text, "It steers nulls.");
  assert.equal(r.attempts, 1);
  assert.deepEqual(r.steps.map((s) => s.tool), ["answer", "sentinel"]);
  assert.deepEqual(r.models, ["writer", "judge"]);
  assert.equal(r.refusalText, null);
});

test("revise carries the Sentinel's guidance into the next round", async () => {
  const openings = [];
  let n = 0;
  const r = await companion.answerQuestion({
    blocks, passages, question: "q", limits: limits(),
    generate: async (req) => { openings.push(req.contents[0].parts[0].text); n += 1; return answerCall(n === 1 ? "Tested on Mars." : "It steers nulls."); },
    judge: async (req) => (/Mars/.test(req.prompt) ? ruling("revise", { reasons: ["not_in_sources"], guidance: "Remove the Mars claim." }) : ruling("pass")),
    refusal: writer,
  });
  assert.equal(r.answer.text, "It steers nulls.");
  assert.equal(r.attempts, 2);
  assert.deepEqual(r.rulings.map((x) => x.verdict), ["revise", "pass"]);
  assert.match(openings[1], /A REVIEWER SENT YOUR LAST ANSWER BACK[\s\S]*- Remove the Mars claim\.[\s\S]*- Concern: not in sources/);
});

test("the revision rounds stop at the policy's limit, and the reader gets a written refusal", async () => {
  let generated = 0;
  const r = await companion.answerQuestion({ blocks, passages, question: "q", limits: limits(1), generate: async () => { generated += 1; return answerCall("Still wrong."); }, judge: async () => ruling("revise", { reasons: ["not_in_sources"], guidance: "g" }), refusal: writer });
  assert.equal(generated, 2, "one first try and one revision");
  assert.equal(r.answer, null);
  assert.equal(r.refusalText, "Let's look at the article instead.");
});

test("refuse stops at once; a writer that fails falls back to the policy's sentence", async () => {
  let generated = 0;
  const r = await companion.answerQuestion({ blocks, passages, question: "q", limits: limits(), generate: async () => { generated += 1; return answerCall("x"); }, judge: async () => ruling("refuse", { reasons: ["unsuitable"] }), refusal: async () => { throw new Error("down"); }, refusalFallback: "Fallback sentence." });
  assert.equal(generated, 1);
  assert.equal(r.check.verdict, "refuse");
  assert.equal(r.refusalText, "Fallback sentence.");
});

test("an abort ends the work with a named error, and the signal reaches every model call", async () => {
  const control = new AbortController();
  const signals = [];
  await assert.rejects(
    companion.answerQuestion({ blocks, passages, question: "q", limits: limits(), signal: control.signal, generate: async (req) => { signals.push(req.signal); control.abort(new Error("the deadline passed")); return answerCall("x"); }, judge: async () => { throw new Error("must not run"); } }),
    (e) => e.name === "AbortError" && /deadline passed/.test(e.message),
  );
  assert.equal(signals[0], control.signal);
});
