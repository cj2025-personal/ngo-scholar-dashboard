/**
 * The reading companion's loop, against scripted model turns.
 *
 * What must hold: the story is rendered as numbered text blocks with their
 * citations; each tool call's reason is what the reader sees; search goes to
 * the injected searcher; an answer citing something that does not exist is
 * sent back; follow-ups are capped by policy; clarify needs no citation; the
 * last step allows only the answer; the loop stops on an answer and gives up
 * at the policy's step budget.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const agent = require("../src/lib/readingAgent");

const story = [
  { type: "subheading", html: "What the array does" },
  { type: "paragraph", html: "The array <b>steers nulls</b> toward interferers.", sourceRefs: [{ passageId: "p1" }] },
  { type: "image", imageId: "img1", caption: "An array", alt: "array", width: "body" },
  { type: "paragraph", html: "In trials it improved the signal by eleven decibels.", sourceRefs: [{ passageId: "p2" }] },
];
const passages = [
  { id: "p1", text: "Adaptive antenna arrays reduce interference by steering nulls toward unwanted sources." },
  { id: "p2", text: "In field trials the array improved the signal-to-noise ratio by eleven decibels with one interferer." },
];
const blocks = agent.blocksFromStory(story);
const limits = { maxSteps: 4, maxToolCalls: 6, maxFollowUps: 2 };
const ctx = { blocks, passages, maxFollowUps: 2, search: async () => [{ id: "p2", text: passages[1].text, score: 0.81 }] };
const fc = (name, args) => ({ functionCalls: [{ name, args }], parts: [{ functionCall: { name, args } }], usage: { input: 1, output: 1 }, model: "m1" });

test("blocks are numbered text only, images skipped, with plain text and citations", () => {
  assert.deepEqual(blocks.map((b) => b.id), ["b1", "b2", "b3"]);
  assert.equal(blocks[1].text, "The array steers nulls toward interferers.");
  assert.match(agent.renderBlocks(blocks), /^\[b2\] \(paragraph\) cites p1: The array steers nulls/m);
});

test("read_block returns the block with what it cites; search goes to the searcher, with scores", async () => {
  const r = await agent.applyTool({ name: "read_block", args: { index: 2 } }, ctx);
  assert.match(r.result, /^\[b2\] \(paragraph\): The array steers nulls/);
  assert.match(r.result, /\[p1\] Adaptive antenna arrays/);
  assert.match((await agent.applyTool({ name: "read_block", args: { index: 9 } }, ctx)).result, /there is no block 9/);
  const s = await agent.applyTool({ name: "search", args: { query: "how much better" } }, ctx);
  assert.match(s.result, /^\[p2\] \(similarity 0\.81\) In field trials/);
});

test("an answer must cite only what exists, and carries intent, follow-ups and grounding", async () => {
  const bad = await agent.applyTool({ name: "answer", args: { text: "x", grounding: "story", intent: "explain", block_ids: ["b9"], passage_ids: ["p7"] } }, ctx);
  assert.match(bad.result, /these do not exist: b9, p7/);
  const ok = await agent.applyTool({ name: "answer", args: { text: "It steers nulls.", grounding: "story", intent: "explain", block_ids: ["b2", "b2"], passage_ids: ["p1"], follow_ups: ["a", "b", "c"] } }, ctx);
  assert.equal(ok.finished, true);
  assert.deepEqual(ok.answer.blockIds, ["b2"]);
  assert.deepEqual(ok.answer.followUps, ["a", "b"], "capped by policy");
  assert.equal(ok.answer.intent, "explain");
  const clarify = await agent.applyTool({ name: "answer", args: { text: "Which do you mean, the array or the trials?", grounding: "clarify", intent: "clarify" } }, ctx);
  assert.equal(clarify.finished, true, "a clarifying question needs no citation");
  assert.match((await agent.applyTool({ name: "answer", args: { text: "x", grounding: "guess" } }, ctx)).result, /grounding must be one of/);
});

test("nothing is refused by pattern: links, length and personal wording are the reviewer's to rule on", async () => {
  const long = Array.from({ length: 400 }, () => "word").join(" ");
  const r = await agent.applyTool({ name: "answer", args: { text: `${long} see www.example.com`, grounding: "story", intent: "explain", block_ids: ["b2"] } }, ctx);
  assert.equal(r.finished, true);
});

test("the loop narrates with the model's own reasons, stops on an answer, and records the models", async () => {
  const script = [
    fc("read_block", { index: 2, reason: "Reading the paragraph you tapped" }),
    fc("answer", { text: "It points its quiet side at the noise.", grounding: "story", intent: "explain", block_ids: ["b2"], passage_ids: ["p1"], reason: "Answering" }),
  ];
  let first = null;
  const steps = [];
  const r = await agent.runReadingAgent({ blocks, passages, question: "What does this mean?", storyTitle: "Arrays", focusIndex: 2, audience: "ages_8_11", limits, search: ctx.search, generate: async (req) => { first = first || req; return script.shift(); }, onProgress: async (e) => steps.push(e) });
  assert.equal(r.answer.text, "It points its quiet side at the noise.");
  assert.deepEqual(steps.map((s) => s.summary), ["Reading the paragraph you tapped", "Answering"]);
  assert.deepEqual(r.models, ["m1", "m1"]);
  const opening = first.contents[0].parts[0].text;
  assert.match(opening, /THE READER IS LOOKING AT: \[b2\]/);
  assert.match(first.systemInstruction, /children aged 8 to 11/);
  assert.match(first.systemInstruction, /Decide the length yourself/);
  assert.ok(!/under \d+ words/.test(first.systemInstruction), "no word cap in the prompt");
});

test("the reviewer's guidance and the conversation summary reach the opening", async () => {
  let opening = "";
  await agent.runReadingAgent({ blocks, passages, question: "q", revise: ["Remove the claim about Mars."], threadSummary: "They asked about trials.", history: [{ role: "user", text: "earlier" }, { role: "model", text: "reply" }], limits, generate: async (req) => { opening = req.contents[0].parts[0].text; return fc("answer", { text: "ok", grounding: "not_here", intent: "not_in_story", reason: "r" }); } });
  assert.match(opening, /EARLIER IN THIS CONVERSATION, IN SHORT:\nThey asked about trials\./);
  assert.match(opening, /MOST RECENTLY IN THIS CONVERSATION:\nReader: earlier\nYou: reply/);
  assert.match(opening, /A REVIEWER SENT YOUR LAST ANSWER BACK[\s\S]*- Remove the claim about Mars\.[\s\S]*THE READER ASKS: q$/);
});

test("on the last step only the answer is allowed, and the budget ends the loop", async () => {
  const configs = [];
  const r = await agent.runReadingAgent({ blocks, passages, question: "q", limits: { maxSteps: 3, maxToolCalls: 10, maxFollowUps: 1 }, generate: async (req) => { configs.push(req.toolConfig.functionCallingConfig); return fc("read_block", { index: 1, reason: "reading" }); } });
  assert.equal(r.answer, null);
  assert.equal(configs.length, 3);
  assert.deepEqual(configs[2].allowedFunctionNames, ["answer"]);
  assert.equal(configs[0].allowedFunctionNames, undefined);
});
