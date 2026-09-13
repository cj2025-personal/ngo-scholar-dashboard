/**
 * The drafter's prompt and output checks, tested for the ways they fail.
 *
 * The failure this file exists to prevent is a paragraph in the first person,
 * or a quotation that is not in the paper, reaching the editor under a named
 * living scholar's byline. The model is asked not to do either; these tests
 * cover what happens when it does anyway.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PROMPT_VERSION,
  AUDIENCES,
  DEFAULT_AUDIENCE,
  LIMITS,
  RESPONSE_SCHEMA,
  normaliseAudience,
  prepareSourceText,
  buildSystemInstruction,
  buildDraftPrompt,
  parseDraftResponse,
  firstPersonSentences,
  isVerbatim,
} = require("../src/lib/draftComposer");

const PAPER =
  "Adaptive antenna arrays reduce interference by steering nulls toward unwanted sources. " +
  "In field trials the array improved the signal-to-noise ratio by 11 dB. " +
  "The authors note that performance degrades when more than four interferers are present.\n\n" +
  "Second section. The method relies on a least-mean-squares update.";

function response(overrides = {}) {
  return JSON.stringify({
    title: "Steering silence toward the noise",
    deck: "A trial of adaptive antenna arrays cut interference by 11 dB.",
    blocks: [
      { kind: "paragraph", text: "Adaptive arrays steer nulls toward interferers. ".repeat(30) },
      { kind: "heading", text: "What the trial found" },
      { kind: "quote", text: "the array improved the signal-to-noise ratio by 11 dB" },
      { kind: "paragraph", text: "Performance degrades with more than four interferers. ".repeat(20) },
    ],
    ...overrides,
  });
}

/* ── audiences ─────────────────────────────────────────────────────────── */

test("an unknown audience falls back to the default rather than failing", () => {
  assert.equal(normaliseAudience("students"), "ages_15_18");
  assert.equal(normaliseAudience("ages_8_11"), "ages_8_11");
  assert.equal(normaliseAudience("toddlers"), DEFAULT_AUDIENCE);
  assert.equal(normaliseAudience(undefined), DEFAULT_AUDIENCE);
  assert.ok(AUDIENCES[DEFAULT_AUDIENCE].brief.length > 20);
});

/* ── source preparation ────────────────────────────────────────────────── */

test("a paper under budget passes through with its word count", () => {
  const r = prepareSourceText(PAPER);
  assert.equal(r.truncated, false);
  assert.equal(r.words, r.totalWords);
  assert.equal(r.text, PAPER);
});

test("a paper over budget is cut at a paragraph boundary and flagged", () => {
  const long = `${"alpha beta gamma delta. ".repeat(50)}\n\n${"epsilon zeta. ".repeat(50)}`;
  const r = prepareSourceText(long, 150);
  assert.equal(r.truncated, true);
  assert.ok(r.words <= 150);
  assert.ok(r.totalWords > 150);
  // Cut fell back to the paragraph break, so nothing from the second section leaked in.
  assert.ok(!r.text.includes("epsilon"));
});

test("empty text is empty, not a crash", () => {
  const r = prepareSourceText("");
  assert.equal(r.words, 0);
  assert.equal(r.text, "");
});

/* ── prompt ────────────────────────────────────────────────────────────── */

test("the prompt carries the paper, the audience brief and the scholar's name", () => {
  const p = buildDraftPrompt({
    scholar: { name: "Ada Lovelace", field: "computing" },
    source: { title: "Notes on the Engine", year: 1843, origin: "harvested" },
    text: PAPER,
    audience: "ages_15_18",
  });
  assert.match(p, /Ada Lovelace \(computing\)/);
  assert.match(p, /students aged 15 to 18/);
  assert.match(p, /Notes on the Engine \(1843\)/);
  assert.match(p, /=== PAPER BEGINS ===\n[\s\S]+\n=== PAPER ENDS ===/);
  assert.ok(!p.includes("opening portion"));
  assert.ok(!p.includes("previous draft"));
});

test("truncation and a voice retry are said out loud in the prompt", () => {
  const p = buildDraftPrompt({ scholar: { name: "Ada Lovelace" }, text: PAPER, truncated: true, strictVoice: true });
  assert.match(p, /only the opening portion/);
  assert.match(p, /never as Ada Lovelace/);
});

test("a contributed upload is described as the scholar's own", () => {
  const p = buildDraftPrompt({ source: { origin: "contributed" }, text: PAPER });
  assert.match(p, /from their own upload/);
});

test("the system instruction states the rules the parser enforces", () => {
  const s = buildSystemInstruction();
  assert.match(s, /Third person only/);
  assert.match(s, /word for word/);
  assert.match(s, /No praise/);
  assert.equal(typeof PROMPT_VERSION, "string");
  assert.deepEqual(RESPONSE_SCHEMA.required, ["title", "deck", "blocks"]);
});

/* ── voice check ───────────────────────────────────────────────────────── */

test("first-person sentences are found, whichever form the pronoun takes", () => {
  const text =
    "Lovelace describes the engine. I found the notes persuasive. " +
    "We show that it loops. The method uses our data. It affects me personally.";
  const hits = firstPersonSentences(text);
  assert.equal(hits.length, 4);
  assert.ok(hits.every((s) => !s.startsWith("Lovelace")));
});

test("the country, roman numerals in quotes and an author named Wei do not trip the voice check", () => {
  // "US" and "Us" are not first-person forms; "Wei" is not "we".
  assert.deepEqual(firstPersonSentences("The US trial ran in 2011. Wei led the analysis. Part II follows."), []);
});

/* ── quote grounding ───────────────────────────────────────────────────── */

test("a verbatim quote survives curly quotes, dashes, case and spacing changes", () => {
  assert.equal(isVerbatim("“The array improved   the signal-to-noise ratio by 11 dB.”", PAPER), true);
  assert.equal(isVerbatim("Adaptive antenna arrays reduce interference by steering nulls toward unwanted sources", PAPER), true);
});

test("a paraphrase is not a quote, and neither is a fragment too short to mean anything", () => {
  assert.equal(isVerbatim("The array made the signal 11 dB clearer.", PAPER), false);
  assert.equal(isVerbatim("the array", PAPER), false);
});

/* ── parsing ───────────────────────────────────────────────────────────── */

test("a clean response becomes editor blocks with headings mapped and HTML escaped", () => {
  const raw = response({
    blocks: [
      { kind: "paragraph", text: "Nulls <b>steer</b> & cancel. ".repeat(60) },
      { kind: "heading", text: "Findings" },
      { kind: "quote", text: "the array improved the signal-to-noise ratio by 11 dB" },
    ],
  });
  const d = parseDraftResponse(raw, PAPER);
  assert.equal(d.title, "Steering silence toward the noise");
  assert.equal(d.bodyBlocks[0].type, "paragraph");
  assert.match(d.bodyBlocks[0].html, /&lt;b&gt;steer&lt;\/b&gt; &amp; cancel/);
  assert.equal(d.bodyBlocks[1].type, "subheading");
  assert.equal(d.bodyBlocks[2].type, "quote");
  assert.deepEqual(d.violations, []);
  assert.deepEqual(d.warnings, []);
  assert.ok(d.words >= LIMITS.MIN_DRAFT_WORDS);
});

test("a quote that is not in the paper is dropped and the scholar is told", () => {
  const raw = response({
    blocks: [
      { kind: "paragraph", text: "Real paragraph. ".repeat(150) },
      { kind: "quote", text: "the array quadrupled the signal, which is not what the paper says" },
      { kind: "quote", text: "the array improved the signal-to-noise ratio by 11 dB" },
    ],
  });
  const d = parseDraftResponse(raw, PAPER);
  assert.equal(d.bodyBlocks.filter((b) => b.type === "quote").length, 1);
  assert.equal(d.warnings.length, 1);
  assert.match(d.warnings[0], /1 quotation was left out/);
});

test("first-person prose outside quotes is reported as a violation, inside quotes it is not", () => {
  const raw = response({
    deck: "We cut interference by 11 dB.",
    blocks: [
      { kind: "paragraph", text: "I found the nulls steer well. Lovelace agrees. ".repeat(40) },
      { kind: "quote", text: "The authors note that performance degrades when more than four interferers are present." },
    ],
  });
  const d = parseDraftResponse(raw, PAPER);
  assert.ok(d.violations.length >= 2);
  assert.ok(d.violations.some((s) => s.startsWith("I found")));
  assert.ok(d.violations.some((s) => s.startsWith("We cut")));
  assert.ok(d.violations.every((s) => !s.includes("authors note")));
});

test("a fenced JSON reply is still JSON", () => {
  const d = parseDraftResponse("```json\n" + response() + "\n```", PAPER);
  assert.equal(d.title, "Steering silence toward the noise");
});

test("garbage, and a reply with no prose, are refused rather than passed on", () => {
  assert.throws(() => parseDraftResponse("not json", PAPER), /valid JSON/);
  assert.throws(() => parseDraftResponse(JSON.stringify({ title: "x", deck: "y" }), PAPER), /missing its blocks/);
  assert.throws(
    () => parseDraftResponse(JSON.stringify({ title: "x", deck: "y", blocks: [{ kind: "heading", text: "Only a heading" }] }), PAPER),
    /no article text/,
  );
});

test("too many blocks are cut, a short draft is flagged, and the title is bounded", () => {
  const blocks = Array.from({ length: LIMITS.MAX_BLOCKS + 5 }, () => ({ kind: "paragraph", text: "Short." }));
  const d = parseDraftResponse(JSON.stringify({ title: "t".repeat(500), deck: "d", blocks }), PAPER);
  assert.equal(d.bodyBlocks.length, LIMITS.MAX_BLOCKS);
  assert.ok(d.warnings.some((w) => /cut to/.test(w)));
  assert.ok(d.warnings.some((w) => /short/.test(w)));
  assert.equal(d.title.length, LIMITS.MAX_TITLE_CHARS);
});
