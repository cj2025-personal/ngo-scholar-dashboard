/**
 * The Sentinel, against scripted rulings.
 *
 * What must hold: the verdict, reasons and guidance are the model's, carried
 * out as given; an illegible ruling approves nothing; the prompt shows the
 * whole article, the cited passages (all of them when the answer says the
 * story does not say), the grounding and the reader; anchors that do not
 * exist are dropped; a refusal is written from the reasons alone, and a
 * failed writer yields null for the caller's fallback.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const sentinel = require("../src/lib/sentinel");
const agent = require("../src/lib/readingAgent");

const blocks = agent.blocksFromStory([
  { type: "paragraph", html: "The array steers nulls toward interferers.", sourceRefs: [{ passageId: "p1" }] },
  { type: "paragraph", html: "In trials it improved the signal by eleven decibels.", sourceRefs: [{ passageId: "p2" }] },
]);
const passages = [
  { id: "p1", text: "Adaptive antenna arrays reduce interference by steering nulls toward unwanted sources." },
  { id: "p2", text: "In field trials the array improved the signal-to-noise ratio by eleven decibels with one interferer." },
];
const answer = (text, extra = {}) => ({ text, grounding: "story", blockIds: ["b1"], passageIds: ["p1"], ...extra });
const ruling = (o) => async () => ({ text: JSON.stringify({ claims: [], link_or_contact: false, asks_about_reader: false, reading_level: "fits", length: "fits", unchecked_specifics: false, story_answers_it: false, guidance: "", rationale: "r", reasons: [], ...o }), usage: { input: 3 }, model: "judge-m" });
const limits = { maxClaims: 12, claimChars: 300 };

test("the model's verdict, reasons and guidance are carried out as given", async () => {
  const pass = await sentinel.checkAnswer({ answer: answer("It steers nulls."), blocks, passages, question: "q", limits, generate: ruling({ verdict: "pass" }) });
  assert.equal(pass.verdict, "pass");
  assert.equal(pass.judged, true);
  assert.equal(pass.model, "judge-m");
  const revise = await sentinel.checkAnswer({ answer: answer("x"), blocks, passages, question: "q", limits, generate: ruling({ verdict: "revise", reasons: ["not_in_sources", "too_hard", "made_up_reason"], guidance: "Drop the Mars claim." }) });
  assert.equal(revise.verdict, "revise");
  assert.deepEqual(revise.reasons, ["not_in_sources", "too_hard"], "reasons outside the vocabulary are dropped");
  assert.equal(revise.guidance, "Drop the Mars claim.");
  const refuse = await sentinel.checkAnswer({ answer: answer("x"), blocks, passages, question: "q", limits, generate: ruling({ verdict: "refuse", reasons: ["unsuitable"] }) });
  assert.equal(refuse.verdict, "refuse");
});

test("an illegible ruling, or one without a verdict, approves nothing", async () => {
  for (const text of ["I cannot.", JSON.stringify({ claims: [] }), JSON.stringify({ verdict: "maybe" })]) {
    const r = await sentinel.checkAnswer({ answer: answer("Fine."), blocks, passages, question: "q", limits, generate: async () => ({ text }) });
    assert.equal(r.verdict, "refuse", text);
    assert.equal(r.judged, false);
  }
});

test("the prompt shows the whole article, what the answer cites, its grounding and the reader", () => {
  const p = sentinel.buildJudgePrompt({ answer: answer("x", { blockIds: ["b2"], passageIds: ["p2"] }), blocks, passages, question: "why?", audience: "ages_12_14" });
  assert.match(p, /A child: judge suitability for a child/);
  assert.match(p, /\[b1\] The array steers[\s\S]*\[b2\] In trials/, "the whole article");
  assert.match(p, /PASSAGES OF THE PAPER THE ANSWER CITES:\n\[p2\]/);
  assert.ok(!/\[p1\] Adaptive/.test(p), "only what it cites");
  assert.match(p, /THE COMPANION'S GROUNDING: story; cites b2, p2/);
  const notHere = sentinel.buildJudgePrompt({ answer: answer("The article doesn't say.", { grounding: "not_here", blockIds: [], passageIds: [] }), blocks, passages, question: "q", audience: "adults" });
  assert.match(notHere, /THE PAPER'S PASSAGES:\n\[p1\][\s\S]*\[p2\]/, "all passages, to check the story really does not say");
});

test("claims are cleaned: unknown anchors dropped, missing fields read as false", () => {
  const r = sentinel.parseRuling("```json\n" + JSON.stringify({ verdict: "pass", claims: [{ text: "a", in_sources: true, anchor_ids: ["b1", "zz"] }, { text: "" }, { text: "c" }] }) + "\n```", { knownIds: new Set(["b1"]) });
  assert.equal(r.claims.length, 2);
  assert.deepEqual(r.claims[0].anchorIds, ["b1"]);
  assert.equal(r.claims[1].inSources, false);
});

test("a refusal is written from the reasons alone; a failed writer yields null", async () => {
  let prompt = "";
  const w = await sentinel.writeRefusal({ reasons: ["unsuitable"], audience: "ages_8_11", storyTitle: "Arrays", generate: async (req) => { prompt = req.prompt; return { text: JSON.stringify({ text: "Let's stick to the article." }), model: "r-m" }; } });
  assert.equal(w.text, "Let's stick to the article.");
  assert.match(prompt, /REFUSAL TO WRITE: reasons: unsuitable/);
  assert.ok(!/frightening/.test(prompt), "the refused answer is never shown to the writer");
  const failed = await sentinel.writeRefusal({ reasons: ["unsuitable"], generate: async () => { throw new Error("down"); } });
  assert.equal(failed.text, null);
});
