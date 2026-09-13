"use strict";

/**
 * Two cheap checks the fact-checker does not make, because a rule makes
 * them better than a model does.
 *
 * ── Numbers ─────────────────────────────────────────────────────────────────
 * A number is where a model slips and where a scholar's reputation is most
 * exposed: "eleven decibels" becoming "twelve" reads as fluent and is wrong.
 * So every number in a paragraph drawn from the paper must appear in one of
 * the passages it cites. Digits, and the number words a paper would use;
 * "one" is left out because it is mostly a pronoun.
 *
 * ── Limitations ─────────────────────────────────────────────────────────────
 * The most-omitted content in any popular account of research is the paper's
 * own caveats. Passages that state a limitation are found by their wording,
 * which is a heuristic and says so; an article that cites none of them is
 * told which ones it left out. It is a check, not a refusal: some papers
 * state no limitations, and the scholar decides.
 */

const CHECKS_VERSION = "checks-2026.1";

const UNITS = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const MULTIPLIERS = { hundred: 100, thousand: 1000, million: 1000000, billion: 1000000000 };
/* Kept as words: they are quantities a paper states, but not ones digits would replace. */
const FRACTION_WORDS = new Set(["half", "quarter", "third", "twice", "double", "triple"]);
const NUMBER_WORDS = new Set([...Object.keys(UNITS), ...Object.keys(TENS), ...Object.keys(MULTIPLIERS), ...FRACTION_WORDS]);

const LIMITATION_CUES = [
  /\blimitation/i, /\blimited\b/i, /\bnot (?:tested|measured|examined|evaluated|studied|assessed)\b/i, /\bdid not\b/i, /\bwas not\b/i, /\bwere not\b/i,
  /\bcannot\b/i, /\bcaveat/i, /\bdegrad/i, /\bfuture work\b/i, /\bfurther (?:work|study|research)\b/i, /\bremains? to be\b/i,
  /\bsmall sample\b/i, /\bsample size\b/i, /\bonly\b/i, /\bexpected to\b/i, /\bwould (?:present|require|need)\b/i, /\bassum/i,
];

const plain = (html) =>
  String(html || "").replace(/<[^>]+>/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

/**
 * The numbers a passage of text states, as canonical tokens.
 *
 * "seventeen of forty trials" and "17 of 40 trials" state the same numbers,
 * so words are read into digits: units, tens, and the multipliers hundred,
 * thousand, million, billion, in the usual English order ("three hundred
 * forty", "two thousand"). "one" counts only as the start of a compound
 * ("one hundred"), because on its own it is mostly a pronoun. Digits keep
 * their decimals; thousands separators and percent signs are dropped.
 */
function numbersIn(text) {
  const out = [];
  const t = plain(text).toLowerCase();
  for (const m of t.matchAll(/(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(?:\s?%)?(?![\w])/g)) out.push(m[1].replace(/,/g, ""));

  /* Punctuation and digits become a separator token, so "twelve, one hundred" is two numbers, not one. */
  const words = t.replace(/[^a-z\s-]+/g, " | ").split(/[\s-]+/).filter(Boolean);
  let total = 0;
  let current = 0;
  let inNumber = false;
  let afterMultiplier = false;
  const flush = () => {
    if (inNumber && total + current > 0) out.push(String(total + current));
    total = 0; current = 0; inNumber = false; afterMultiplier = false;
  };
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i];
    if (UNITS[w] !== undefined) { current += UNITS[w]; inNumber = true; afterMultiplier = false; continue; }
    if (TENS[w] !== undefined) { current += TENS[w]; inNumber = true; afterMultiplier = false; continue; }
    if (w === "one" && MULTIPLIERS[words[i + 1]] !== undefined) { current += 1; inNumber = true; afterMultiplier = false; continue; }
    if (MULTIPLIERS[w] !== undefined) {
      if (w === "hundred") current = (current || 1) * 100;
      else { total += (current || 1) * MULTIPLIERS[w]; current = 0; }
      inNumber = true;
      afterMultiplier = true;
      continue;
    }
    /* "three hundred and forty" is one number; "forty and three hundred" is two. */
    if (w === "and" && inNumber && afterMultiplier) continue;
    if (FRACTION_WORDS.has(w)) { flush(); out.push(w); continue; }
    flush();
  }
  flush();
  return out;
}

/**
 * Every number in a paragraph drawn from the paper must appear in a passage
 * it cites.
 * @param {object} p
 * @param {object[]} p.blocks     mapped blocks: html, sourceRefs, ownView
 * @param {{id: string, text: string}[]} p.passages
 * @returns {{version: string, checked: number, numbers: number, misses: {block: number, number: string}[], ok: boolean}}
 */
function numericConsistency({ blocks, passages }) {
  const byId = new Map((passages || []).map((p) => [p.id, new Set(numbersIn(p.text))]));
  const misses = [];
  let checked = 0;
  let numbers = 0;
  (blocks || []).forEach((b, i) => {
    if (b.type !== "paragraph" || b.ownView || !Array.isArray(b.sourceRefs) || !b.sourceRefs.length) return;
    checked += 1;
    const cited = b.sourceRefs.map((r) => byId.get(r.passageId)).filter(Boolean);
    for (const n of new Set(numbersIn(b.html))) {
      numbers += 1;
      if (!cited.some((set) => set.has(n))) misses.push({ block: i + 1, number: n });
    }
  });
  return { version: CHECKS_VERSION, checked, numbers, misses, ok: misses.length === 0 };
}

/** The passages that read as stating a limitation, by their wording. A heuristic, and labelled so. */
function limitationPassages(passages) {
  return (passages || []).filter((p) => LIMITATION_CUES.filter((re) => re.test(p.text)).length >= 2).map((p) => p.id);
}

/**
 * Whether the article cites any passage that states a limitation.
 * @returns {{version: string, heuristic: true, limitationIds: string[], citedIds: string[], ok: boolean|null, sentence: string|null}}
 */
function limitationsCoverage({ blocks, passages }) {
  const ids = limitationPassages(passages);
  if (!ids.length) return { version: CHECKS_VERSION, heuristic: true, limitationIds: [], citedIds: [], ok: null, sentence: null };
  const cited = new Set();
  for (const b of blocks || []) for (const r of b.sourceRefs || []) if (ids.includes(r.passageId)) cited.add(r.passageId);
  const citedIds = [...cited];
  const ok = citedIds.length > 0;
  const missing = ids.filter((id) => !cited.has(id));
  return {
    version: CHECKS_VERSION,
    heuristic: true,
    limitationIds: ids,
    citedIds,
    ok,
    sentence: ok
      ? (missing.length ? `The article carries some of the paper's own caveats (${citedIds.join(", ")}); it leaves out ${missing.join(", ")}.` : "The article carries the paper's own caveats.")
      : `The article cites none of the passages where the paper states its limitations (${ids.join(", ")}). Readers deserve the caveats the authors gave.`,
  };
}

module.exports = { CHECKS_VERSION, NUMBER_WORDS, numbersIn, numericConsistency, limitationPassages, limitationsCoverage };
