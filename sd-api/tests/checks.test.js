/**
 * The two rule-based checks: a number that is not in the cited passage is a
 * miss, and an article that cites none of the paper's caveats is told so.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const checks = require("../src/lib/checks");

const passages = [
  { id: "p1", text: "The array improved the signal-to-noise ratio by eleven decibels with one interferer and by seven with two. Convergence took between forty and three hundred updates." },
  { id: "p2", text: "Power consumption was measured at 1.8 watts for the processor and 0.6 watts for the four low-noise amplifiers, about 9 hours on a 2,400 mAh battery." },
  { id: "p3", text: "The array was not tested with moving interferers. Multipath in a real building would present many more apparent sources, so the degradation is expected to appear at lower interferer counts. Future work should test a larger array." },
];

test("numbers are read as digits, decimals, thousands, percentages, and words are the same number as digits", () => {
  assert.deepEqual(checks.numbersIn("11 decibels, 1.8 watts, 2,400 mAh, 95% of trials"), ["11", "1.8", "2400", "95"]);
  assert.deepEqual(checks.numbersIn("eleven decibels and forty-three trials, one interferer"), ["11", "43"], "one alone is a pronoun");
  assert.deepEqual(checks.numbersIn("<b>seven</b> with two"), ["7", "2"]);
  assert.deepEqual(checks.numbersIn("seventeen of forty trials, between forty and three hundred updates"), ["17", "40", "40", "300"]);
  assert.deepEqual(checks.numbersIn("two thousand three hundred and twelve, one hundred, half a wavelength"), ["2312", "100", "half"]);
  assert.deepEqual(checks.numbersIn("version v2.5 p10"), [], "a number glued to a word is not a stated number");
});

test("a paper that says seventeen supports an article that says 17", () => {
  const r = checks.numericConsistency({
    blocks: [{ type: "paragraph", html: "In 17 of 40 trials the gain fell by more than 2 decibels; convergence took up to 300 updates.", sourceRefs: [{ passageId: "p1" }] }],
    passages: [{ id: "p1", text: "In seventeen of forty trials the array reduced desired-signal gain by more than two decibels. Convergence took between forty and three hundred updates." }],
  });
  assert.deepEqual(r.misses, []);
  assert.equal(r.numbers, 4);
});

test("a number that appears in a cited passage passes; one that does not is a miss, by block", () => {
  const blocks = [
    { type: "subheading", html: "Results" },
    { type: "paragraph", html: "The array improved the signal by 11 decibels and converged in forty updates.", sourceRefs: [{ passageId: "p1" }] },
    { type: "paragraph", html: "The processor used 1.8 watts, and the whole system ran for about 12 hours.", sourceRefs: [{ passageId: "p2" }] },
    { type: "paragraph", html: "I think twelve is the right figure.", ownView: true },
    { type: "paragraph", html: "A hand-written paragraph with the number 99.", },
  ];
  const r = checks.numericConsistency({ blocks, passages });
  assert.equal(r.checked, 2, "only paragraphs drawn from the paper are checked");
  assert.equal(r.numbers, 4, "11 (as eleven in the paper), forty, 1.8 and 12");
  assert.deepEqual(r.misses, [{ block: 3, number: "12" }]);
  assert.equal(r.ok, false);
  assert.equal(checks.numericConsistency({ blocks: blocks.slice(0, 2), passages }).ok, true);
  assert.equal(checks.numericConsistency({ blocks: [{ type: "paragraph", html: "eleven", sourceRefs: [{ passageId: "p9" }] }], passages }).misses.length, 1, "a passage that does not exist supports nothing");
});

test("passages that state a limitation are found by wording, and an article that cites none is told which it left out", () => {
  assert.deepEqual(checks.limitationPassages(passages), ["p3"]);
  const cites = checks.limitationsCoverage({ blocks: [{ type: "paragraph", html: "x", sourceRefs: [{ passageId: "p3" }] }], passages });
  assert.equal(cites.ok, true);
  assert.equal(cites.heuristic, true);
  assert.match(cites.sentence, /carries the paper's own caveats/);
  const omits = checks.limitationsCoverage({ blocks: [{ type: "paragraph", html: "x", sourceRefs: [{ passageId: "p1" }] }], passages });
  assert.equal(omits.ok, false);
  assert.match(omits.sentence, /cites none of the passages where the paper states its limitations \(p3\)/);
  const none = checks.limitationsCoverage({ blocks: [], passages: passages.slice(0, 2) });
  assert.equal(none.ok, null, "a paper that states no limitation is not a failure");
  assert.equal(none.sentence, null);
});

test("a sentence that reads as a claim about the world is found in paragraphs that go beyond the paper, and nowhere else", () => {
  const ext = (html) => ({ type: "paragraph", html, sourceRefs: [{ passageId: "p1" }], extension: true });
  const r = checks.worldClaims({ blocks: [
    { type: "paragraph", html: "This method is now used in every phone.", sourceRefs: [{ passageId: "p1" }] },
    ext("Which means any receiver in a crowded band faces the same limit. The same idea <b>is widely used</b> in base stations today."),
    ext("Work like this has led to quieter radios. It is the basis of modern arrays."),
    ext("A reader who has strained to hear one voice in a loud room would recognise the problem."),
  ] });
  assert.equal(r.heuristic, true);
  assert.equal(r.checked, 3, "only paragraphs that go beyond the paper are checked");
  assert.deepEqual(r.hits.map((h) => h.block), [2, 3, 3]);
  assert.match(r.hits[0].sentence, /^The same idea is widely used/);
  assert.equal(r.ok, false);
  assert.equal(checks.worldClaims({ blocks: [ext("Which means the same problem would face anyone nearby.")] }).ok, true);
  assert.equal(checks.worldClaims({ blocks: [{ type: "paragraph", html: "It is used everywhere.", sourceRefs: [{ passageId: "p1" }] }] }).ok, null, "nothing beyond the paper, nothing to check");
});

test("paragraphs beyond the paper may not outnumber those drawn from it", () => {
  const paper = { type: "paragraph", html: "a", sourceRefs: [{ passageId: "p1" }] };
  const ext = { ...paper, extension: true };
  const own = { type: "paragraph", html: "mine", ownView: true };
  assert.equal(checks.extensionBudget({ blocks: [paper, paper] }).ok, null);
  const ok = checks.extensionBudget({ blocks: [paper, paper, ext, own, { type: "subheading", html: "h" }] });
  assert.deepEqual([ok.extension, ok.paper, ok.ok], [1, 2, true]);
  assert.match(ok.sentence, /1 paragraph goes beyond the paper, against 2 drawn from it/);
  const over = checks.extensionBudget({ blocks: [paper, ext, ext] });
  assert.equal(over.ok, false);
  assert.match(over.sentence, /2 paragraphs go beyond the paper and only 1 is drawn from it/);
});
