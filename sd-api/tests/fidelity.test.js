/**
 * The fidelity judge, tested for the ways it must not let a claim through:
 * no citation, no verdict, and a verdict short of supported.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { VERDICT, JUDGE_SCHEMA, buildJudgePrompt, parseJudgeResponse, deriveVerdict, judgeSection, fidelityNote, FIDELITY_VERSION } = require("../src/lib/fidelity");

const passages = [
  { id: "p1", text: "The array improved the signal-to-noise ratio by eleven decibels with one interferer." },
  { id: "p2", text: "Performance degrades with more than four interferers." },
];
const block = (html, refs) => ({ type: "paragraph", html, sourceRefs: refs.map((id) => ({ passageId: id })) });

test("a paragraph that cites nothing is unsupported without a model call", async () => {
  let called = 0;
  const r = await judgeSection({ blocks: [block("Anything at all.", [])], passages, generate: async () => { called += 1; return { text: "{}" }; } });
  assert.equal(called, 0);
  assert.equal(r.call, null);
  assert.deepEqual(r.failing, [0]);
  assert.equal(r.blocks[0].fidelity.verdict, VERDICT.UNSUPPORTED);
  assert.equal(r.blocks[0].fidelity.checks.judged, false);
  assert.equal(r.blocks[0].fidelity.verifierVersion, FIDELITY_VERSION);
});

test("one call judges a whole section, and only cited passages are shown", async () => {
  let seen = null;
  const generate = async (req) => {
    seen = req;
    return { text: JSON.stringify({ paragraphs: [
      { index: 1, claims: [{ text: "improved the signal by eleven decibels", verdict: "supported", passage_ids: ["p1"], evidence: "The array improved the signal-to-noise ratio by eleven decibels with one interferer." }] },
      { index: 2, claims: [
        { text: "It improved", verdict: "supported", passage_ids: ["p1"], evidence: "The array improved the signal-to-noise ratio" },
        { text: "twelve decibels", verdict: "unsupported", passage_ids: [], evidence: "" },
      ] },
    ] }), usage: { input: 1, output: 1 } };
  };
  const r = await judgeSection({
    blocks: [block("The array improved the signal by eleven decibels.", ["p1"]), block("It improved by twelve decibels.", ["p1"]), { type: "quote", html: "q", sourceRefs: [{ passageId: "p1" }] }],
    passages, generate,
  });
  assert.equal(seen.responseSchema, JUDGE_SCHEMA);
  assert.equal(seen.temperature, 0);
  assert.ok(seen.prompt.includes("[p1]") && !seen.prompt.includes("[p2]"), "only the cited passage is shown");
  assert.ok(/\(1\) The array/.test(seen.prompt) && /\(2\) It improved/.test(seen.prompt));
  assert.deepEqual(r.failing, [1]);
  assert.equal(r.blocks[0].fidelity.verdict, VERDICT.SUPPORTED);
  assert.equal(r.blocks[1].fidelity.verdict, VERDICT.PARTIAL);
  assert.deepEqual(r.blocks[1].fidelity.unsupportedClaims, ["twelve decibels"]);
  assert.equal(r.blocks[0].fidelity.claims.length, 1);
  assert.deepEqual(r.blocks[0].fidelity.claims[0].passageIds, ["p1"]);
  assert.match(r.blocks[0].fidelity.claims[0].evidence, /^The array improved/);
  assert.equal(r.blocks[0].fidelity.checks.claims, 1);
  assert.equal(r.blocks[2].fidelity, undefined, "quotes are verbatim-checked elsewhere, not judged");
  assert.equal(r.call.paragraphs, 2);
});

test("the paragraph's verdict is the sum of its claims, and a claim with no evidence is never supported", () => {
  const sup = { verdict: "supported" };
  const bad = { verdict: "unsupported" };
  assert.equal(deriveVerdict([]), VERDICT.SUPPORTED, "nothing to dispute");
  assert.equal(deriveVerdict([sup, sup]), VERDICT.SUPPORTED);
  assert.equal(deriveVerdict([sup, bad]), VERDICT.PARTIAL);
  assert.equal(deriveVerdict([bad]), VERDICT.UNSUPPORTED);

  /* The model says supported but names no passage: the rule overrides the model. */
  const v = parseJudgeResponse(JSON.stringify({ paragraphs: [{ index: 1, claims: [{ text: "x", verdict: "supported", passage_ids: [], evidence: "y" }] }] }), [1]);
  assert.equal(v.get(1).claims[0].verdict, VERDICT.UNSUPPORTED);
  assert.equal(v.get(1).verdict, VERDICT.UNSUPPORTED);

  /* A passage id the judge was never shown is dropped, and the claim with it if that was its only support. */
  const w = parseJudgeResponse(JSON.stringify({ paragraphs: [{ index: 1, claims: [{ text: "x", verdict: "supported", passage_ids: ["p9"], evidence: "y" }] }] }), [1], new Set(["p1"]));
  assert.equal(w.get(1).verdict, VERDICT.UNSUPPORTED);

  /* A paragraph of definitions and framing has no claims and passes. */
  const d = parseJudgeResponse(JSON.stringify({ paragraphs: [{ index: 1, claims: [] }] }), [1]);
  assert.equal(d.get(1).verdict, VERDICT.SUPPORTED);
  assert.equal(d.get(1).claims.length, 0);
});

test("a missing verdict is unsupported, an unknown verdict is unsupported, the older shape still parses, and garbage is refused", () => {
  const v = parseJudgeResponse(JSON.stringify({ paragraphs: [{ index: 1, verdict: "supported", unsupported_claims: [], reasons: [] }, { index: 2, verdict: "mostly", unsupported_claims: [], reasons: [] }] }), [1, 2, 3]);
  assert.equal(v.get(1).verdict, VERDICT.SUPPORTED, "a verdict-per-paragraph answer is still accepted");
  assert.deepEqual(v.get(1).claims, [], "but it carries no claims to show");
  assert.equal(v.get(2).verdict, VERDICT.UNSUPPORTED);
  assert.equal(v.get(3).verdict, VERDICT.UNSUPPORTED);
  assert.match(v.get(3).reasons[0], /no verdict/);
  assert.throws(() => parseJudgeResponse("nope", [1]), /valid JSON/);
  const fenced = parseJudgeResponse("```json\n" + JSON.stringify({ paragraphs: [{ index: 1, verdict: "supported", unsupported_claims: [], reasons: [] }] }) + "\n```", [1]);
  assert.equal(fenced.get(1).verdict, VERDICT.SUPPORTED);
});

test("the retry note quotes the unsupported claims back to the drafter", () => {
  const blocks = [
    { ...block("a", ["p1"]), fidelity: { verdict: "partial", unsupportedClaims: ["twelve decibels", "in every building"], reasons: [] } },
    { ...block("b", []), fidelity: { verdict: "unsupported", unsupportedClaims: [], reasons: ["cites no passage"] } },
  ];
  const note = fidelityNote(blocks, [0, 1]);
  assert.match(note, /"twelve decibels"/);
  assert.match(note, /cites no passage/);
  assert.match(note, /leave it out/);
  assert.match(buildJudgePrompt({ paragraphs: [{ index: 1, text: "x" }], passages }), /for each of the 1 paragraph/);
});
