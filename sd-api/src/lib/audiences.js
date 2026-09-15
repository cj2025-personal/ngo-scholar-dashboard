"use strict";

/**
 * Who a draft is written for, by age.
 *
 * One table, read by the prompts (the brief the model is given), the
 * readability gate (where the prose should measure, and how far above it
 * may sit) and the UI (the labels). Keys are stable identifiers stored on
 * jobs and stories; the two older keys, `general` and `students`, remain as
 * aliases so stories drafted before the age bands still resolve.
 *
 * Grades are Flesch-Kincaid grade levels. The younger the reader, the
 * tighter the tolerance: a draft is an introduction, not a set text.
 *
 * `young` marks the bands where a paragraph that goes beyond the paper is
 * also judged for suitability: nothing frightening, nothing beyond the
 * reader's world. The reach judge reads it; nothing else does.
 */
const AUDIENCES = {
  ages_8_11: {
    label: "Ages 8 to 11",
    short: "Ages 8–11",
    readers: "readers aged 8 to 11",
    grade: 4,
    maxAbove: 1.5,
    young: true,
    brief:
      "children aged 8 to 11. Very short sentences, one idea in each, everyday words. " +
      "Explain every term with an example from daily life. Never talk down.",
  },
  ages_12_14: {
    label: "Ages 12 to 14",
    short: "Ages 12–14",
    readers: "readers aged 12 to 14",
    grade: 7,
    maxAbove: 2.0,
    young: true,
    brief:
      "students aged 12 to 14. Short sentences and concrete examples. Define every " +
      "technical term in the sentence that introduces it.",
  },
  ages_15_18: {
    label: "Ages 15 to 18",
    short: "Ages 15–18",
    readers: "readers aged 15 to 18",
    grade: 9,
    maxAbove: 2.0,
    brief:
      "students aged 15 to 18. Short sentences and concrete examples. Define every " +
      "technical term in the sentence that introduces it. Do not talk down.",
  },
  adults: {
    label: "Adults",
    short: "Adults",
    readers: "adult readers",
    grade: 10,
    maxAbove: 3.0,
    brief:
      "an interested adult with no background in the field — a curious newspaper reader. " +
      "Plain language; define any technical term the first time it appears.",
  },
};

/** Keys used before the age bands; still accepted, never written again. */
const ALIASES = { general: "adults", students: "ages_15_18" };

const DEFAULT_AUDIENCE = "adults";

const has = (obj, key) => typeof key === "string" && Object.prototype.hasOwnProperty.call(obj, key);

/** The canonical key for any value the client or a stored document may carry. */
function normaliseAudience(value) {
  if (has(AUDIENCES, value)) return value;
  if (has(ALIASES, value)) return ALIASES[value];
  return DEFAULT_AUDIENCE;
}

/** Whether a value names an audience at all, alias included. */
function isAudience(value) {
  return has(AUDIENCES, value) || has(ALIASES, value);
}

module.exports = { AUDIENCES, ALIASES, DEFAULT_AUDIENCE, normaliseAudience, isAudience };
