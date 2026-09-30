/**
 * The agent and the Sentinel, run together.
 *
 * What must hold: a passing answer is returned after one attempt; an answer
 * sent back is tried once more with the reasons and the second is judged;
 * a refusal stops at once; an abort before or between calls ends the work
 * with a named error and nothing is called after it; the abort signal
 * reaches every model call.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const companion = require("../src/lib/companion");
const agent = require("../src/lib/readingAgent");

const blocks = agent.blocksFromStory([{ type: "paragraph", html: "The array steers nulls toward interferers.", sourceRefs: [{ passageId: "p1" }] }]);
const passages = [{ id: "p1", text: "Adaptive antenna arrays reduce interference by steering nulls toward unwanted sources." }];

const answerCall = (text) => ({ functionCalls: [{ name: "answer", args: { text, grounding: "story", block_ids: ["b1"], passage_ids: ["p1"] } }], parts: [], usage: { input: 10, output: 5, total: 15 } });
const judgement = (claims) => ({ text: JSON.stringify({ claims }), usage: { input: 3, output: 2, total: 5 } });
const ok = (text) => ({ text, in_sources: true, anchor_ids: ["b1"], unsuitable: false, personal_data: false, off_topic: false });

test("a passing answer comes back after one attempt, with the steps and the usage", async () => {
  const seen = [];
  const r = await companion.answerQuestion({
    blocks, passages, question: "q", audience: "adults",
    generate: async (req) => { seen.push(req); return answerCall("It steers nulls."); },
    judge: async () => judgement([ok("It steers nulls.")]),
  });
  assert.equal(r.answer.text, "It steers nulls.");
  assert.equal(r.attempts, 1);
  assert.deepEqual(r.steps.map((s) => s.tool), ["answer", "sentinel"]);
  assert.equal(r.usage.length, 2);
  assert.equal(r.check.verdict, "pass");
});

test("an answer sent back is tried once more with the reasons, and the second is what comes back", async () => {
  const openings = [];
  let n = 0;
  const r = await companion.answerQuestion({
    blocks, passages, question: "q",
    generate: async (req) => { openings.push(req.contents[0].parts[0].text); n += 1; return answerCall(n === 1 ? "It was tested on Mars." : "It steers nulls."); },
    judge: async (req) => judgement(/Mars/.test(req.prompt) ? [{ ...ok("It was tested on Mars."), in_sources: false, anchor_ids: [] }] : [ok("It steers nulls.")]),
  });
  assert.equal(r.answer.text, "It steers nulls.");
  assert.equal(r.attempts, 2);
  assert.match(openings[1], /YOUR LAST ANSWER WAS SENT BACK[\s\S]*"It was tested on Mars\."/);
});

test("a refusal stops at once and returns no answer", async () => {
  let generated = 0;
  const r = await companion.answerQuestion({
    blocks, passages, question: "q",
    generate: async () => { generated += 1; return answerCall("This is frightening."); },
    judge: async () => judgement([{ ...ok("This is frightening."), unsuitable: true }]),
  });
  assert.equal(r.answer, null);
  assert.equal(r.check.verdict, "refuse");
  assert.equal(generated, 1);
});

test("an abort ends the work with a named error, and the signal reaches every model call", async () => {
  const control = new AbortController();
  const signals = [];
  await assert.rejects(
    companion.answerQuestion({
      blocks, passages, question: "q", signal: control.signal,
      generate: async (req) => { signals.push(req.signal); control.abort(new Error("the deadline passed")); return answerCall("It steers nulls."); },
      judge: async () => { throw new Error("the Sentinel must not run after an abort"); },
    }),
    (e) => e.name === "AbortError" && /deadline passed/.test(e.message),
  );
  assert.equal(signals.length, 1);
  assert.equal(signals[0], control.signal);

  const already = new AbortController();
  already.abort();
  await assert.rejects(
    companion.answerQuestion({ blocks, passages, question: "q", signal: already.signal, generate: async () => { throw new Error("must not be called"); } }),
    (e) => e.name === "AbortError",
  );
});
