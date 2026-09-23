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
  assert.match(levels.buildLevelPrompt({ block: blocks[1], passages, audience: "adults", sourceAudience: "adults", strictVoice: true }), /previous attempt used first-person/);
});

test("a level keeps the voice the article was written in", () => {
  const args = { scholar: { name: "Test Scholar" }, title: "T", block: blocks[1], passages, audience: "ages_8_11", sourceAudience: "adults" };
  /* The scholar's own account, which is the default: the author is nowhere in it. */
  const own = levels.buildLevelPrompt(args);
  assert.match(own, /Never refer to the author/);
  assert.match(own, /"Test Scholar"/);
  assert.ok(!/never as Test Scholar/.test(own));

  const about = levels.buildLevelPrompt({ ...args, voice: "about" });
  assert.match(about, /never as Test Scholar/);
  assert.ok(!/Never refer to the author/.test(about));
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

test("a paragraph that goes beyond the paper is rewritten for the reader too, with its implications kept, and keeps its kind", () => {
  const ext = { type: "paragraph", html: "Which means any crowded band faces the same limit.", sourceRefs: [{ passageId: "p2" }], traceable: true, draftedText: "Which means any crowded band faces the same limit.", extension: true, reach: { verdict: "follows", claims: [] } };
  const withExt = [...blocks, ext];
  const plan = levels.levelPlan(withExt);
  assert.equal(plan[6].rewrite, true, "a child's version must not carry an adult's implication untouched");
  assert.equal(plan[6].extension, true);
  assert.equal(plan[1].extension, false);

  const prompt = levels.buildLevelPrompt({ scholar: { name: "Test Scholar" }, title: "T", block: ext, passages, audience: "ages_8_11", sourceAudience: "adults" });
  assert.match(prompt, /Keep every\s+implication it draws and draw no new one/);
  assert.match(prompt, /never as findings/);
  assert.match(prompt, /The reader is a child/);
  assert.ok(prompt.includes("[p2]") && !prompt.includes("[p1]"));
  assert.ok(!/Keep every fact the paragraph states/.test(prompt));
  const adult = levels.buildLevelPrompt({ block: ext, passages, audience: "ages_15_18", sourceAudience: "adults" });
  assert.ok(!/The reader is a child/.test(adult));
  assert.ok(!/implication/.test(levels.buildLevelPrompt({ block: blocks[1], passages, audience: "ages_8_11", sourceAudience: "adults" })), "a paper paragraph gets the paper rules");

  const level = levels.assembleLevel({ blocks: withExt, rewrites: new Map([[6, { text: "So any busy place has the same problem.", reach: { verdict: "follows", claims: [] } }]]) });
  assert.equal(level[6].extension, true);
  assert.equal(level[6].reach.verdict, "follows");
  assert.equal(level[6].fidelity, null);
  assert.deepEqual(level[6].sourceRefs, [{ passageId: "p2" }]);
  const carried = levels.assembleLevel({ blocks: withExt, rewrites: new Map() });
  assert.equal(carried[6].extension, true, "carried, it still says what it is");
  assert.equal(carried[6].reach.verdict, "follows");
  assert.ok(!("extension" in carried[1]));
});

/**
 * A story with no paper behind it.
 *
 * The portal let a scholar write an article by hand and then refused to write
 * it for a younger reader, because nothing in it was drawn from a source
 * paper. Offering research to younger readers is the product's whole purpose,
 * so the refusal was the bug, not the missing paper.
 */
const handWritten = [
  { type: "subheading", html: "What I found" },
  { type: "paragraph", html: "Adaptive arrays steer <b>nulls</b> toward unwanted sources." },
  { type: "paragraph", html: "This is my own reading of what that means.", ownView: true },
  { type: "image", imageId: "img1", caption: "An array", alt: "an array", width: "body" },
  { type: "paragraph", html: "   " },
];

test("a hand-written story rewrites every paragraph it has, own view included", () => {
  const plan = levels.levelPlan(handWritten, { selfGrounded: true });
  assert.deepEqual(plan.map((p) => p.rewrite), [false, true, true, false, false]);
  /* An empty paragraph has nothing to rewrite, and a picture is carried. */

  /* Without the flag the same story yields nothing, which is the old refusal. */
  assert.deepEqual(levels.levelPlan(handWritten).map((p) => p.rewrite), [false, false, false, false, false]);
});

test("each paragraph becomes the passage behind its own rewrite", () => {
  const self = levels.selfPassages(handWritten);
  assert.deepEqual(self.map((p) => p.id), ["self-1", "self-2"]);
  assert.equal(self[0].text, "Adaptive arrays steer nulls toward unwanted sources.");
  /* Blank paragraphs, headings and images contribute no passage. */
  assert.equal(self.length, 2);

  const grounded = levels.groundInSelf(handWritten);
  assert.deepEqual(grounded[1].sourceRefs, [{ passageId: "self-1" }]);
  assert.equal(grounded[0].sourceRefs, undefined, "a heading is left alone");
  assert.equal(grounded[4].sourceRefs, undefined, "an empty paragraph is left alone");
});

test("the self-grounded prompt promises no paper and forbids inventing one", () => {
  const grounded = levels.groundInSelf(handWritten);
  const prompt = levels.buildLevelPrompt({
    scholar: { name: "Test Scholar" },
    title: "T",
    block: grounded[1],
    passages: levels.selfPassages(handWritten),
    audience: "ages_8_11",
    sourceAudience: "adults",
    selfGrounded: true,
  });
  assert.match(prompt, /There is no separate source paper/);
  assert.match(prompt, /You have no other source/);
  assert.ok(!prompt.includes("about a paper by"), "it must not imply a paper exists");
  /* The paragraph itself is shown as the passage it is grounded in. */
  assert.ok(prompt.includes("[self-1]"));
});
