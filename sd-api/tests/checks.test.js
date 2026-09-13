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

test("numbers are read as digits, decimals, thousands, percentages and the words a paper uses", () => {
  assert.deepEqual(checks.numbersIn("11 decibels, 1.8 watts, 2,400 mAh, 95% of trials"), ["11", "1.8", "2400", "95"]);
  assert.deepEqual(checks.numbersIn("eleven decibels and forty-three trials, one interferer"), ["eleven", "forty", "three"]);
  assert.deepEqual(checks.numbersIn("<b>seven</b> with two"), ["seven", "two"]);
  assert.deepEqual(checks.numbersIn("version v2.5 p10"), [], "a number glued to a word is not a stated number");
});

test("a number that appears in a cited passage passes; one that does not is a miss, by block", () => {
  const blocks = [
    { type: "subheading", html: "Results" },
    { type: "paragraph", html: "The array improved the signal by eleven decibels and converged in forty updates.", sourceRefs: [{ passageId: "p1" }] },
    { type: "paragraph", html: "The processor used 1.8 watts, and the whole system ran for about 12 hours.", sourceRefs: [{ passageId: "p2" }] },
    { type: "paragraph", html: "I think twelve is the right figure.", ownView: true },
    { type: "paragraph", html: "A hand-written paragraph with the number 99.", },
  ];
  const r = checks.numericConsistency({ blocks, passages });
  assert.equal(r.checked, 2, "only paragraphs drawn from the paper are checked");
  assert.equal(r.numbers, 4, "eleven, forty, 1.8 and 12");
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
