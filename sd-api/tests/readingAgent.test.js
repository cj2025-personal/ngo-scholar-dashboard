/**
 * The reading companion's reducer and loop, against scripted tool calls.
 *
 * What must hold: the story is rendered as numbered text blocks with their
 * citations; a search finds blocks and passages; an answer with no
 * citation, an invented citation, a link, a question about the reader, or
 * too many words is refused with a reason the model can act on; a
 * background definition needs the word to be in the text and carries no
 * digits; the loop stops on a valid answer and reports every step.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const agent = require("../src/lib/readingAgent");

const story = [
  { type: "subheading", html: "What the array does" },
  { type: "paragraph", html: "The array <b>steers nulls</b> toward interferers.", sourceRefs: [{ passageId: "p1" }] },
  { type: "image", imageId: "img1", caption: "An array", alt: "array", width: "body" },
  { type: "paragraph", html: "In trials it improved the signal by eleven decibels.", sourceRefs: [{ passageId: "p2" }] },
  { type: "paragraph", html: "I think this matters for every crowded band.", ownView: true },
];
const passages = [
  { id: "p1", text: "Adaptive antenna arrays reduce interference by steering nulls toward unwanted sources." },
  { id: "p2", text: "In field trials the array improved the signal-to-noise ratio by eleven decibels with one interferer." },
];
const blocks = agent.blocksFromStory(story);
const ctx = { blocks, passages, audience: "ages_8_11" };

test("blocks are numbered text only, images skipped, with plain text and citations", () => {
  assert.equal(blocks.length, 4);
  assert.deepEqual(blocks.map((b) => b.id), ["b1", "b2", "b3", "b4"]);
  assert.equal(blocks[1].text, "The array steers nulls toward interferers.");
  assert.deepEqual(blocks[1].passageIds, ["p1"]);
  assert.match(agent.renderBlocks(blocks), /^\[b2\] \(paragraph\) cites p1: The array steers nulls/m);
  assert.match(agent.renderBlocks(blocks), /^\[b1\] \(subheading\): What the array does$/m);
});

test("read_block returns the block with the passages it cites; a bad index is refused", () => {
  const r = agent.applyTool({ name: "read_block", args: { index: 2 } }, ctx);
  assert.match(r.result, /^\[b2\] \(paragraph\): The array steers nulls/);
  assert.match(r.result, /\[p1\] Adaptive antenna arrays/);
  assert.match(agent.applyTool({ name: "read_block", args: { index: 9 } }, ctx).result, /^refused: there is no block 9; blocks run 1 to 4/);
});

test("search finds blocks and passages by their words, best first", () => {
  const r = agent.applyTool({ name: "search_passages", args: { query: "eleven decibels signal" } }, ctx);
  assert.match(r.result, /\[p2\]/);
  assert.match(r.result, /\[b3\]/);
  assert.ok(!/\[b1\]/.test(r.result));
  assert.match(agent.applyTool({ name: "search_passages", args: { query: "unicorns dancing" } }, ctx).result, /nothing in the story or the paper/);
});

test("an answer from the story must cite, and only things that exist", () => {
  const none = agent.applyTool({ name: "answer", args: { text: "It steers nulls.", grounding: "story", block_ids: [], passage_ids: [] } }, ctx);
  assert.match(none.result, /^refused: an answer from the story must cite/);
  const bad = agent.applyTool({ name: "answer", args: { text: "It steers nulls.", grounding: "story", block_ids: ["b9"], passage_ids: ["p7"] } }, ctx);
  assert.match(bad.result, /^refused: these do not exist: b9, p7/);
  const ok = agent.applyTool({ name: "answer", args: { text: "It steers nulls away from noise.", grounding: "story", block_ids: ["b2", "b2"], passage_ids: ["p1"] } }, ctx);
  assert.equal(ok.finished, true);
  assert.deepEqual(ok.answer.blockIds, ["b2"], "duplicates collapse");
  assert.equal(ok.answer.term, null);
});

test("links, addresses, phone numbers and questions about the reader are refused", () => {
  const ask = (text) => agent.applyTool({ name: "answer", args: { text, grounding: "story", block_ids: ["b2"] } }, ctx).result;
  assert.match(ask("See https://example.com for more."), /^refused: no links/);
  assert.match(ask("Read more at example.org today."), /^refused: no links/);
  assert.match(ask("Email me at kid@example.com."), /^refused: no links/);
  assert.match(ask("Call 020 7946 0958 for help."), /^refused: no phone/);
  assert.match(ask("What is your name and where do you live?"), /^refused: never ask the reader/);
});

test("the word cap depends on the reader", () => {
  const long = Array.from({ length: 95 }, () => "word").join(" ");
  assert.match(agent.applyTool({ name: "answer", args: { text: long, grounding: "story", block_ids: ["b2"] } }, ctx).result, /^refused: 95 words; keep it under 90/);
  const adult = agent.applyTool({ name: "answer", args: { text: long, grounding: "story", block_ids: ["b2"] } }, { ...ctx, audience: "adults" });
  assert.equal(adult.finished, true);
});

test("a background definition needs its word in the text, and no digits", () => {
  const r1 = agent.applyTool({ name: "answer", args: { text: "A null is a quiet direction.", grounding: "background" } }, ctx);
  assert.match(r1.result, /^refused: a background answer names the word/);
  const r2 = agent.applyTool({ name: "answer", args: { text: "A quasar is a bright galaxy.", grounding: "background", term: "quasar" } }, ctx);
  assert.match(r2.result, /^refused: the text never uses “quasar”/);
  const r3 = agent.applyTool({ name: "answer", args: { text: "A null is one of 4 quiet directions.", grounding: "background", term: "nulls" } }, ctx);
  assert.match(r3.result, /^refused: a background definition carries no numbers/);
  const r4 = agent.applyTool({ name: "answer", args: { text: "A null is a direction the array listens to least.", grounding: "background", term: "nulls" } }, ctx);
  assert.equal(r4.finished, true);
  assert.equal(r4.answer.term, "nulls");
});

test("not_here needs no citation and an unknown grounding is refused", () => {
  const r = agent.applyTool({ name: "answer", args: { text: "This article doesn't say.", grounding: "not_here" } }, ctx);
  assert.equal(r.finished, true);
  assert.equal(r.answer.grounding, "not_here");
  assert.match(agent.applyTool({ name: "answer", args: { text: "x", grounding: "guess" } }, ctx).result, /^refused: grounding must be one of/);
});

test("the loop reads, then answers, reporting each step, and stops on a valid answer", async () => {
  const script = [
    { functionCalls: [{ name: "read_block", args: { index: 2 } }], parts: [{ functionCall: { name: "read_block", args: { index: 2 } } }], usage: { input: 1, output: 1, total: 2 } },
    { functionCalls: [{ name: "answer", args: { text: "It points its quiet side at the noise.", grounding: "story", block_ids: ["b2"], passage_ids: ["p1"] } }], parts: [] },
    { functionCalls: [{ name: "answer", args: { text: "never reached", grounding: "not_here" } }], parts: [] },
  ];
  let seen = null;
  const generate = async (req) => {
    seen = seen || req;
    return script.shift();
  };
  const steps = [];
  const r = await agent.runReadingAgent({ blocks, passages, question: "What does paragraph 2 mean?", storyTitle: "Arrays", focusIndex: 2, audience: "ages_8_11", generate, onProgress: async (e) => steps.push(e) });
  assert.equal(r.answer.text, "It points its quiet side at the noise.");
  assert.deepEqual(steps.map((s) => s.tool), ["read_block", "answer"]);
  assert.equal(steps[0].summary, "Reading paragraph 2");
  assert.equal(r.calls.length, 2);
  assert.equal(script.length, 1, "stopped on the answer");
  const opening = seen.contents[0].parts[0].text;
  assert.match(opening, /^THE STORY: Arrays/);
  assert.match(opening, /THE READER IS LOOKING AT: \[b2\]/);
  assert.match(opening, /THE READER ASKS: What does paragraph 2 mean\?$/);
  assert.match(seen.systemInstruction, /children aged 8 to 11/);
  assert.match(seen.systemInstruction, /under 90 words/);
});

test("prose instead of a tool is judged as an answer, refused for want of a citation, and the model is told", async () => {
  const script = [
    { text: "The array steers nulls.", functionCalls: [], parts: [{ text: "The array steers nulls." }] },
    { functionCalls: [{ name: "answer", args: { text: "The array steers nulls.", grounding: "story", block_ids: ["b2"] } }], parts: [] },
  ];
  const seen = [];
  const r = await agent.runReadingAgent({ blocks, passages, question: "q", audience: "adults", generate: async (req) => { seen.push(req); return script.shift(); } });
  assert.equal(r.answer.text, "The array steers nulls.");
  /* The request holds the live conversation, so look for the last tool result in it. */
  const fed = seen[1].contents.findLast((c) => c.role === "user").parts[0].functionResponse.response.result;
  assert.match(fed, /^refused: an answer from the story must cite/);
});

test("a revision note is put before the question on a second try", async () => {
  let opening = "";
  await agent.runReadingAgent({ blocks, passages, question: "q", revise: ["Say only what the passages say."], generate: async (req) => { opening = req.contents[0].parts[0].text; return { functionCalls: [{ name: "answer", args: { text: "ok", grounding: "not_here" } }], parts: [] }; } });
  assert.match(opening, /YOUR LAST ANSWER WAS SENT BACK[\s\S]*- Say only what the passages say\.[\s\S]*THE READER ASKS: q/);
});

test("the loop gives up after the step cap with no answer", async () => {
  const r = await agent.runReadingAgent({ blocks, passages, question: "q", generate: async () => ({ functionCalls: [{ name: "read_block", args: { index: 1 } }], parts: [] }) });
  assert.equal(r.answer, null);
  assert.equal(r.calls.length, agent.MAX_STEPS);
});
