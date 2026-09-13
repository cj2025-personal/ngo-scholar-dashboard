/**
 * "Draft from my research" — the prompt, and the checks on what comes back.
 *
 * ── What this turns a paper into ───────────────────────────────────────────
 * A first draft of an article ABOUT the paper, for a public reader, that the
 * scholar then edits and publishes under their own byline. It is deliberately
 * not an article AS the scholar: `voiceStanding.js` draws the line that
 * Archivyn may write about a living scholar by default and as them only with
 * standing, and no scholar has standing yet. So the draft is third person,
 * built only on what the paper says, and the scholar is the one who adds a
 * voice to it. A draft that starts "I found…" under a real name is a claim
 * the person did not make; that is the failure this file's checks exist for.
 *
 * ── Why the checks are code, not prompt lines ──────────────────────────────
 * The prompt asks for third person and verbatim quotes. The model usually
 * complies. "Usually" is not a guarantee about a named person's byline, so the
 * same two rules are enforced on the output: first-person prose is reported
 * so the caller can retry or refuse, and a quote that is not in the source is
 * dropped rather than published. Both are pure functions over strings so they
 * run in tests without a model.
 *
 * ── Versioned ──────────────────────────────────────────────────────────────
 * `PROMPT_VERSION` is recorded beside every draft run. When the prompt changes,
 * a run can be told apart from one made under the old wording — the same
 * reason the extraction pipeline stores its `profile_version`.
 */

const PROMPT_VERSION = "2026-09-12.v1";

/** Who the draft is for, by age. One table shared with the readability gate and the UI. */
const { AUDIENCES, DEFAULT_AUDIENCE, normaliseAudience } = require("./audiences");

const LIMITS = {
  /* ~9,000 words is well inside the model's window; the cap is about cost and
     about not handing a 40-page monograph to a prompt that asks for 900 words. */
  MAX_SOURCE_WORDS: 9000,
  MIN_DRAFT_WORDS: 250,
  MAX_DRAFT_WORDS: 2000,
  MAX_BLOCKS: 24,
  MAX_TITLE_CHARS: 140,
  MAX_DECK_CHARS: 280,
};

/** What the model must return. Vertex enforces this on generation. */
const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING" },
    deck: { type: "STRING" },
    blocks: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          kind: { type: "STRING", enum: ["heading", "paragraph", "quote"] },
          text: { type: "STRING" },
        },
        required: ["kind", "text"],
      },
    },
  },
  required: ["title", "deck", "blocks"],
};

/**
 * The source, trimmed to budget.
 *
 * Cuts at a paragraph boundary where one exists so the model is not handed a
 * sentence that stops mid-clause, and says so, because a draft made from the
 * first two-thirds of a paper should be presented to the scholar as exactly
 * that.
 */
function prepareSourceText(text, maxWords = LIMITS.MAX_SOURCE_WORDS) {
  const clean = String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const words = clean ? clean.split(/\s+/) : [];
  if (words.length <= maxWords) {
    return { text: clean, words: words.length, truncated: false, totalWords: words.length };
  }
  let cut = words.slice(0, maxWords).join(" ");
  const lastBreak = cut.lastIndexOf("\n\n");
  if (lastBreak > cut.length * 0.6) cut = cut.slice(0, lastBreak);
  const trimmed = cut.trim();
  return { text: trimmed, words: trimmed.split(/\s+/).length, truncated: true, totalWords: words.length };
}

function buildSystemInstruction() {
  return [
    "You draft articles for Archivyn, a public archive that introduces readers to real, living scholars",
    "through their own research. You are writing ABOUT a scholar's paper, for a reader who has not read it.",
    "",
    "Rules that are checked after you answer:",
    "1. Third person only. Refer to the scholar by surname after the first full-name mention. Never write",
    '   as the scholar: no "I", "we", "my", "our" outside a verbatim quote from the paper.',
    "2. Every fact, number, name and claim must come from the paper you are given. Do not add background",
    "   the paper does not state, and do not speculate about impact, motive or biography.",
    "3. A quote block must be copied word for word from the paper. If you cannot quote exactly, paraphrase",
    "   in a paragraph block instead. Quotes that are not in the paper are discarded.",
    '4. No praise, no adjectives about the scholar, no "groundbreaking" or "pioneering". The work',
    "   speaks; you report it.",
    "5. Where the paper describes limits, uncertainty, or open questions, include them.",
    "",
    "Return only the JSON object described by the schema.",
  ].join("\n");
}

/**
 * The user turn.
 *
 * @param {object} p
 * @param {{name?: string, field?: string|null}} p.scholar
 * @param {{title?: string, year?: number|null, origin?: string}} p.source
 * @param {string} p.text         the prepared source text
 * @param {boolean} [p.truncated]
 * @param {string} [p.audience]
 * @param {boolean} [p.strictVoice]  set on retry after a first-person violation
 * @param {string|null} [p.readabilityNote]  set on retry after the draft measured too hard
 */
function buildDraftPrompt({ scholar = {}, source = {}, text, truncated = false, audience, strictVoice = false, readabilityNote = null }) {
  const aud = AUDIENCES[normaliseAudience(audience)];
  const name = scholar.name || "the scholar";
  const lines = [
    `Write a first draft of an article about the paper below, by ${name}` +
      (scholar.field ? ` (${scholar.field})` : "") +
      `, for ${aud.brief}`,
    "",
    "Shape:",
    "- title: under 12 words, specific to what the paper found, no colon-and-subtitle pattern.",
    "- deck: one or two sentences that say what the paper did and why a reader would care.",
    '- blocks: 6 to 12 blocks, 500 to 1,100 words in total. Use "heading" blocks to divide the article',
    '  into 2 to 4 sections. Use at most 3 "quote" blocks, each a single sentence or two copied exactly.',
    "- Open with what the paper found, not with who the scholar is.",
    "- Close with what the paper says is still unknown or what it suggests comes next — only if the paper says so.",
  ];
  if (strictVoice) {
    lines.push(
      "",
      "Your previous draft used first-person language outside quotes. That is not permitted: this article is",
      `written about ${name}, never as ${name}. Rewrite every such sentence in the third person.`,
    );
  }
  if (readabilityNote) {
    lines.push("", readabilityNote);
  }
  lines.push(
    "",
    `Paper title: ${source.title || "Untitled"}` + (source.year ? ` (${source.year})` : ""),
    source.origin === "contributed"
      ? "Provided by the scholar, from their own upload."
      : "Licensed for full reproduction.",
  );
  if (truncated) {
    lines.push(
      "NOTE: only the opening portion of the paper is provided. Draft from what is here and do not guess at the rest.",
    );
  }
  lines.push("", "=== PAPER BEGINS ===", text, "=== PAPER ENDS ===");
  return lines.join("\n");
}

/* ── Output checks ──────────────────────────────────────────────────────── */

/* Exact forms, case-sensitive, so "US" (the country) and "Us" do not trip it
   while "I", "We" at sentence start and "we" mid-sentence do. */
const FIRST_PERSON = new Set([
  "I", "I'm", "I've", "I'd", "I'll", "me", "my", "mine", "myself",
  "we", "We", "we're", "We're", "we've", "We've", "we'd", "we'll", "We'll",
  "our", "Our", "ours", "ourselves", "us",
  "My", "Me", "Mine", "Myself", "Ours", "Ourselves",
]);

/** Sentences of `text` that speak in the first person. */
function firstPersonSentences(text) {
  const sentences = String(text || "").split(/(?<=[.!?])\s+/);
  return sentences.filter((sentence) =>
    sentence
      .replace(/[“”"]/g, "")
      .split(/\s+/)
      .map((w) => w.replace(/^[^A-Za-z']+|[^A-Za-z']+$/g, ""))
      .some((w) => FIRST_PERSON.has(w)),
  );
}

/** Whitespace, curly quotes and dashes collapsed so an honest quote survives
 *  the model's punctuation normalisation, and lowercased so a case change does
 *  not count against it. Everything else must match. */
function canon(text) {
  return String(text || "")
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isVerbatim(quote, sourceText) {
  const q = canon(quote).replace(/^["'\s]+|["'\s.]+$/g, "");
  return q.length >= 12 && canon(sourceText).includes(q);
}

function escapeHtml(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function countWords(text) {
  return String(text || "").split(/\s+/).filter(Boolean).length;
}

function stripCodeFence(raw) {
  const s = String(raw || "").trim();
  const m = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return m ? m[1] : s;
}

/**
 * Turn the model's JSON into editor blocks, applying the checks.
 *
 * Returns the draft plus the list of `violations` (first-person sentences,
 * which the caller treats as grounds to retry) and `warnings` (what was
 * dropped or trimmed, which the caller shows the scholar). Throws only when
 * the response is not usable at all.
 *
 * @param {string} raw            the model's text
 * @param {string} sourceText     what quotes are checked against
 */
function parseDraftResponse(raw, sourceText) {
  let data;
  try {
    data = JSON.parse(stripCodeFence(raw));
  } catch {
    throw new Error("The model did not return valid JSON.");
  }
  if (!data || typeof data !== "object" || !Array.isArray(data.blocks)) {
    throw new Error("The model's response is missing its blocks.");
  }

  const warnings = [];
  const violations = [];
  const bodyBlocks = [];
  /* The prose the readability gate measures: paragraphs only. Headings are
     fragments and quotes are the scholar's own register, not the draft's. */
  const prose = [];
  let droppedQuotes = 0;

  for (const block of data.blocks.slice(0, LIMITS.MAX_BLOCKS)) {
    const text = String(block?.text || "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const kind = block?.kind === "heading" || block?.kind === "quote" ? block.kind : "paragraph";

    if (kind === "quote") {
      if (!isVerbatim(text, sourceText)) {
        droppedQuotes += 1;
        continue;
      }
      bodyBlocks.push({ type: "quote", html: escapeHtml(text) });
      continue;
    }

    violations.push(...firstPersonSentences(text));
    if (kind !== "heading") prose.push(text);
    bodyBlocks.push({ type: kind === "heading" ? "subheading" : "paragraph", html: escapeHtml(text) });
  }

  if (data.blocks.length > LIMITS.MAX_BLOCKS) {
    warnings.push(`The draft was cut to ${LIMITS.MAX_BLOCKS} blocks.`);
  }
  if (droppedQuotes > 0) {
    warnings.push(
      `${droppedQuotes} quotation${droppedQuotes === 1 ? " was" : "s were"} left out because ` +
        `${droppedQuotes === 1 ? "it does" : "they do"} not appear word for word in the paper.`,
    );
  }

  if (bodyBlocks.filter((b) => b.type === "paragraph").length === 0) {
    throw new Error("The model returned no article text.");
  }

  const words = bodyBlocks.reduce((n, b) => n + countWords(b.html), 0);
  if (words < LIMITS.MIN_DRAFT_WORDS) {
    warnings.push(`The draft is short (${words} words); the paper may not have given the model much to work with.`);
  } else if (words > LIMITS.MAX_DRAFT_WORDS) {
    warnings.push(`The draft is long (${words.toLocaleString()} words) and will need cutting.`);
  }

  const title = String(data.title || "").replace(/\s+/g, " ").trim().slice(0, LIMITS.MAX_TITLE_CHARS);
  const deck = String(data.deck || "").replace(/\s+/g, " ").trim().slice(0, LIMITS.MAX_DECK_CHARS);
  violations.push(...firstPersonSentences(deck));

  return { title, deck, bodyBlocks, words, warnings, violations, prose: prose.join("\n\n") };
}

module.exports = {
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
};
