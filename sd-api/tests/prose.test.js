/**
 * The two prose rules that are counts rather than taste: how far below its
 * reader a draft may sit, and how much it may repeat itself.
 *
 * Both come from measurement, not opinion. Across seven real drafts every
 * adult article landed below its target and passed, because the readability
 * band had a ceiling and no floor; and three words opened between half and
 * two thirds of every sentence, which nothing counted at all.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { assessDraftReadability, simplificationNote, VERDICT } = require("../src/lib/draftReadability");
const { repetition, borrowed } = require("../src/lib/checks");
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

test("the note for a draft that is too simple asks for fuller sentences and no new facts", () => {
  const note = simplificationNote(assessDraftReadability({ text: SIMPLE, audience: "adults" }));
  assert.match(note, /join sentences/i);
  assert.match(note, /Add no fact that is not already in the draft/);
  /* And it is not the old note pointed the wrong way. */
  assert.ok(!/Shorten sentences/.test(note));
});

test("the youngest band has no floor: simpler than a child needs is right for a child", () => {
  assert.equal(AUDIENCES.ages_8_11.maxBelow, null);
  const a = assessDraftReadability({ text: SIMPLE, audience: "ages_8_11" });
  assert.notEqual(a.verdict, VERDICT.FAIL);
  assert.equal(a.tooSimple, undefined);
});

test("too hard still fails, and its note still says shorten", () => {
  const a = assessDraftReadability({ text: HARD, audience: "ages_8_11" });
  assert.equal(a.verdict, VERDICT.FAIL);
  assert.ok(!a.tooSimple);
  assert.match(simplificationNote(a), /Shorten sentences/);
});

test("repetition is counted: one word carrying the article, runs of three, and paragraphs that join", () => {
  const p = (t) => ({ type: "paragraph", html: t });
  const flat = repetition({ blocks: [
    p("This is the first point. This is the second point. This is the third point. The array works."),
    p("This is another point. The signal is weak. The noise is loud. The reader cannot tell."),
    p("This is a fifth point. Sidelobes hide it. This is a sixth point. Arrays are useful."),
  ] });
  assert.equal(flat.ok, false);
  /* "This, This, This" and later "The, The, The": two runs of three. */
  assert.equal(flat.repeatedRuns, 2, "runs of three opening the same way");
  assert.equal(flat.openers[0].word, "this");
  assert.match(flat.sentence, /sentences begin with “this”/);
  assert.match(flat.sentence, /changes no fact/);
  assert.equal(flat.joinedParagraphs, 0);
});

test("varied prose is not accused of droning just because it is short", () => {
  const p = (t) => ({ type: "paragraph", html: t });
  /* Three distinct openers out of six sentences is 50% of the top three and
     perfectly varied; judging the share alone once called this repetitive. */
  const varied = repetition({ blocks: [
    p("A strong signal hides a weak one, which is the problem the method sets out to solve. Sidelobes are the reason. Weak arrivals vanish beneath them."),
    p("But a mixed window changes that balance. Resolution survives where it matters, because the uniform window keeps the main lobe narrow. Readers meet the same trade every day."),
  ] });
  assert.equal(varied.ok, null, "too few sentences to judge");
  const longer = repetition({ blocks: [
    p("A strong signal hides a weak one, which is the problem the method sets out to solve. Sidelobes are the reason. Weak arrivals vanish beneath them. Resolution survives where it matters."),
    p("But a mixed window changes that balance, because the uniform window keeps the main lobe narrow. Readers meet the same trade every day. Chebyshev weights cost angular sharpness. Apodization takes the better of each."),
    p("Trials bore that out across two, three and four signals. Failures fell. Bias stayed small. Nothing here is free, though."),
  ] });
  assert.equal(longer.ok, true, JSON.stringify(longer));
  assert.equal(longer.joinedParagraphs, 1, "one paragraph opens with a joining word");
});

test("too little text says nothing either way", () => {
  assert.equal(repetition({ blocks: [{ type: "paragraph", html: "One sentence." }] }).ok, null);
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
