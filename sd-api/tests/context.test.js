/**
 * The context judge, tested for what it must catch and what it must leave
 * alone: the author's knowledge worn as the paper's finding; silence from
 * the judge; a claim unfit for a child; the specifics it lists for the
 * author to verify, once each; and the paper's own paragraphs, which are
 * not this judge's.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { VERDICT, REASON, JUDGE_SCHEMA, buildJudgePrompt, parseJudgeResponse, deriveVerdict, judgeSection, contextNote, CONTEXT_VERSION } = require("../src/lib/context");

const passages = [
  { id: "p1", text: "The array improved the signal-to-noise ratio by eleven decibels with one interferer." },
  { id: "p2", text: "Performance degrades with more than four interferers." },
];
const paper = (html, refs) => ({ type: "paragraph", html, sourceRefs: refs.map((id) => ({ passageId: id })) });
const ctx = (html, anchors = []) => ({ type: "paragraph", html, ownView: true, context: { anchorIds: anchors } });

test("nothing to judge means no call; the paper's paragraphs and a bare own-view paragraph are left alone", async () => {
  let called = 0;
  const r = await judgeSection({
    blocks: [paper("Eleven decibels.", ["p1"]), { type: "paragraph", html: "My opinion.", ownView: true }],
    passages, generate: async () => { called += 1; return { text: "{}" }; },
  });
  assert.equal(called, 0);
  assert.equal(r.call, null);
  assert.deepEqual(r.failing, []);
  assert.equal(r.blocks[0].context, undefined);
  assert.equal(r.blocks[1].context, undefined, "own view without a context record is the scholar's, not the drafter's");
});

test("one call judges a section's context paragraphs, shows their anchors, and lists the specifics to verify once each", async () => {
  let seen = null;
  const generate = async (req) => {
    seen = req;
    return { text: JSON.stringify({ paragraphs: [
      { index: 1, claims: [
        { text: "the same problem turns up in the 2.4 GHz band shared by Wi-Fi and Bluetooth", attributed: false, in_passages: false, anchor_ids: [], specifics: [{ text: "2.4 GHz band", kind: "standard" }, { text: "Wi-Fi", kind: "practice" }, { text: "Bluetooth", kind: "practice" }] },
        { text: "the array gained eleven decibels with one interferer", attributed: true, in_passages: true, anchor_ids: ["p1"], specifics: [{ text: "eleven decibels", kind: "number" }] },
        { text: "Wi-Fi receivers face it daily", attributed: false, in_passages: false, anchor_ids: [], specifics: [{ text: "wi-fi", kind: "practice" }] },
      ] },
      { index: 2, claims: [
        { text: "the paper shows the method is used in every phone", attributed: true, in_passages: false, anchor_ids: [], specifics: [{ text: "every phone", kind: "product" }] },
      ] },
    ] }), usage: { input: 1, output: 1 } };
  };
  const r = await judgeSection({
    blocks: [ctx("In practice the same problem turns up in the 2.4 GHz band.", ["p1"]), ctx("The paper shows the method is used in every phone.", ["p1"]), paper("Eleven decibels.", ["p2"])],
    passages, audience: "adults", generate,
  });
  assert.equal(seen.responseSchema, JUDGE_SCHEMA);
  assert.equal(seen.temperature, 0);
  assert.ok(seen.prompt.includes("[p1]") && !seen.prompt.includes("[p2]"), "only the anchors are shown");
  assert.match(seen.prompt, /PARAGRAPHS OF THE AUTHOR'S OWN CONTEXT:/);
  assert.ok(!/THE READER:/.test(seen.prompt), "an adult reader is not named");

  assert.deepEqual(r.failing, [1]);
  const first = r.blocks[0].context;
  assert.equal(first.verdict, VERDICT.CLEAR);
  assert.equal(first.verifierVersion, CONTEXT_VERSION);
  assert.deepEqual(first.checks, { anchored: 1, judged: true, claims: 3 });
  /* Specifics, once each, case-insensitively; every one unverified until the
     author says so — and "eleven decibels" is dropped, because the paper says
     it, so it is not the author's to go and check against the world. */
  assert.deepEqual(first.toVerify.map((v) => v.text), ["2.4 GHz band", "Wi-Fi", "Bluetooth"]);
  assert.ok(first.toVerify.every((v) => v.verified === false));
  assert.deepEqual(first.claims[1].anchorIds, ["p1"], "a claim the passages state keeps its anchor");

  const second = r.blocks[1].context;
  assert.equal(second.verdict, VERDICT.MISATTRIBUTED);
  assert.deepEqual(second.misattributedClaims, ["the paper shows the method is used in every phone"]);
  assert.deepEqual(second.reasons, ["presents the author's own context as something the paper found"]);
  assert.equal(r.blocks[2].context, undefined, "a paper paragraph is the fidelity judge's");
  assert.equal(r.call.step, "judge_context");
});

test("attributed and in the passages is the paper's and fine; attributed and not is the failure; own knowledge is never a failure", () => {
  const known = new Set(["p1"]);
  const rows = parseJudgeResponse(JSON.stringify({ paragraphs: [
    { index: 1, claims: [
      { text: "a", attributed: true, in_passages: true, anchor_ids: ["p1"], specifics: [] },
      { text: "b", attributed: false, in_passages: false, anchor_ids: [], specifics: [] },
      { text: "c", attributed: true, in_passages: false, anchor_ids: [], specifics: [] },
    ] },
    /* Said to be in the passages, by no passage: not in them. Worn as the paper's: a failure. */
    { index: 2, claims: [{ text: "d", attributed: true, in_passages: true, anchor_ids: ["p9"], specifics: [] }] },
  ] }), [1, 2, 3], known);
  assert.equal(rows.get(1).verdict, VERDICT.PARTIAL);
  assert.deepEqual(rows.get(1).misattributedClaims, ["c"]);
  assert.equal(rows.get(1).claims[2].reason, REASON.STATED_AS_FINDING);
  assert.equal(rows.get(2).verdict, VERDICT.MISATTRIBUTED);
  assert.deepEqual(rows.get(2).claims[0].anchorIds, []);
  /* Silence is not clearance. */
  assert.equal(rows.get(3).verdict, VERDICT.MISATTRIBUTED);
  assert.match(rows.get(3).reasons[0], /no verdict/);
});

test("a claim unfit for a child fails the paragraph outright, and the reader is named to the judge", () => {
  assert.equal(deriveVerdict([{ reason: null }, { reason: REASON.UNSUITABLE }]), VERDICT.MISATTRIBUTED);
  assert.equal(deriveVerdict([]), VERDICT.CLEAR);
  const prompt = buildJudgePrompt({ paragraphs: [{ index: 1, text: "x" }], passages, audience: "ages_8_11" });
  assert.match(prompt, /^THE READER: readers aged 8 to 11/m);
});

test("the note on a retry names the sentences and says how to say them instead", () => {
  const blocks = [ctx("x"), ctx("y")];
  blocks[1].context = { verdict: VERDICT.PARTIAL, claims: [{ text: "the paper shows it is used everywhere", reason: REASON.STATED_AS_FINDING }, { text: "fine", reason: null }], reasons: [] };
  const note = contextNote(blocks, [1]);
  assert.match(note, /"the paper shows it is used everywhere" — presents the author's own context as something the paper found/);
  assert.match(note, /never as what the paper showed, found or proved/);
  assert.ok(!note.includes('"fine"'));
});

test("a judge that returns no JSON is an error, not a clearance", () => {
  assert.throws(() => parseJudgeResponse("not json", [1]), /did not return valid JSON/);
});
