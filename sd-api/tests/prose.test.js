/**
 * Prose measured: the reading grade the formula gives, how a draft's
 * sentences open, and how much of it is the paper's own wording. Counts;
 * what they mean for the reader is a model's to say.
 *
 * Both come from measurement, not opinion. Across seven real drafts every
 * adult article landed below its target and passed, because the readability
 * band had a ceiling and no floor; and three words opened between half and
 * two thirds of every sentence, which nothing counted at all.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { assessDraftReadability, VERDICT } = require("../src/lib/draftReadability");
const { repetition, borrowed, openerCounts, repeatedRuns } = require("../src/lib/checks");
const { AUDIENCES } = require("../src/lib/audiences");

/* Long, clause-carrying sentences: comfortably above a child's grade. */
const HARD = "The apodization procedure, which combines a uniform window with a Chebyshev window, suppresses the sidelobe structure that would otherwise obscure a weaker incident signal arriving from a substantially different bearing. ".repeat(6);
/* Very short sentences of very short words: comfortably below an adult's. */
const SIMPLE = "The array finds the signal. It is a good way. The signal is weak. The array still finds it. We can see it now. The noise is less. ".repeat(12);

test("prose far below its reader now fails, where it used to pass silently", () => {
  const a = assessDraftReadability({ text: SIMPLE, audience: "adults" });
  assert.equal(a.verdict, VERDICT.FAIL, `grade ${a.fkGrade} against target ${a.targetGrade}`);
  assert.equal(a.tooSimple, true);
  assert.match(a.reason, /below the level for adult readers/);
});

test("the youngest band has no floor: simpler than a child needs is right for a child", () => {
  assert.equal(AUDIENCES.ages_8_11.maxBelow, null);
  const a = assessDraftReadability({ text: SIMPLE, audience: "ages_8_11" });
  assert.notEqual(a.verdict, VERDICT.FAIL);
  assert.equal(a.tooSimple, undefined);
});

test("too hard still measures as a failure by the formula", () => {
  const a = assessDraftReadability({ text: HARD, audience: "ages_8_11" });
  assert.equal(a.verdict, VERDICT.FAIL);
  assert.ok(!a.tooSimple);
});

test("the openings are counted; whether the prose drones is the reviewer's reading, with the counts beside it", () => {
  const p = (t) => ({ type: "paragraph", html: t });
  const blocks = [
    p("This is the first point. This is the second point. This is the third point. The array works."),
    p("This is another point. The signal is weak. The noise is loud. The reader cannot tell."),
    p("This is a fifth point. Sidelobes hide it. This is a sixth point. Arrays are useful."),
  ];
  const droning = repetition({ blocks, review: { rhythm: { droning: true, note: "Six sentences open with “This”." } } });
  assert.equal(droning.ok, false);
  assert.equal(droning.judged, true);
  /* "This, This, This" and later "The, The, The": two runs of three — counted, and given to the reviewer as evidence. */
  assert.equal(droning.repeatedRuns, 2);
  assert.equal(droning.openers[0].word, "this");
  assert.match(droning.sentence, /^Six sentences open with “This”\. Varying how sentences open costs nothing and changes no fact\.$/);

  const fine = repetition({ blocks, review: { rhythm: { droning: false, note: "" } } });
  assert.equal(fine.ok, true, "the counts inform; the reviewer decides");
  assert.equal(fine.sentence, null);
  const unread = repetition({ blocks, review: { unchecked: true } });
  assert.equal(unread.ok, null);
  assert.equal(unread.judged, false);
  assert.equal(unread.repeatedRuns, 2, "the counts stand whether or not it was read");
});

test("the counts the reviewer is given are what the prose does", () => {
  const p = (t) => ({ type: "paragraph", html: t });
  const blocks = [p("But a mixed window changes that balance. Readers meet the same trade every day. Readers notice. Readers forget.")];
  assert.deepEqual(openerCounts(blocks).slice(0, 2), [{ word: "readers", n: 3, share: 0.75 }, { word: "but", n: 1, share: 0.25 }]);
  assert.deepEqual(repeatedRuns(blocks), { sentences: 4, runs: 1 });
});

test("a paragraph that retypes the paper is counted, and one that explains it is not", () => {
  const passages = [{
    id: "p1",
    text: "Apodization maintains angular resolution while decreasing sidelobe levels. The two selected window functions are the uniform and Chebyshev windows. Two Bartlett spectra are generated, one with uniform weights and one with Chebyshev weights, and the two spectra are compared point by point at each angle.",
  }];
  /* Close to verbatim: the shape of the real regression, where a change
     aimed at reading level pushed a paragraph to 38% of the paper's wording. */
  const copied = {
    type: "paragraph",
    html: "Apodization maintains angular resolution while decreasing sidelobe levels. The two selected window functions are the uniform and Chebyshev windows. Two Bartlett spectra are generated, one with uniform weights and one with Chebyshev weights.",
  };
  const explained = {
    type: "paragraph",
    html: "Two different weightings of the same antenna are compared angle by angle, and whichever shows less spillover is kept. That keeps a sharp view of where a signal comes from without letting a loud one smear across its quieter neighbour.",
  };
  const r = borrowed({ blocks: [copied, explained], passages });
  assert.equal(r.ok, false);
  assert.deepEqual(r.hits.map((h) => h.block), [1]);
  assert.ok(r.worst > 0.5, `worst ${r.worst}`);
  assert.match(r.sentence, /not the paper retyped/);

  assert.equal(borrowed({ blocks: [explained], passages }).ok, true);
  /* A quote is meant to be word for word, so it is not counted. */
  assert.equal(borrowed({ blocks: [{ ...copied, type: "quote" }], passages }).ok, null);
});
