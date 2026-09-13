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

const NUMBER_WORDS = new Set([
  "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
  "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
  "hundred", "thousand", "million", "billion", "half", "quarter", "third", "twice", "double", "triple",
]);

const LIMITATION_CUES = [
  /\blimitation/i, /\blimited\b/i, /\bnot (?:tested|measured|examined|evaluated|studied|assessed)\b/i, /\bdid not\b/i, /\bwas not\b/i, /\bwere not\b/i,
  /\bcannot\b/i, /\bcaveat/i, /\bdegrad/i, /\bfuture work\b/i, /\bfurther (?:work|study|research)\b/i, /\bremains? to be\b/i,
  /\bsmall sample\b/i, /\bsample size\b/i, /\bonly\b/i, /\bexpected to\b/i, /\bwould (?:present|require|need)\b/i, /\bassum/i,
];

const plain = (html) =>
  String(html || "").replace(/<[^>]+>/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

/** The numbers a passage of text states, as normalised tokens. */
function numbersIn(text) {
  const out = [];
  const t = plain(text).toLowerCase();
  for (const m of t.matchAll(/(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(?:\s?%)?(?![\w])/g)) out.push(m[1].replace(/,/g, ""));
  for (const w of t.split(/[^a-z-]+/)) {
    if (NUMBER_WORDS.has(w)) out.push(w);
    else if (w.includes("-")) for (const part of w.split("-")) if (NUMBER_WORDS.has(part)) out.push(part);
  }
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
