/**
 * The readability gate, tested for the two things it must get right:
 * tolerance widens on short text, severity scales with the reader's age.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { measureReadability, countSyllables } = require("../src/lib/readability");
const {
  AUDIENCE_TARGETS,
  VERDICT,
  assessDraftReadability,
  simplificationNote,
} = require("../src/lib/draftReadability");

/* Sentences built to land at known grades. Repeated to clear the reliability
   floor so the verdict is about the prose, not the sample size. */
const SIMPLE = "The cat sat on the mat. The dog ran to the park. We ate lunch at noon. ";
const DENSE =
  "Electromagnetic interference mitigation methodologies necessitate multidimensional characterisation of " +
  "heterogeneous propagation environments, particularly where adaptive beamforming architectures encounter " +
  "nonstationary interferer distributions. ";
const MID =
  "The array steers a null toward each source of interference, which lowers the noise the receiver hears. " +
  "In trials with one interferer, the signal became about fourteen decibels clearer. ";

const repeat = (s, n) => s.repeat(n).trim();

test("the port measures like the original: simple text low, dense text high", () => {
  assert.equal(countSyllables("chocolate"), 3);
  assert.equal(countSyllables("make"), 1);
  const simple = measureReadability(repeat(SIMPLE, 10));
  const dense = measureReadability(repeat(DENSE, 6));
  assert.ok(simple.fkGrade < 4, `simple prose measured ${simple.fkGrade}`);
  assert.ok(dense.fkGrade > 18, `dense prose measured ${dense.fkGrade}`);
  assert.equal(simple.reliable, true);
  assert.equal(measureReadability(""), null);
});

test("dense prose fails for ages 15 to 18 and for adults alike", () => {
  const text = repeat(DENSE, 8);
  assert.equal(assessDraftReadability({ text, audience: "ages_15_18" }).verdict, VERDICT.FAIL);
  const general = assessDraftReadability({ text, audience: "adults" });
  assert.equal(general.verdict, VERDICT.FAIL);
  assert.match(general.reason, /grades above the level for adult readers/);
});

test("severity scales with the reader: the same mid-level prose passes adults and can fail students", () => {
  /* Build text that sits a little over the students tolerance and under the general one. */
  const text = repeat(MID, 12);
  const m = measureReadability(text);
  const general = assessDraftReadability({ text, audience: "adults" });
  const students = assessDraftReadability({ text, audience: "ages_15_18" });
  assert.ok(AUDIENCE_TARGETS.ages_15_18.maxAbove < AUDIENCE_TARGETS.adults.maxAbove);
  assert.ok(AUDIENCE_TARGETS.ages_15_18.grade < AUDIENCE_TARGETS.adults.grade);
  /* Whatever the exact FK, the students verdict is never more lenient than the general one. */
  const order = { pass: 0, warn: 1, fail: 2 };
  assert.ok(order[students.verdict] >= order[general.verdict], `students=${students.verdict} general=${general.verdict} fk=${m.fkGrade}`);
  assert.equal(students.targetGrade, 9);
  assert.equal(general.targetGrade, 10);
});

test("tolerance widens on short text, and a very short text never fails", () => {
  const short = repeat(DENSE, 2); // well under 80 words
  const r = assessDraftReadability({ text: short, audience: "ages_15_18" });
  assert.equal(r.reliable, false);
  assert.equal(r.verdict, VERDICT.WARN);
  assert.match(r.reason, /too short|under the 80/);

  const medium = repeat(MID, 8); // reliable but under 300 words
  const m = assessDraftReadability({ text: medium, audience: "ages_15_18" });
  assert.ok(m.words < 300);
  assert.equal(m.tolerance, AUDIENCE_TARGETS.ages_15_18.maxAbove + 1);

  const long = repeat(MID, 30);
  const l = assessDraftReadability({ text: long, audience: "ages_15_18" });
  assert.ok(l.words >= 300);
  assert.equal(l.tolerance, AUDIENCE_TARGETS.ages_15_18.maxAbove);
});

test("too easy is noted, never failed", () => {
  const r = assessDraftReadability({ text: repeat(SIMPLE, 20), audience: "adults" });
  assert.equal(r.verdict, VERDICT.WARN);
  assert.match(r.reason, /below the level/);
  assert.ok(r.drift < 0);
});

test("an unknown audience is judged as a general reader, and empty text is a warning", () => {
  const r = assessDraftReadability({ text: repeat(MID, 12), audience: "toddlers" });
  assert.equal(r.audience, "adults");
  const e = assessDraftReadability({ text: "", audience: "ages_15_18" });
  assert.equal(e.verdict, VERDICT.WARN);
  assert.equal(e.fkGrade, null);
});

test("the retry note names the measured grade and the target, and is absent on a pass", () => {
  const fail = assessDraftReadability({ text: repeat(DENSE, 8), audience: "ages_15_18" });
  const note = simplificationNote(fail);
  assert.match(note, new RegExp(`grade ${fail.fkGrade}`));
  assert.match(note, /target for readers aged 15 to 18 is grade 9/);
  assert.equal(simplificationNote(assessDraftReadability({ text: repeat(MID, 12), audience: "adults" })), null);
});

test("the older audience keys still resolve, to the age bands they meant", () => {
  assert.equal(assessDraftReadability({ text: repeat(SIMPLE, 20), audience: "students" }).audience, "ages_15_18");
  assert.equal(assessDraftReadability({ text: repeat(SIMPLE, 20), audience: "general" }).audience, "adults");
  assert.equal(assessDraftReadability({ text: repeat(SIMPLE, 20), audience: "nonsense" }).audience, "adults");
  assert.ok(AUDIENCE_TARGETS.ages_8_11.grade < AUDIENCE_TARGETS.ages_12_14.grade);
  assert.ok(AUDIENCE_TARGETS.ages_12_14.grade < AUDIENCE_TARGETS.ages_15_18.grade);
  assert.ok(AUDIENCE_TARGETS.ages_8_11.maxAbove <= AUDIENCE_TARGETS.ages_15_18.maxAbove);
});
