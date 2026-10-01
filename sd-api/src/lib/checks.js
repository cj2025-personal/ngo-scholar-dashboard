"use strict";

/**
 * The checks on a whole article, beside the judges that read each paragraph.
 *
 * Two kinds, kept apart on purpose.
 *
 * ── Counts ──────────────────────────────────────────────────────────────────
 * What a rule measures exactly: every number in a paragraph drawn from the
 * paper must appear in a passage it cites, because "eleven decibels"
 * becoming "twelve" reads as fluent and is wrong; how much of a paragraph is
 * the paper's own six-word runs; how many paragraphs go beyond the paper
 * against those drawn from it; which words open the sentences. Where a count
 * becomes a warning, the line is in the drafting policy.
 *
 * ── Rulings, read here ──────────────────────────────────────────────────────
 * What needs reading is read by a model, and these functions only report it.
 * A sentence beyond the paper that brings in a fact about the world, and the
 * author's own context presented as the paper's finding, are the reach and
 * context judges' claim rulings. Which passages state the paper's caveats is
 * the caveat judge's (agents/caveatJudge.js). A heading that promises what
 * is not said, the scholar's pronoun across sections, and whether the prose
 * drones are the article reviewer's (agents/articleReviewer.js). These used
 * to be word lists; each missed what it was for and flagged what it was not.
 */

const { defaultsFor } = require("./policyDefaults");

const CHECKS_VERSION = "checks-2026.2";

const UNITS = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const MULTIPLIERS = { hundred: 100, thousand: 1000, million: 1000000, billion: 1000000000 };
/* Kept as words: they are quantities a paper states, but not ones digits would replace. */
const FRACTION_WORDS = new Set(["half", "quarter", "third", "twice", "double", "triple"]);
const NUMBER_WORDS = new Set([...Object.keys(UNITS), ...Object.keys(TENS), ...Object.keys(MULTIPLIERS), ...FRACTION_WORDS]);

const plain = (html) =>
  String(html || "").replace(/<[^>]+>/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const sentencesOf = (blocks) => (blocks || [])
  .filter((b) => b.type === "paragraph")
  .flatMap((b) => plain(b.html).split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean));
const firstWord = (s) => (s.split(/\s+/)[0] || "").toLowerCase().replace(/[^a-z]/g, "");

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

/**
 * Whether the article cites any passage where the paper states its own
 * caveats. Which passages those are is the caveat judge's finding; whether
 * the article cites them is a lookup.
 *
 * @param {object} p
 * @param {object[]} p.blocks
 * @param {{ids: string[], caveats?: {id:string, caveat:string}[], unchecked?: boolean, version?: string}|null} p.caveats
 * @returns {{version: string, judged: boolean, limitationIds: string[], citedIds: string[], caveats: object[], ok: boolean|null, sentence: string|null}}
 */
function limitationsCoverage({ blocks, caveats }) {
  const base = { version: CHECKS_VERSION, judged: true, judge: caveats?.version || null, caveats: caveats?.caveats || [] };
  if (!caveats || caveats.unchecked) {
    return { ...base, judged: false, limitationIds: [], citedIds: [], ok: null, sentence: "The paper's own caveats could not be read just now; check the article carries them." };
  }
  const ids = caveats.ids || [];
  if (!ids.length) return { ...base, limitationIds: [], citedIds: [], ok: null, sentence: null };
  const cited = new Set();
  for (const b of blocks || []) for (const r of b.sourceRefs || []) if (ids.includes(r.passageId)) cited.add(r.passageId);
  const citedIds = [...cited];
  const ok = citedIds.length > 0;
  const missing = ids.filter((id) => !cited.has(id));
  const named = (list) => list.map((id) => { const c = base.caveats.find((x) => x.id === id); return c?.caveat ? `${id} (${c.caveat})` : id; }).join(", ");
  return {
    ...base,
    limitationIds: ids,
    citedIds,
    ok,
    sentence: ok
      ? (missing.length ? `The article carries some of the paper's own caveats (${citedIds.join(", ")}); it leaves out ${named(missing)}.` : "The article carries the paper's own caveats.")
      : `The article cites none of the passages where the paper states its limitations: ${named(ids)}. Readers deserve the caveats the authors gave.`,
  };
}

/**
 * Sentences beyond the paper that bring in a fact about the world, as the
 * reach judge ruled them claim by claim. Read off the verdicts on the
 * blocks; nothing is re-judged here.
 * @returns {{version: string, judged: true, checked: number, hits: {block: number, sentence: string}[], ok: boolean|null}}
 */
function worldClaims({ blocks }) {
  const hits = [];
  let checked = 0;
  (blocks || []).forEach((b, i) => {
    if (b.type !== "paragraph" || !b.extension) return;
    checked += 1;
    for (const c of b.reach?.claims || []) {
      if (c.verdict !== "follows" && c.reason === "outside_fact") hits.push({ block: i + 1, sentence: String(c.text).slice(0, 200) });
    }
  });
  return { version: CHECKS_VERSION, judged: true, checked, hits, ok: checked ? hits.length === 0 : null };
}

/**
 * Paragraphs that go beyond the paper against those drawn from it. A count;
 * how many may go beyond per paragraph from the paper is policy.
 * @returns {{version: string, extension: number, context: number, paper: number, ok: boolean|null, sentence: string|null}}
 */
function extensionBudget({ blocks, maxBeyondPerPaper = defaultsFor("drafting").maxBeyondPerPaper }) {
  let extension = 0;
  let context = 0;
  let paper = 0;
  for (const b of blocks || []) {
    if (b.type !== "paragraph") continue;
    /* The author's own context counts as beyond the paper; a bare own-view
       paragraph is the scholar's by hand and is counted neither way. */
    if (b.ownView) { if (b.context) context += 1; continue; }
    if (!Array.isArray(b.sourceRefs) || !b.sourceRefs.length) continue;
    if (b.extension) extension += 1;
    else paper += 1;
  }
  const beyond = extension + context;
  if (!beyond) return { version: CHECKS_VERSION, extension, context, paper, ok: null, sentence: null };
  const ok = beyond <= paper * maxBeyondPerPaper;
  const goes = beyond === 1 ? "goes" : "go";
  /* The split is said only when there is one to say. */
  const parts = context ? ` (${[extension ? `${extension} as implication` : "", `${context} as your own context`].filter(Boolean).join(", ")})` : "";
  return {
    version: CHECKS_VERSION,
    extension,
    context,
    paper,
    ok,
    sentence: ok
      ? `${beyond} paragraph${beyond === 1 ? "" : "s"} ${goes} beyond the paper${parts}, against ${paper} drawn from it.`
      : `${beyond} paragraph${beyond === 1 ? "" : "s"} ${goes} beyond the paper${parts} and only ${paper} ${paper === 1 ? "is" : "are"} drawn from it. An article should rest mostly on what the paper says.`,
  };
}

/**
 * Sentences in the author's own context presented as the paper's finding,
 * as the context judge ruled them claim by claim. Read off the verdicts.
 * @returns {{version: string, judged: true, checked: number, hits: {block: number, sentence: string}[], ok: boolean|null}}
 */
function attributionCues({ blocks }) {
  const hits = [];
  let checked = 0;
  (blocks || []).forEach((b, i) => {
    if (b.type !== "paragraph" || !b.ownView || !b.context) return;
    checked += 1;
    for (const c of b.context.claims || []) {
      if (c.reason === "stated_as_finding") hits.push({ block: i + 1, sentence: String(c.text).slice(0, 200) });
    }
  });
  return { version: CHECKS_VERSION, judged: true, checked, hits, ok: checked ? hits.length === 0 : null };
}

/**
 * Every specific the author's own context brought in from outside the paper,
 * and whether the author has verified it. The story cannot be published while
 * any is unverified; the workspace shows the list.
 * @returns {{version: string, items: {block: number, text: string, kind: string, verified: boolean}[], total: number, unverified: number, ok: boolean|null}}
 */
function verifyList({ blocks }) {
  const items = [];
  (blocks || []).forEach((b, i) => {
    if (b.type !== "paragraph" || !b.ownView || !b.context) return;
    for (const v of Array.isArray(b.context.toVerify) ? b.context.toVerify : []) {
      if (!v || !v.text) continue;
      items.push({ block: i + 1, text: String(v.text), kind: v.kind || "other", verified: v.verified === true });
    }
  });
  const unverified = items.filter((i) => !i.verified).length;
  return { version: CHECKS_VERSION, items, total: items.length, unverified, ok: items.length ? unverified === 0 : null };
}

/**
 * The headings and title the article reviewer found promising something the
 * article and the paper do not say, in the shape the drafter and the page
 * read.
 * @param {{headings: object[], unchecked?: boolean, version?: string}|null} review
 * @returns {{version: string, judged: boolean, checked: number, unsupported: {index: number|null, kind: string, text: string, missing: string[]}[], ok: boolean|null}}
 */
function headingFindings(review) {
  if (!review || review.unchecked) return { version: CHECKS_VERSION, judged: false, checked: 0, unsupported: [], ok: null };
  const unsupported = review.headings.filter((h) => h.promisesUnsaid).map((h) => ({ index: h.index, kind: h.kind, text: h.text, missing: h.unsaid ? [h.unsaid] : [] }));
  return { version: CHECKS_VERSION, judged: true, reviewer: review.version || null, checked: review.headings.length, unsupported, ok: review.headings.length ? unsupported.length === 0 : null };
}

/**
 * Whether the article keeps one pronoun for the scholar throughout. Which
 * pronoun stands for the scholar, in which paragraph, is the article
 * reviewer's reading — a colleague the paper names is not the scholar;
 * whether they agree is a count.
 *
 * @param {object} p
 * @param {{pronouns: {index:number, pronoun:string}[], unchecked?: boolean}|null} p.review
 * @returns {{version: string, judged: boolean, used: string[], ok: boolean|null, sentence: string|null, blocks: number[]}}
 */
function authorPronouns({ review }) {
  if (!review || review.unchecked) return { version: CHECKS_VERSION, judged: false, used: [], ok: null, sentence: null, blocks: [] };
  const seen = new Map();
  for (const { index, pronoun } of review.pronouns || []) seen.set(pronoun, [...(seen.get(pronoun) || []), index]);
  const used = [...seen.keys()];
  if (used.length <= 1) return { version: CHECKS_VERSION, judged: true, used, ok: used.length === 1 ? true : null, sentence: null, blocks: [] };
  /* Whichever is rarer is the one that slipped: name those blocks. */
  const [minor] = [...seen.entries()].sort((a, b) => a[1].length - b[1].length);
  const [major] = [...seen.entries()].sort((a, b) => b[1].length - a[1].length);
  return {
    version: CHECKS_VERSION,
    judged: true,
    used,
    ok: false,
    blocks: minor[1],
    sentence:
      `This article calls the author "${major[0]}" in some paragraphs and "${minor[0]}" in others — ` +
      `"${minor[0]}" in block${minor[1].length === 1 ? "" : "s"} ${minor[1].join(", ")}. ` +
      "One of them is wrong about a real person. Fix it before publishing.",
  };
}

/**
 * The words that open a draft's sentences, most used first: a count, given
 * to the drafter so the next section does not reach for them again, and to
 * the article reviewer as evidence.
 */
function openerCounts(blocks) {
  const sentences = sentencesOf(blocks);
  const counts = {};
  for (const s of sentences) {
    const w = firstWord(s);
    if (w) counts[w] = (counts[w] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([word, n]) => ({ word, n, share: sentences.length ? +(n / sentences.length).toFixed(2) : 0 }));
}

/** How many times three sentences in a row open the same way: a count. */
function repeatedRuns(blocks) {
  const sentences = sentencesOf(blocks);
  let runs = 0;
  let run = 1;
  for (let i = 1; i < sentences.length; i += 1) {
    if (firstWord(sentences[i]) && firstWord(sentences[i]) === firstWord(sentences[i - 1])) { run += 1; if (run === 3) runs += 1; }
    else run = 1;
  }
  return { sentences: sentences.length, runs };
}

/**
 * How much of a paragraph is the paper's own wording: the share of its
 * six-word runs found in the passages. An article is meant to be the paper
 * explained, not the paper retyped; the share that becomes a warning is
 * policy. Quotes are exempt: a quote block is supposed to be word for word.
 */
function borrowed({ blocks, passages, limit = defaultsFor("drafting").borrowLimit }) {
  const words = (t) => plain(t).toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const runs = (list, n) => {
    const out = new Set();
    for (let i = 0; i + n <= list.length; i += 1) out.add(list.slice(i, i + n).join(" "));
    return out;
  };
  const source = runs((passages || []).flatMap((p) => words(p.text)), 6);
  if (!source.size) return { version: CHECKS_VERSION, checked: 0, worst: null, hits: [], ok: null, sentence: null, limit };

  const hits = [];
  let checked = 0;
  (blocks || []).forEach((b, i) => {
    if (b.type !== "paragraph") return;
    const w = words(b.html);
    if (w.length < 20) return;
    checked += 1;
    const mine = [...runs(w, 6)];
    const shared = mine.filter((g) => source.has(g)).length;
    const share = mine.length ? shared / mine.length : 0;
    if (share > limit) hits.push({ block: i + 1, share: +share.toFixed(2), words: w.length });
  });
  const worst = hits.length ? Math.max(...hits.map((h) => h.share)) : 0;
  return {
    version: CHECKS_VERSION, checked, hits, worst: +worst.toFixed(2), limit,
    ok: checked ? hits.length === 0 : null,
    sentence: hits.length
      ? `${hits.length} paragraph${hits.length === 1 ? "" : "s"} repeat${hits.length === 1 ? "s" : ""} the paper's own wording closely (up to ${Math.round(worst * 100)}% of six-word runs: ${hits.map((h) => `block ${h.block}`).join(", ")}). An article is the paper explained, not the paper retyped.`
      : null,
  };
}

/**
 * Whether the prose drones: the article reviewer's reading, with the counts
 * it was given kept beside it.
 * @param {object} p
 * @param {object[]} p.blocks
 * @param {{rhythm: {droning:boolean, note:string}|null, unchecked?: boolean}|null} p.review
 */
function repetition({ blocks, review }) {
  const openers = openerCounts(blocks).slice(0, 3);
  const { sentences, runs } = repeatedRuns(blocks);
  const counts = { version: CHECKS_VERSION, sentences, openers, repeatedRuns: runs };
  if (!review || review.unchecked || !review.rhythm) return { ...counts, judged: false, ok: null, sentence: null };
  const ok = !review.rhythm.droning;
  return {
    ...counts,
    judged: true,
    ok,
    sentence: ok ? null : `${review.rhythm.note || "The sentences open the same way again and again."} Varying how sentences open costs nothing and changes no fact.`,
  };
}

module.exports = {
  CHECKS_VERSION, NUMBER_WORDS,
  numbersIn, numericConsistency, limitationsCoverage, worldClaims, extensionBudget, attributionCues, verifyList,
  headingFindings, authorPronouns, openerCounts, repeatedRuns, borrowed, repetition,
};
