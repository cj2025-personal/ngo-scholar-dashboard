/**
 * The reach judge, tested for the ways it must not let an implication
 * through: no anchor, no verdict, a claim that follows from nothing, and a
 * claim unsuitable for a child — and for leaving the paper's own paragraphs
 * alone, which are the fidelity judge's to check.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { VERDICT, REASON, JUDGE_SCHEMA, buildJudgePrompt, parseJudgeResponse, deriveVerdict, judgeSection, reachNote, REACH_VERSION } = require("../src/lib/reach");

const passages = [
  { id: "p1", text: "The array improved the signal-to-noise ratio by eleven decibels with one interferer." },
  { id: "p2", text: "Performance degrades with more than four interferers." },
];
const paper = (html, refs) => ({ type: "paragraph", html, sourceRefs: refs.map((id) => ({ passageId: id })) });
const ext = (html, refs) => ({ ...paper(html, refs), extension: true });

test("an extension paragraph that builds on nothing is overreach without a model call; the paper's paragraphs are not this judge's", async () => {
  let called = 0;
  const r = await judgeSection({ blocks: [ext("Anything at all.", []), paper("The array improved the signal.", ["p1"])], passages, generate: async () => { called += 1; return { text: "{}" }; } });
  assert.equal(called, 0);
  assert.equal(r.call, null);
  assert.deepEqual(r.failing, [0]);
  assert.equal(r.blocks[0].reach.verdict, VERDICT.OVERREACH);
  assert.equal(r.blocks[0].reach.checks.judged, false);
  assert.equal(r.blocks[0].reach.verifierVersion, REACH_VERSION);
  assert.equal(r.blocks[1].reach, undefined, "a paper paragraph is left to the fidelity judge");
  assert.equal(r.blocks[1].fidelity, undefined);
});

test("one call judges a section's extension paragraphs, shows only their anchors, and names the reader when young", async () => {
  let seen = null;
  const generate = async (req) => {
    seen = req;
    return { text: JSON.stringify({ paragraphs: [
      { index: 1, claims: [{ text: "which means a receiver near a strong source would hear less", verdict: "follows", reason: "", anchor_ids: ["p1"] }] },
      { index: 2, claims: [
        { text: "the same problem faces any crowded band", verdict: "follows", reason: "", anchor_ids: ["p1"] },
        { text: "this method is used in every phone", verdict: "overreach", reason: "outside_fact", anchor_ids: [] },
      ] },
    ] }), usage: { input: 1, output: 1 } };
  };
  const r = await judgeSection({
    blocks: [ext("Which means a receiver near a strong source would hear less.", ["p1"]), ext("The same problem faces any crowded band. This method is used in every phone.", ["p1"]), paper("Eleven decibels.", ["p2"])],
    passages, audience: "ages_8_11", generate,
  });
  assert.equal(seen.responseSchema, JUDGE_SCHEMA);
  assert.equal(seen.temperature, 0);
  assert.ok(seen.prompt.includes("[p1]") && !seen.prompt.includes("[p2]"), "only the anchors are shown");
  assert.match(seen.prompt, /^THE READER: readers aged 8 to 11/m);
  assert.ok(/\(1\) Which means/.test(seen.prompt) && /\(2\) The same problem/.test(seen.prompt));
  assert.ok(!/judge suitability/i.test(buildJudgePrompt({ paragraphs: [{ index: 1, text: "x" }], passages, audience: "adults" })), "an adult reader is not named");
  assert.deepEqual(r.failing, [1]);
  assert.equal(r.blocks[0].reach.verdict, VERDICT.FOLLOWS);
  assert.deepEqual(r.blocks[0].reach.claims[0].anchorIds, ["p1"]);
  assert.equal(r.blocks[1].reach.verdict, VERDICT.PARTIAL);
  assert.deepEqual(r.blocks[1].reach.overreachClaims, ["this method is used in every phone"]);
  assert.deepEqual(r.blocks[1].reach.reasons, ["brings in a fact the paper does not state"]);
  assert.equal(r.blocks[2].reach, undefined);
  assert.equal(r.call.step, "judge_reach");
  assert.equal(r.call.paragraphs, 2);
});

test("the paragraph's verdict is the sum of its claims; nothing follows from nothing; an unsuitable claim is never partial", () => {
  assert.equal(deriveVerdict([]), VERDICT.FOLLOWS);
  const f = { verdict: "follows", reason: null, anchorIds: ["p1"] };
  const o = { verdict: "overreach", reason: REASON.OUTSIDE_FACT, anchorIds: [] };
  assert.equal(deriveVerdict([f, f]), VERDICT.FOLLOWS);
  assert.equal(deriveVerdict([f, o]), VERDICT.PARTIAL);
  assert.equal(deriveVerdict([o]), VERDICT.OVERREACH);
  assert.equal(deriveVerdict([f, f, { verdict: "overreach", reason: REASON.UNSUITABLE, anchorIds: [] }]), VERDICT.OVERREACH);

  const parsed = parseJudgeResponse(JSON.stringify({ paragraphs: [
    { index: 1, claims: [{ text: "follows from nowhere", verdict: "follows", reason: "", anchor_ids: [] }] },
    { index: 2, claims: [{ text: "no reason given", verdict: "overreach", reason: "", anchor_ids: [] }] },
    { index: 3, claims: [{ text: "unknown anchor", verdict: "follows", reason: "", anchor_ids: ["p9"] }] },
  ] }), [1, 2, 3, 4], new Set(["p1"]));
  assert.equal(parsed.get(1).verdict, VERDICT.OVERREACH, "a claim said to follow from no passage does not follow");
  assert.equal(parsed.get(1).claims[0].reason, REASON.DOES_NOT_FOLLOW);
  assert.equal(parsed.get(2).claims[0].reason, REASON.DOES_NOT_FOLLOW, "overreach without a reason is still overreach");
  assert.equal(parsed.get(3).verdict, VERDICT.OVERREACH, "an anchor the judge was not shown does not count");
  assert.equal(parsed.get(4).verdict, VERDICT.OVERREACH, "silence is not support");
  assert.match(parsed.get(4).reasons[0], /no verdict/);
  assert.throws(() => parseJudgeResponse("nope", [1]), /valid JSON/);
  assert.equal(parseJudgeResponse("```json\n{\"paragraphs\":[{\"index\":1,\"claims\":[]}]}\n```", [1]).get(1).verdict, VERDICT.FOLLOWS, "a fenced answer parses; no claims, nothing to dispute");
});

test("the schema is one Vertex will accept: no enum value is empty", () => {
  /* A real run failed with "enum[0]: cannot be empty" on a field that used ""
     to mean "no reason". Fakes accept anything; the API does not. */
  const enums = [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node.enum)) enums.push(node.enum);
    for (const v of Object.values(node)) walk(v);
  };
  walk(JUDGE_SCHEMA);
  assert.ok(enums.length >= 2, "the schema still constrains verdict and reason");
  for (const e of enums) {
    assert.ok(e.every((v) => typeof v === "string" && v.length > 0), `empty enum value in ${JSON.stringify(e)}`);
  }
  const claim = JUDGE_SCHEMA.properties.paragraphs.items.properties.claims.items;
  assert.ok(!claim.required.includes("reason"), "a claim that follows carries no reason");
  assert.equal(claim.properties.reason.nullable, true);
});

test("the retry note quotes the overreaching claims back to the drafter with why each went too far", () => {
  const blocks = [
    { ...ext("a", ["p1"]), reach: { verdict: "partial", claims: [
      { text: "follows fine", verdict: "follows", reason: null, anchorIds: ["p1"] },
      { text: "used in every phone", verdict: "overreach", reason: "outside_fact", anchorIds: [] },
      { text: "the paper proved it", verdict: "overreach", reason: "stated_as_finding", anchorIds: [] },
    ], overreachClaims: ["used in every phone", "the paper proved it"], reasons: [] } },
    { ...ext("b", []), reach: { verdict: "overreach", claims: [], overreachClaims: [], reasons: ["builds on no passage"] } },
  ];
  const note = reachNote(blocks, [0, 1]);
  assert.match(note, /"used in every phone" — brings in a fact the paper does not state/);
  assert.match(note, /"the paper proved it" — states an implication as if the paper found it/);
  assert.ok(!/follows fine/.test(note), "what follows is not quoted back");
  assert.match(note, /builds on no passage/);
  assert.match(note, /names nothing from outside the paper/);
});
