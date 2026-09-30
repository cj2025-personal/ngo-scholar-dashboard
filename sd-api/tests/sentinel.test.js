/**
 * The Sentinel, against scripted judgements.
 *
 * What must hold: the deterministic pass catches what it can without a
 * model; a question about the reader refuses on sight; the verdict is
 * derived from the claims and never taken from the model; unsuitable and
 * personal refuse, not-in-sources and off-topic send it back; a background
 * definition is not held to the sources; an illegible judge approves
 * nothing; the revision note names the claims.
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
const judge = (claims) => async () => ({ text: JSON.stringify({ claims }), usage: { input: 1, output: 1, total: 2 }, modelVersion: "t" });
const claim = (text, extra = {}) => ({ text, in_sources: true, anchor_ids: ["b1"], unsuitable: false, personal_data: false, off_topic: false, ...extra });

test("the deterministic pass names what it finds, and finds nothing wrong with a clean answer", () => {
  const clean = sentinel.inspect({ answer: answer("It points its quiet side at the noise."), blocks, passages, audience: "ages_8_11" });
  assert.deepEqual(clean.reasons, []);
  assert.ok(clean.readability);
  const dirty = sentinel.inspect({ answer: answer("See https://example.com. What is your name?", { blockIds: ["b9"] }), blocks, passages, audience: "ages_8_11" });
  assert.deepEqual(dirty.reasons.sort(), ["asks_reader", "bad_citation", "link"]);
  /* One hundred words in one sentence: too long for the reader, and too hard. */
  const long = sentinel.inspect({ answer: answer(Array.from({ length: 100 }, () => "word").join(" ")), blocks, passages, audience: "ages_8_11" });
  assert.deepEqual(long.reasons.sort(), ["too_hard", "too_long"]);
  const digits = sentinel.inspect({ answer: answer("A null is one of 4 directions.", { grounding: "background" }), blocks, passages, audience: "adults" });
  assert.deepEqual(digits.reasons, ["unchecked_specific"]);
});

test("a question about the reader refuses before any model is called", async () => {
  let called = false;
  const r = await sentinel.checkAnswer({ answer: answer("Tell me your name first."), blocks, passages, question: "q", audience: "ages_8_11", generate: async () => { called = true; } });
  assert.equal(r.verdict, "refuse");
  assert.deepEqual(r.reasons, ["asks_reader"]);
  assert.equal(called, false);
  assert.equal(r.judged, false);
});

test("a link sends the answer back without a model call", async () => {
  const r = await sentinel.checkAnswer({ answer: answer("Look at www.example.com."), blocks, passages, question: "q", generate: async () => { throw new Error("not called"); } });
  assert.equal(r.verdict, "rewrite");
  assert.deepEqual(r.reasons, ["link"]);
});

test("the judge's prompt shows only what the answer cites, and says the reader is a child when they are", () => {
  const p = sentinel.buildJudgePrompt({ answer: answer("x", { blockIds: ["b2"], passageIds: [] }), blocks, passages, question: "why?", audience: "ages_12_14" });
  assert.match(p, /Judge suitability for a child/);
  assert.match(p, /\[b2\] In trials/);
  assert.ok(!/\[b1\]/.test(p));
  assert.match(p, /PASSAGES OF THE PAPER THE ANSWER CITES:\n\(none cited\)/);
  assert.match(p, /THE READER ASKED: why\?/);
  assert.match(p, new RegExp(`${sentinel.MARKER} x`));
  assert.ok(!/child/.test(sentinel.buildJudgePrompt({ answer: answer("x"), blocks, passages, question: "q", audience: "adults" })));
});

test("verdicts are derived from the claims: pass, rewrite, refuse", () => {
  const ok = [{ text: "a", inSources: true, anchorIds: ["b1"], unsuitable: false, personalData: false, offTopic: false }];
  assert.deepEqual(sentinel.deriveVerdict(ok, "story"), { verdict: "pass", reasons: [] });
  const outside = [...ok, { text: "b", inSources: false, anchorIds: [], unsuitable: false, personalData: false, offTopic: false }];
  assert.deepEqual(sentinel.deriveVerdict(outside, "story"), { verdict: "rewrite", reasons: ["not_in_sources"] });
  assert.deepEqual(sentinel.deriveVerdict(outside, "not_here"), { verdict: "rewrite", reasons: ["not_in_sources"] }, "a guess dressed as not_here goes back");
  assert.deepEqual(sentinel.deriveVerdict(outside, "background"), { verdict: "pass", reasons: [] }, "a definition is not held to the sources");
  const off = [{ ...ok[0], offTopic: true }];
  assert.deepEqual(sentinel.deriveVerdict(off, "background"), { verdict: "rewrite", reasons: ["off_topic"] });
  const scary = [{ ...ok[0], unsuitable: true }, { ...ok[0], inSources: false }];
  assert.deepEqual(sentinel.deriveVerdict(scary, "story"), { verdict: "refuse", reasons: ["unsuitable"] }, "unsuitable is never partial");
  const personal = [{ ...ok[0], personalData: true }];
  assert.deepEqual(sentinel.deriveVerdict(personal, "story"), { verdict: "refuse", reasons: ["personal_data"] });
});

test("the judge's answer is cleaned: unknown anchors dropped, missing fields read as false", () => {
  const claims = sentinel.parseJudgeResponse("```json\n" + JSON.stringify({ claims: [{ text: "a", in_sources: true, anchor_ids: ["b1", "zz"] }, { text: "", in_sources: true }, { text: "c" }] }) + "\n```", new Set(["b1", "p1"]));
  assert.equal(claims.length, 2);
  assert.deepEqual(claims[0].anchorIds, ["b1"]);
  assert.equal(claims[1].inSources, false);
  assert.equal(claims[1].unsuitable, false);
  assert.equal(sentinel.parseJudgeResponse("not json", new Set()), null);
  assert.equal(sentinel.parseJudgeResponse(JSON.stringify({ nope: [] }), new Set()), null);
});

test("an illegible judge approves nothing", async () => {
  const r = await sentinel.checkAnswer({ answer: answer("Fine."), blocks, passages, question: "q", generate: async () => ({ text: "I cannot." }) });
  assert.equal(r.verdict, "refuse");
  assert.deepEqual(r.reasons, ["judge_unreadable"]);
  assert.equal(r.judged, true);
});

test("a clean answer passes with the judge's claims and call recorded", async () => {
  const r = await sentinel.checkAnswer({ answer: answer("It points its quiet side at the noise."), blocks, passages, question: "q", audience: "ages_8_11", generate: judge([claim("It points its quiet side at the noise.")]) });
  assert.equal(r.verdict, "pass");
  assert.equal(r.claims.length, 1);
  assert.equal(r.call.step, "sentinel");
  assert.equal(r.audience, "ages_8_11");
});

test("the revision note names the claims that were not in the sources", () => {
  const note = sentinel.reviseNote({ reasons: ["not_in_sources", "off_topic"], claims: [{ text: "the array was tested on Mars", inSources: false }], audience: "adults" });
  assert.equal(note.length, 2);
  assert.match(note[0], /"the array was tested on Mars"/);
  assert.match(note[1], /not about the story/);
  assert.match(sentinel.reviseNote({ reasons: ["too_hard"], claims: [], audience: "ages_8_11" })[0], /readers aged 8 to 11/);
});
