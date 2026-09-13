/**
 * Flesch-Kincaid, measured the same way user-dashboard-api measures it.
 *
 * A port of `backend/src/lib/readability.ts` from that repo — same syllable
 * heuristic, same sentence split, same reliability floor — so a grade this
 * service reports for a draft means the same thing as the grade that service
 * stores on a passage. Two services with two formulas would give one text two
 * grades, and the argument about which is right would replace the reading.
 *
 * The caution the callers rely on: FK is noisy under 80 words, where one long
 * sentence moves the score by more than a grade. `reliable` says so, and no
 * caller should reject on an unreliable measurement.
 */

const RELIABLE_WORD_FLOOR = 80;

/** Vowel-group syllable estimate. Consistent rather than perfect. */
function countSyllables(word) {
  const w = String(word || "").toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const trimmed = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

function splitSentences(text) {
  return String(text || "")
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function splitWords(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean);
}

/**
 * @returns {{words:number, sentences:number, syllables:number, avgSentenceWords:number, avgSyllablesPerWord:number, fkGrade:number, reliable:boolean}|null}
 */
function measureReadability(text) {
  const words = splitWords(text);
  const sentences = splitSentences(text);
  if (!words.length || !sentences.length) return null;

  const syllables = words.reduce((a, w) => a + countSyllables(w), 0);
  const avgSentenceWords = words.length / sentences.length;
  const avgSyllablesPerWord = syllables / words.length;
  const fkGrade = 0.39 * avgSentenceWords + 11.8 * avgSyllablesPerWord - 15.59;

  return {
    words: words.length,
    sentences: sentences.length,
    syllables,
    avgSentenceWords: +avgSentenceWords.toFixed(2),
    avgSyllablesPerWord: +avgSyllablesPerWord.toFixed(3),
    fkGrade: +fkGrade.toFixed(1),
    reliable: words.length >= RELIABLE_WORD_FLOOR,
  };
}

module.exports = { RELIABLE_WORD_FLOOR, countSyllables, splitSentences, splitWords, measureReadability };
