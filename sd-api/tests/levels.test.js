/**
 * Reading levels, tested for the rules that keep them honest: what gets
 * rewritten, what is carried, that a level lines up block for block with
 * the article, and that an edited article makes its levels stale.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const levels = require("../src/lib/levels");

const passages = [
  { id: "p1", text: "The array improved the signal-to-noise ratio by eleven decibels with one interferer." },
  { id: "p2", text: "Performance degrades with more than four interferers." },
];
const blocks = [
  { type: "subheading", html: "How it works" },
  { type: "paragraph", html: "The array improved the signal by <b>eleven</b> decibels.", sourceRefs: [{ passageId: "p1" }], traceable: true, draftedText: "The array improved the signal by eleven decibels." },
  { type: "quote", html: "Performance degrades with more than four interferers.", sourceRefs: [{ passageId: "p2" }] },
  { type: "paragraph", html: "This is my own reading of it.", ownView: true },
  { type: "paragraph", html: "Something the scholar wrote from scratch.", sourceRefs: [{ passageId: "p2" }], traceable: false },
  { type: "image", imageId: "img1", caption: "Illustration: an array", alt: "an array", width: "body" },
];

test("every band but the story's own is a target, and a request narrows it", () => {
  assert.deepEqual(levels.targetsFor("adults"), ["ages_8_11", "ages_12_14", "ages_15_18"]);
  assert.deepEqual(levels.targetsFor("ages_15_18", ["adults", "ages_8_11"]), ["ages_8_11", "adults"]);
  assert.deepEqual(levels.targetsFor("general", ["students"]), ["ages_15_18"], "older keys resolve to their bands");
  assert.deepEqual(levels.targetsFor("adults", ["adults"]), [], "the story's own band is never a target");
});

test("only a paragraph still drawn from the paper is rewritten; the rest is carried", () => {
  const plan = levels.levelPlan(blocks);
  assert.deepEqual(plan.map((p) => p.rewrite), [false, true, false, false, false, false]);
});

test("the prompt shows only the cited passages, the paragraph in plain text, and the two readers", () => {
  const prompt = levels.buildLevelPrompt({ scholar: { name: "Test Scholar" }, title: "T", block: blocks[1], passages, audience: "ages_8_11", sourceAudience: "adults" });
  assert.ok(prompt.includes("[p1]") && !prompt.includes("[p2]"), "only the cited passage");
  assert.ok(prompt.includes(levels.LEVEL_MARKER));
  assert.ok(prompt.endsWith("The array improved the signal by eleven decibels."), "plain text, no markup");
  assert.match(prompt, /children aged 8 to 11/);
  assert.match(prompt, /curious newspaper reader/);
  assert.match(prompt, /never as Test Scholar/);
  assert.match(levels.buildLevelPrompt({ block: blocks[1], passages, audience: "adults", sourceAudience: "adults", strictVoice: true }), /previous attempt used first-person/);
});

test("a level lines up block for block, rewritten paragraphs keep their passages, and everything else is carried", () => {
  const rewrites = new Map([[1, { text: "The array made the signal eleven decibels clearer.", fidelity: { verdict: "supported", claims: [] } }]]);
  const level = levels.assembleLevel({ blocks, rewrites });
  assert.equal(level.length, blocks.length);
  assert.equal(level[0].html, "How it works");
  assert.equal(level[1].html, "The array made the signal eleven decibels clearer.");
  assert.deepEqual(level[1].sourceRefs, [{ passageId: "p1" }]);
  assert.equal(level[1].fidelity.verdict, "supported");
  assert.equal(level[2].html, blocks[2].html, "a quote is carried verbatim");
  assert.equal(level[3].ownView, true);
  assert.equal(level[4].html, blocks[4].html, "the scholar's own rewrite is carried, not rewritten");
  assert.equal(level[5].type, "image");
  assert.equal(level[5].imageId, "img1");
  const escaped = levels.assembleLevel({ blocks, rewrites: new Map([[1, { text: "a < b & c" }]]) });
  assert.equal(escaped[1].html, "a &lt; b &amp; c");
});

test("the writer's answer is parsed, bounded, and checked for voice", () => {
  assert.equal(levels.parseLevelResponse('{"text":"  The array  helped. "}').text, "The array helped.");
  assert.equal(levels.parseLevelResponse("```json\n{\"text\":\"Fenced.\"}\n```").text, "Fenced.");
  assert.throws(() => levels.parseLevelResponse("nope"), /valid JSON/);
  assert.throws(() => levels.parseLevelResponse('{"text":"   "}'), /empty/);
  const v = levels.parseLevelResponse('{"text":"I built this array myself. It worked."}');
  assert.equal(v.violations.length, 1);
});

test("a level records what it was made from, and an edit to the article makes it stale", () => {
  const level = { source_hashes: levels.sourceHashes(blocks) };
  assert.deepEqual(levels.staleness(level, blocks), { stale: false, reason: null });
  const edited = blocks.map((b, i) => (i === 1 ? { ...b, html: "The array improved the signal by <b>twelve</b> decibels." } : b));
  const st = levels.staleness(level, edited);
  assert.equal(st.stale, true);
  assert.match(st.reason, /block 2 changed/);
  assert.equal(levels.staleness(level, blocks.slice(0, 3)).stale, true, "a different number of blocks is stale");
  assert.equal(levels.staleness({}, blocks).stale, true, "a level with no record of its source is stale");
  const markupOnly = blocks.map((b, i) => (i === 1 ? { ...b, html: "The array improved the signal by <i>eleven</i> decibels." } : b));
  assert.equal(levels.staleness(level, markupOnly).stale, false, "markup is not a change; the words are");
});
