/**
 * Flesch-Kincaid in the browser, the same formula sd-api applies on the
 * server (sd-api/src/lib/readability.js), so the meter in the workspace and
 * the number stored on the story agree.
 */

export const RELIABLE_WORD_FLOOR = 80;

export const AUDIENCE_TARGETS = {
  ages_8_11: { grade: 4, maxAbove: 1.5, label: "readers aged 8 to 11" },
  ages_12_14: { grade: 7, maxAbove: 2.0, label: "readers aged 12 to 14" },
  ages_15_18: { grade: 9, maxAbove: 2.0, label: "readers aged 15 to 18" },
  adults: { grade: 10, maxAbove: 3.0, label: "adult readers" },
};

/* Keys from before the age bands, still on older stories. */
const ALIASES = { general: "adults", students: "ages_15_18" };

export function normaliseAudience(value) {
  if (Object.prototype.hasOwnProperty.call(AUDIENCE_TARGETS, value)) return value;
  if (Object.prototype.hasOwnProperty.call(ALIASES, value)) return ALIASES[value];
  return "adults";
}

function countSyllables(word) {
  const w = String(word || "").toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const trimmed = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

export function measureReadability(text) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  const sentences = String(text || "").split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
  if (!words.length || !sentences.length) return null;
  const syllables = words.reduce((a, w) => a + countSyllables(w), 0);
  const fkGrade = 0.39 * (words.length / sentences.length) + 11.8 * (syllables / words.length) - 15.59;
  return { words: words.length, sentences: sentences.length, fkGrade: +fkGrade.toFixed(1), reliable: words.length >= RELIABLE_WORD_FLOOR };
}

/** Where the draft sits against its audience: the numbers the meter draws. */
export function assessForAudience(text, audience) {
  const target = AUDIENCE_TARGETS[normaliseAudience(audience)];
  const m = measureReadability(text);
  if (!m) return { target, fkGrade: null, drift: null, tolerance: target.maxAbove, verdict: "warn", reliable: false, words: 0 };
  const tolerance = target.maxAbove + (m.words < 300 ? 1 : 0);
  const drift = +(m.fkGrade - target.grade).toFixed(1);
  const verdict = drift > tolerance ? (m.reliable ? "fail" : "warn") : drift < -3 ? "warn" : "pass";
  return { target, fkGrade: m.fkGrade, drift, tolerance, verdict, reliable: m.reliable, words: m.words };
}
