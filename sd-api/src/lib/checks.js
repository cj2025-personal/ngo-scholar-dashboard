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
 *
 * ── Claims about the world ──────────────────────────────────────────────────
 * A paragraph that goes beyond the paper may say what follows from it; it
 * may not say what is done with it. "Is used in", "has led to", "is the
 * basis of" are the wordings by which an implication turns into a fact about
 * the world that the paper does not state. The reach judge looks for the
 * same thing claim by claim; this is the cheap net under it, by wording,
 * and labelled a heuristic.
 *
 * ── Budget ──────────────────────────────────────────────────────────────────
 * An article that is mostly what follows from the paper is no longer about
 * the paper. Paragraphs that go beyond it may not outnumber those drawn from
 * it. A check, not a refusal: the scholar sees the count.
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

/* Wordings by which an implication becomes a claim about the world. */
const WORLD_CLAIM_CUES = [
  /\b(?:is|are|was|were|has been|have been|being)\s+(?:now\s+|widely\s+|already\s+|commonly\s+|routinely\s+|still\s+)?(?:used|applied|adopted|deployed|employed|relied on|built into|found in|standard)\b/i,
  /\b(?:has|have|had)\s+(?:since\s+|already\s+)?(?:led|contributed|given rise)\s+to\b/i,
  /\b(?:is|are|became|become)\s+(?:the|a)\s+(?:basis|foundation|standard|backbone)\s+(?:of|for)\b/i,
  /\b(?:today|nowadays)\b[^.!?]{0,50}\b(?:engineers|companies|manufacturers|networks|phones|devices)\b[^.!?]{0,30}\b(?:use|rely|depend)\b/i,
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

/**
 * Sentences in paragraphs that go beyond the paper which read as claims
 * about the world rather than implications. A heuristic, and labelled so.
 * @returns {{version: string, heuristic: true, checked: number, hits: {block: number, sentence: string}[], ok: boolean|null}}
 */
function worldClaims({ blocks }) {
  const hits = [];
  let checked = 0;
  (blocks || []).forEach((b, i) => {
    if (b.type !== "paragraph" || !b.extension) return;
    checked += 1;
    for (const sentence of plain(b.html).split(/(?<=[.!?])\s+/)) {
      if (WORLD_CLAIM_CUES.some((re) => re.test(sentence))) hits.push({ block: i + 1, sentence: sentence.trim().slice(0, 200) });
    }
  });
  return { version: CHECKS_VERSION, heuristic: true, checked, hits, ok: checked ? hits.length === 0 : null };
}

/**
 * Paragraphs that go beyond the paper against those drawn from it.
 * @returns {{version: string, extension: number, paper: number, ok: boolean|null, sentence: string|null}}
 */
function extensionBudget({ blocks }) {
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
  const ok = beyond <= paper;
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

/* Wordings by which the author's own context puts itself under the paper's authority. */
const ATTRIBUTION_CUES = [
  /\b(?:the|this|that|our)\s+(?:paper|study|work|research|article|analysis|results?|findings?|experiments?|trials?)\s+(?:shows?|showed|found|finds|proves?|proved|demonstrat\w*|establish\w*|confirm\w*|reports?|reported|measured)\b/i,
  /\bas\s+(?:the|this)\s+(?:paper|study|work)\s+(?:shows|showed|found|demonstrates|reports)\b/i,
];

/**
 * Sentences in the author's own context that read as the paper's finding.
 * The context judge looks for the same thing claim by claim; this is the
 * cheap net under it, by wording, and labelled a heuristic.
 * @returns {{version: string, heuristic: true, checked: number, hits: {block: number, sentence: string}[], ok: boolean|null}}
 */
function attributionCues({ blocks }) {
  const hits = [];
  let checked = 0;
  (blocks || []).forEach((b, i) => {
    if (b.type !== "paragraph" || !b.ownView || !b.context) return;
    checked += 1;
    for (const sentence of plain(b.html).split(/(?<=[.!?])\s+/)) {
      if (ATTRIBUTION_CUES.some((re) => re.test(sentence))) hits.push({ block: i + 1, sentence: sentence.trim().slice(0, 200) });
    }
  });
  return { version: CHECKS_VERSION, heuristic: true, checked, hits, ok: checked ? hits.length === 0 : null };
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
 * A heading may not name what the article never says.
 *
 * ── The hole this closes ────────────────────────────────────────────────────
 * Every judge and every check above skips a block that is not a paragraph, so
 * headings and the title were the one part of an article nothing read. Asked
 * to link a signal-processing paper to cancer, the drafter obeyed where it
 * could not be caught: the paragraphs said nothing about cancer, because the
 * reach judge forbids it, and the heading over them said "Potential
 * Applications in Cancer Treatment and Protein Folding". A reader skims
 * headings. That one was a lie the whole pipeline was built to prevent.
 *
 * ── Deliberately narrow ─────────────────────────────────────────────────────
 * A heading is flagged only for a word that appears nowhere in the article's
 * prose AND nowhere in the paper. Not "unsupported by this section" — absent
 * from everything the scholar and the paper actually said. "Everyday devices"
 * over prose about phones is fine; "cancer" over prose that never mentions it
 * is not. Generic article words are ignored, because a heading is allowed to
 * frame as well as name.
 */
const HEADING_IGNORE = new Set([
  "the", "and", "for", "with", "from", "that", "this", "what", "when", "where", "which", "how", "why", "into", "over", "under", "about",
  "your", "our", "its", "their", "they", "them", "than", "then", "some", "more", "most", "less", "best", "better", "good", "great",
  "new", "newer", "old", "modern", "today", "now", "here", "there", "also", "still", "just", "even", "only", "very", "much", "many",
  "approach", "approaches", "method", "methods", "way", "ways", "idea", "ideas", "thing", "things", "part", "parts", "case", "cases",
  "matter", "matters", "mattered", "means", "meaning", "important", "importance", "understanding", "overview", "introduction", "conclusion",
  "story", "article", "section", "look", "looking", "make", "makes", "making", "work", "works", "working", "use", "uses", "using", "used",
  "help", "helps", "helping", "find", "finds", "finding", "findings", "see", "seeing", "show", "shows", "showing", "get", "gets",
  "can", "could", "would", "should", "may", "might", "must", "will", "does", "did", "done", "has", "have", "had", "been", "being",
  "one", "two", "three", "four", "five", "first", "second", "third", "next", "last", "other", "others", "another", "both", "all", "any",
  "problem", "problems", "challenge", "challenges", "solution", "solutions", "result", "results", "answer", "answers", "question", "questions",
  "big", "small", "long", "short", "hard", "easy", "simple", "complex", "real", "true", "different", "same", "own", "kind", "kinds", "sort",
  /* Framing a section is not claiming a topic: "Potential applications of X"
     asserts nothing beyond X, and X is what this check is about. */
  "potential", "application", "applications", "apply", "applies", "applying", "applied", "relevance", "relevant", "implication", "implications",
  "impact", "impacts", "future", "beyond", "value", "benefit", "benefits", "advantage", "advantages", "promise", "practice", "practical",
  /* Ordinary English a heading frames with. A verb is not a topic: "Where it
     breaks" claims nothing the prose must contain, and removing that heading
     for the word "breaks" was this check's first false positive. The check is
     for domain nouns an article never mentions, so everyday words are out. */
  "break", "breaks", "broken", "fail", "fails", "failed", "failure", "failures", "struggle", "struggles", "struggling",
  "hide", "hides", "hidden", "hiding", "lose", "loses", "lost", "win", "wins", "keep", "keeps", "take", "takes", "give", "gives",
  "come", "comes", "coming", "goes", "going", "stay", "stays", "read", "reads", "reading", "tell", "tells", "say", "says",
  "need", "needs", "want", "wants", "happen", "happens", "change", "changes", "changed", "improve", "improves", "improved", "improvement",
  "reduce", "reduces", "reduced", "solve", "solves", "solved", "build", "builds", "built", "start", "starts", "stop", "stops",
  "know", "knows", "knowing", "think", "thinks", "learn", "learns", "hear", "hears", "hearing", "listen", "listens", "listening",
  "catch", "catches", "miss", "misses", "missing", "pick", "picks", "picking", "choose", "chooses", "choosing", "choice", "choices",
  "matter", "mattering", "worked", "wrong", "right", "wrongly", "better", "worse", "worst", "harder", "easier", "faster", "slower",
  "inside", "outside", "before", "after", "while", "against", "without", "within", "through", "across", "around", "between", "behind",
  "step", "steps", "test", "tests", "tested", "testing", "check", "checks", "trade", "trades", "limit", "limits", "limited", "limitation", "limitations",
  "found", "paper", "papers", "study", "studies", "research", "author", "authors", "reader", "readers", "people", "someone", "everyone", "anyone",
]);

/* One odd word in a heading is imagery — "Steering silence toward the noise"
   says nothing false about an article that never uses the word "silence".
   Several odd words together is a topic the article does not have, which is
   what "Cancer Treatment and Protein Folding" was. So the check fires on the
   second word, not the first: precision over recall, because a false positive
   costs the scholar a good heading and a miss costs a warning. */
const HEADING_MIN_MISSING = 2;

/**
 * @param {object} p
 * @param {object[]} p.blocks   mapped blocks, subheadings included
 * @param {{id: string, text: string}[]} p.passages
 * @param {string|null} [p.title]  the article's title, checked the same way
 * @returns {{version: string, heuristic: true, checked: number, unsupported: {index: number|null, kind: string, text: string, missing: string[]}[], ok: boolean|null}}
 */
function headingSupport({ blocks, passages, title = null }) {
  const said = new Set();
  const add = (text) => { for (const w of plain(text).toLowerCase().split(/[^a-z0-9]+/)) if (w.length >= 4) said.add(w); };
  for (const b of blocks || []) if (b.type === "paragraph" || b.type === "quote") add(b.html);
  for (const p of passages || []) add(p.text);

  /* A word counts as said if the article or the paper used any form of it.
     Crude stemming, because "steering" over prose that says "steers" is the
     same word and flagging it would cost an honest heading. */
  const stem = (w) => w.replace(/(ing|edly|ed|ies|es|s|ly)$/, "").slice(0, 12);
  const stems = new Set([...said].map(stem));
  const everSaid = (w) => {
    if (said.has(w) || stems.has(stem(w))) return true;
    const st = stem(w);
    if (st.length < 4) return false;
    for (const s of stems) if (s.startsWith(st) || st.startsWith(s)) return true;
    return false;
  };
  const missingIn = (text) => [...new Set(plain(text).toLowerCase().split(/[^a-z0-9]+/))]
    .filter((w) => w.length >= 4 && !HEADING_IGNORE.has(w))
    .filter((w) => !everSaid(w));

  const unsupported = [];
  let checked = 0;
  (blocks || []).forEach((b, i) => {
    if (b.type !== "subheading" && b.type !== "heading") return;
    checked += 1;
    const missing = missingIn(b.html);
    if (missing.length >= HEADING_MIN_MISSING) unsupported.push({ index: i + 1, kind: "heading", text: plain(b.html), missing });
  });
  if (title) {
    checked += 1;
    const missing = missingIn(title);
    if (missing.length >= HEADING_MIN_MISSING) unsupported.push({ index: null, kind: "title", text: String(title), missing });
  }
  return { version: CHECKS_VERSION, heuristic: true, checked, unsupported, ok: checked ? unsupported.length === 0 : null };
}

module.exports = { CHECKS_VERSION, NUMBER_WORDS, WORLD_CLAIM_CUES, ATTRIBUTION_CUES, HEADING_IGNORE, HEADING_MIN_MISSING, numbersIn, numericConsistency, limitationPassages, limitationsCoverage, worldClaims, extensionBudget, attributionCues, verifyList, headingSupport };
