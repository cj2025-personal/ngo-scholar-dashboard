/**
 * Does a draft read at the level it was written for?
 *
 * ── What this replaces ──────────────────────────────────────────────────────
 * The passage generator stored a measured grade beside each passage and
 * nothing read it. Measured on 2026-09-11 across 235 passages: the claimed
 * grade and the measured grade disagreed by 4.3 levels on average, and an
 * 84-word passage labelled Grade 2 measured at 7.5 and was served to a
 * student. The lesson was not that measuring is pointless; it was that a
 * measurement nothing acts on is. This one gates.
 *
 * Pointed at drafts rather than passages on purpose. Passages regenerate and
 * nobody should spend attention on them; a draft is about to go under a
 * scholar's name and the scholar will read every line of it.
 *
 * ── Two details that took work to get right ─────────────────────────────────
 * Tolerance widens on short text. Under 80 words Flesch-Kincaid is a guess
 * and this never fails a draft on it; under 300 the tolerance opens by a
 * grade, because a handful of sentences is a small sample of how the draft
 * reads. Severity scales with how young the reader is: four grades of
 * overshoot is a hard article for a general adult reader and a wall for a
 * fifteen-year-old, so the students audience is held tighter than the
 * general one.
 *
 * Too easy never fails. Prose a little below target is still readable; the
 * drafter padding sentences to hit a number is worse.
 *
 * Pure. The drafting service decides what to do with a verdict; this file
 * only says what the text measured.
 */

const { measureReadability, RELIABLE_WORD_FLOOR } = require("./readability");

/**
 * Where each audience should read, and how far above that it may sit.
 *
 * `students` is secondary school, roughly grades 9–12, targeted at the low end
 * because the draft is an introduction, not a set text. `general` is the
 * newspaper reader: grade 10 is where broadsheet feature writing measures.
 */
const AUDIENCE_TARGETS = {
  general: { grade: 10, maxAbove: 3.0, label: "a general reader" },
  students: { grade: 9, maxAbove: 2.0, label: "secondary students" },
};
const DEFAULT_AUDIENCE = "general";

/** Under this many words, one more grade of tolerance. */
const SHORT_TEXT_WORDS = 300;
const SHORT_TEXT_EXTRA_GRADES = 1.0;

/** Reported, never failed: this far below target is worth a sentence to the scholar. */
const NOTE_BELOW_GRADES = 3.0;

const VERDICT = { PASS: "pass", WARN: "warn", FAIL: "fail" };

/**
 * @param {object} p
 * @param {string} p.text       the draft's prose, no markup
 * @param {string} [p.audience]
 * @returns {{verdict: "pass"|"warn"|"fail", audience: string, targetGrade: number, fkGrade: number|null, drift: number|null, tolerance: number, reliable: boolean, words: number, reason: string|null}}
 */
function assessDraftReadability({ text, audience }) {
  const key = Object.prototype.hasOwnProperty.call(AUDIENCE_TARGETS, audience) ? audience : DEFAULT_AUDIENCE;
  const target = AUDIENCE_TARGETS[key];
  const m = measureReadability(text);

  if (!m) {
    return {
      verdict: VERDICT.WARN, audience: key, targetGrade: target.grade, fkGrade: null, drift: null,
      tolerance: target.maxAbove, reliable: false, words: 0, reason: "no measurable text",
    };
  }

  const tolerance = target.maxAbove + (m.words < SHORT_TEXT_WORDS ? SHORT_TEXT_EXTRA_GRADES : 0);
  const drift = +(m.fkGrade - target.grade).toFixed(1);
  const base = {
    audience: key, targetGrade: target.grade, fkGrade: m.fkGrade, drift, tolerance,
    reliable: m.reliable, words: m.words,
  };

  if (drift > tolerance) {
    const describe =
      `reads ${drift.toFixed(1)} grades above the level for ${target.label} ` +
      `(Flesch-Kincaid ${m.fkGrade} against a target of ${target.grade}; ${m.avgSyllablesPerWord} syllables per word, ` +
      `${m.avgSentenceWords} words per sentence)`;
    if (!m.reliable) {
      return { ...base, verdict: VERDICT.WARN, reason: `${describe}; only ${m.words} words, under the ${RELIABLE_WORD_FLOOR} needed to measure reliably` };
    }
    return { ...base, verdict: VERDICT.FAIL, reason: describe };
  }

  if (drift < -NOTE_BELOW_GRADES) {
    return {
      ...base, verdict: VERDICT.WARN,
      reason: `reads ${Math.abs(drift).toFixed(1)} grades below the level for ${target.label} (Flesch-Kincaid ${m.fkGrade}); readable, but may feel thin`,
    };
  }

  return { ...base, verdict: VERDICT.PASS, reason: null };
}

/**
 * What to tell the model on a retry, in terms of what it can change.
 * Sentence length and word length are the two levers Flesch-Kincaid sees.
 */
function simplificationNote(assessment) {
  if (!assessment || assessment.verdict !== VERDICT.FAIL) return null;
  const t = AUDIENCE_TARGETS[assessment.audience] || AUDIENCE_TARGETS[DEFAULT_AUDIENCE];
  return (
    `Your previous draft measured at reading grade ${assessment.fkGrade}; the target for ${t.label} is grade ${t.grade}. ` +
    "Shorten sentences to 15–20 words, prefer one- and two-syllable words, and define each technical term in " +
    "the sentence that introduces it. Keep every fact; simplify only the wording."
  );
}

module.exports = {
  AUDIENCE_TARGETS,
  SHORT_TEXT_WORDS,
  SHORT_TEXT_EXTRA_GRADES,
  NOTE_BELOW_GRADES,
  VERDICT,
  assessDraftReadability,
  simplificationNote,
};
