/*
 * How Kivyn writes for each reading age, for the pages that explain it (the
 * front page's "Meet Kivyn"). A mirror of the API's own table,
 * sd-api/src/lib/audiences.js: the brief the model is given, the band the
 * readability gate holds a draft to (Flesch-Kincaid grades above and below
 * the target), and whether what goes beyond the paper is also judged for
 * suitability. tests-e2e/landing.spec.js reads both and fails if they part.
 *
 * Keyed by the same values as DRAFT_AUDIENCES (lib/drafting.js), which
 * holds the labels and grades.
 */
export const READING_BANDS = {
  ages_8_11: {
    brief:
      "children aged 8 to 11. Very short sentences, one idea in each, everyday words. " +
      "Explain every term with an example from daily life. Never talk down.",
    maxAbove: 1.5,
    maxBelow: null,
    young: true,
  },
  ages_12_14: {
    brief:
      "students aged 12 to 14. Short sentences and concrete examples. Define every " +
      "technical term in the sentence that introduces it.",
    maxAbove: 2.0,
    maxBelow: 3.0,
    young: true,
  },
  ages_15_18: {
    brief:
      "students aged 15 to 18. Short sentences and concrete examples. Define every " +
      "technical term in the sentence that introduces it. Do not talk down.",
    maxAbove: 2.0,
    maxBelow: 2.5,
    young: false,
  },
  adults: {
    brief:
      "an interested adult with no background in the field — a curious newspaper reader. " +
      "Plain language; define any technical term the first time it appears.",
    maxAbove: 3.0,
    maxBelow: 2.0,
    young: false,
  },
};

/**
 * A brief in two parts, as a page says it: who the reader is ("children aged
 * 8 to 11") and how Kivyn writes for them (the rest).
 */
export function splitBrief(brief) {
  const at = brief.indexOf(". ");
  if (at < 0) return { readers: brief, rules: "" };
  return { readers: brief.slice(0, at), rules: brief.slice(at + 2) };
}

/*
 * The readers each reading age is for, in plain words, with the age as the
 * small print beside them (chosen 2026-11-18: "One paper, every reader").
 * An age added to the table without a name here still shows, under its own
 * label.
 */
export const READER_NAMES = {
  ages_8_11: { name: "Young readers" },
  ages_12_14: { name: "Middle school" },
  ages_15_18: { name: "High school" },
  adults: { name: "Adults", tag: "Ages 18+" },
};
