/**
 * "Draft from my research" — the prompt, and the checks on what comes back.
 *
 * ── What this turns a paper into ───────────────────────────────────────────
 * A first draft of an article about the paper, for a public reader, that the
 * scholar then edits and publishes under their own byline.
 *
 * ── Two voices, and the line between them ──────────────────────────────────
 * `voiceStanding.js` draws the line that Archivyn may write ABOUT a living
 * scholar by default and AS them only with standing, and no scholar has
 * standing yet. A draft that starts "I found…" under a real name is a claim
 * the person did not make. That rule still holds, in both voices here.
 *
 * But there is a third possibility that neither "about" nor "as" covers, and
 * it is the one a scholar drafting their own paper actually wants:
 *
 *   VOICE.ABOUT   Someone else's account of the work. "Gupta found that…"
 *                 Right for a profile, a catalogue entry, a piece the archive
 *                 publishes in its own name.
 *   VOICE.AUTHOR  The scholar's own account, impersonal. The work is
 *                 described directly — "The method starts from Bartlett's
 *                 spectrum" — and the author is never named, never given a
 *                 pronoun, and never speaks as "I". The byline says who
 *                 wrote it; the prose does not need to.
 *
 * AUTHOR is not impersonation, which is why it needs no standing: it puts no
 * sentence in the scholar's mouth. It removes a narrator rather than adding
 * one. It is also how scholars actually write popular accounts of their own
 * work, and it fixes a failure ABOUT cannot avoid — an article bylined
 * "Inder Gupta" whose prose says "Inder Gupta found a new way" reads as a
 * press release about himself, and because each section is drafted by a
 * separate call, the sections disagreed about his pronoun.
 *
 * Both voices ban the first person. AUTHOR additionally bans naming the
 * author at all, and that ban is what makes the pronoun unguessable-and-
 * therefore-unwrong.
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

const PROMPT_VERSION = "2026-09-15.v3";

/**
 * Whose account the article is. See the header.
 *
 * AUTHOR is the default for "draft from my research": the only papers this
 * pipeline drafts from are the scholar's own, and the article goes out under
 * their byline.
 */
const VOICE = { ABOUT: "about", AUTHOR: "author" };
const DEFAULT_VOICE = VOICE.AUTHOR;

function normaliseVoice(value) {
  return value === VOICE.ABOUT || value === VOICE.AUTHOR ? value : DEFAULT_VOICE;
}

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

/* Words that end in a full stop without ending a sentence. */
const ABBREVIATIONS = new Set([
  "e.g", "i.e", "etc", "vs", "cf", "al", "fig", "eq", "no", "approx",
  "dr", "prof", "mr", "mrs", "ms", "st", "jr", "sr",
]);

/** Whether the stop at `i` closes a sentence, rather than an abbreviation or an initial. */
function closesSentence(text, i) {
  if (text[i] !== ".") return true; /* ! and ? never abbreviate */
  const word = (text.slice(0, i).match(/[A-Za-z.]+$/) || [""])[0].toLowerCase().replace(/^\.+/, "");
  if (ABBREVIATIONS.has(word)) return false;
  return !/^[a-z]$/.test(word); /* an initial: "J. Smith" */
}

/**
 * Cut a line of prose to a budget without cutting a word or a sentence in half.
 *
 * A deck was being stored as `.slice(0, 280)`, which left readers the phrase
 * "offers a more accurate an" under the headline of a published story. Prefer
 * the last sentence that closes inside the budget; when a single sentence
 * already overruns it, keep whole words and mark the cut.
 */
function clampToSentence(text, max) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const window = s.slice(0, max);
  let cut = -1;
  for (let i = 0; i < window.length; i += 1) {
    if (!".!?".includes(window[i])) continue;
    let end = i + 1;
    while (end < window.length && "\"'’”)]".includes(window[end])) end += 1;
    /* Followed by a space or the end of the window; otherwise it sits inside
       a token, as the stop in "0.6" does. */
    if (end < window.length && !/\s/.test(window[end])) continue;
    if (!closesSentence(window, i)) continue;
    cut = end;
  }
  /* A boundary so early that most of the line would go is worse than an
     ellipsis, so fall back rather than return a fragment of the meaning. */
  if (cut >= max * 0.4) return window.slice(0, cut).trim();
  return `${window.slice(0, max - 1).replace(/\s+\S*$/, "").replace(/[,;:([]$/, "").trim()}…`;
}

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

/**
 * @param {object} [p]
 * @param {string} [p.voice]        VOICE.AUTHOR (default) or VOICE.ABOUT
 * @param {string|null} [p.scholarName]  named in the AUTHOR rules so the model knows what not to write
 */
function buildSystemInstruction({ voice = DEFAULT_VOICE, scholarName = null } = {}) {
  const name = scholarName || "the author";
  if (normaliseVoice(voice) === VOICE.AUTHOR) {
    return [
      "You draft articles for Archivyn, a public archive that introduces readers to real, living scholars",
      "through their own research. This article is the author's own account of their own paper, for a reader",
      "who has not read it. It goes out under their byline, so the prose never refers to them at all.",
      "",
      "Rules that are checked after you answer:",
      `1. Never name or refer to the author. No "${name}", no "the author", no "the researchers", no "he",`,
      '   "she" or "they" standing for them. Write about the work, not the worker: not "Gupta\'s method finds',
      '   weak signals" but "The method finds weak signals". A sentence that needs the author as its subject',
      "   should take the work as its subject instead.",
      '2. No first person either. No "I", "we", "my", "our" outside a verbatim quote. This is an impersonal',
      "   account, not a memoir. Other researchers named in the paper may be named normally.",
      "3. Every fact, number, name and claim must come from the paper you are given. Do not add background",
      "   the paper does not state, and do not speculate about impact, motive or biography.",
      "4. A quote block must be copied word for word from the paper. If you cannot quote exactly, paraphrase",
      "   in a paragraph block instead. Quotes that are not in the paper are discarded.",
      '5. No praise, no self-congratulation, no "groundbreaking" or "pioneering". The work speaks.',
      "6. Where the paper describes limits, uncertainty, or open questions, include them.",
      "",
      "Return only the JSON object described by the schema.",
    ].join("\n");
  }
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
/* The singular first person is the author, always, with no second reading. */
const FIRST_PERSON = new Set([
  "I", "I'm", "I've", "I'd", "I'll", "me", "my", "mine", "myself",
  "My", "Me", "Mine", "Myself",
]);

/**
 * "We" has two meanings and only one of them is forbidden.
 *
 * ── What this cost ──────────────────────────────────────────────────────────
 * Every `we`, `us` and `our` counted as the author speaking, so an article
 * for a child — where "things we use every day" and "it helps us find" are
 * ordinary English for everyone, the reader included — tripped the guard on
 * the first section and the run refused. A scholar approved six sections and
 * got a sentence telling them to try a different paper. Measured on the real
 * model: three such sentences in the first section, none of them the author.
 *
 * ── The line ────────────────────────────────────────────────────────────────
 * The authorial "we" attaches to the work: a verb for doing research, or a
 * possessive over what was produced. The inclusive "we" attaches to the
 * world. So `we found`, `we measured`, `our method`, `our results` are the
 * author; `we use every day`, `helps us find`, `tells us about the weather`
 * are not. Everyday verbs are deliberately absent from the list — "we use"
 * and "we see" are how you explain anything to anyone.
 *
 * A heuristic, so it can miss: "we wanted to know whether" is the author and
 * passes. That is the cheap failure — one sentence in front of the scholar,
 * who is reading the draft anyway. The expensive failure was the other
 * direction, and it threw six sections away.
 */
const RESEARCH_VERB = /\b[Ww]e\s+(?:\w+ly\s+|also\s+|then\s+|first\s+|next\s+|have\s+|had\s+|here\s+)*(?:found|find|show|showed|shown|present|presented|propose|proposed|develop|developed|design|designed|build|built|test|tested|measure|measured|ran|run|observe|observed|report|reported|conclude|concluded|demonstrate|demonstrated|evaluate|evaluated|compare|compared|analyse|analysed|analyze|analyzed|derive|derived|simulate|simulated|investigate|investigated|introduce|introduced|implement|implemented|collect|collected|record|recorded|obtain|obtained|establish|established|verify|verified|confirm|confirmed|validate|validated|quantify|quantified|assess|assessed|examine|examined|estimate|estimated|calculate|calculated|compute|computed|apply|applied|carried\s+out|carry\s+out|set\s+out|cut|reduce|reduced|improve|improved|achieve|achieved|increase|increased|decrease|decreased|eliminate|eliminated|suppress|suppressed|solve|solved)\b/;
const OUR_WORK = /\b[Oo]ur\s+(?:\w+\s+){0,2}(?:method|methods|approach|approaches|work|paper|papers|study|studies|research|result|results|finding|findings|data|dataset|experiment|experiments|simulation|simulations|analysis|algorithm|algorithms|technique|techniques|model|models|array|arrays|system|systems|design|implementation|measurement|measurements|trial|trials|test|tests|contribution|contributions|proposal|hypothesis)\b/;

/** Sentences of `text` that speak in the author's own first person. */
function firstPersonSentences(text) {
  const sentences = String(text || "").split(/(?<=[.!?])\s+/);
  return sentences.filter((raw) => {
    const sentence = raw.replace(/[“”"]/g, "");
    const singular = sentence
      .split(/\s+/)
      .map((w) => w.replace(/^[^A-Za-z']+|[^A-Za-z']+$/g, ""))
      .some((w) => FIRST_PERSON.has(w));
    return singular || RESEARCH_VERB.test(sentence) || OUR_WORK.test(sentence);
  });
}

/* Ways an article refers to its own author without naming them. */
const AUTHOR_NOUNS = /\b(?:the|this|its)\s+(?:present\s+|current\s+)?(?:author|authors|researcher|researchers|investigator|investigators|writer)\b/i;
/* Singular personal pronouns. In an impersonal account there is rarely a
   legitimate one, and the failure this guards is a real person's pronoun
   being guessed — so they are reported, but as a warning, not a refusal. */
const PERSONAL_PRONOUN = /\b(?:he|him|his|she|her|hers)\b/i;

/** The forms a name is referred to by: the full name, and each part long enough to be distinctive. */
function nameForms(scholarName) {
  const full = String(scholarName || "").replace(/\s+/g, " ").trim();
  if (!full) return [];
  const parts = full.split(" ").filter((p) => p.replace(/[^A-Za-z]/g, "").length >= 3);
  return [...new Set([full, ...parts])].filter(Boolean);
}

/**
 * Sentences that refer to the article's own author, which VOICE.AUTHOR
 * forbids. Two severities, because they deserve different answers:
 *
 *   named     the author is named, or called "the author". Unambiguous, and
 *             the drafter is sent back to rewrite it.
 *   pronouns  a gendered pronoun, which usually means the author crept in as
 *             a subject but may legitimately refer to someone else the paper
 *             names. Reported to the scholar, never a refusal — guessing
 *             which is which is exactly the judgement a person should make.
 *
 * @param {string} text
 * @param {string|null} scholarName
 * @returns {{named: string[], pronouns: string[]}}
 */
function selfReferenceSentences(text, scholarName = null) {
  const forms = nameForms(scholarName).map((f) => new RegExp(`\\b${f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"));
  const named = [];
  const pronouns = [];
  for (const sentence of String(text || "").split(/(?<=[.!?])\s+/)) {
    if (!sentence.trim()) continue;
    if (forms.some((re) => re.test(sentence)) || AUTHOR_NOUNS.test(sentence)) named.push(sentence);
    else if (PERSONAL_PRONOUN.test(sentence)) pronouns.push(sentence);
  }
  return { named, pronouns };
}

/**
 * Whether an article written ABOUT a scholar keeps one pronoun for them
 * throughout. Each section is drafted by its own call, so without this the
 * sections can — and did — disagree: an article that said "he" for four
 * sections and "she" for the last two went out under a real person's name.
 *
 * Says nothing about which pronoun is right; only that there must be one.
 *
 * @param {object[]} blocks   mapped blocks with `html`
 * @returns {{version: string, used: string[], ok: boolean|null, sentence: string|null, blocks: number[]}}
 */
function pronounConsistency({ blocks }) {
  const MASC = /\b(?:he|him|his)\b/i;
  const FEM = /\b(?:she|her|hers)\b/i;
  const seen = new Map();
  for (const [i, b] of (blocks || []).entries()) {
    if (b.type !== "paragraph" && b.type !== "quote") continue;
    const text = String(b.html || "").replace(/<[^>]+>/g, " ");
    if (MASC.test(text)) seen.set("he", [...(seen.get("he") || []), i + 1]);
    if (FEM.test(text)) seen.set("she", [...(seen.get("she") || []), i + 1]);
  }
  const used = [...seen.keys()];
  if (used.length <= 1) {
    return { version: PROMPT_VERSION, used, ok: used.length === 1 ? true : null, sentence: null, blocks: [] };
  }
  /* Whichever is rarer is the one that slipped: name those blocks. */
  const [minor] = [...seen.entries()].sort((a, b) => a[1].length - b[1].length);
  return {
    version: PROMPT_VERSION,
    used,
    ok: false,
    blocks: minor[1],
    sentence:
      `This article calls the author "${used[0]}" in some paragraphs and "${used[1]}" in others — ` +
      `"${minor[0]}" in block${minor[1].length === 1 ? "" : "s"} ${minor[1].join(", ")}. ` +
      "One of them is wrong about a real person. Fix it before publishing.",
  };
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

  const title = clampToSentence(data.title, LIMITS.MAX_TITLE_CHARS);
  const deck = clampToSentence(data.deck, LIMITS.MAX_DECK_CHARS);
  violations.push(...firstPersonSentences(deck));

  return { title, deck, bodyBlocks, words, warnings, violations, prose: prose.join("\n\n") };
}

module.exports = {
  PROMPT_VERSION,
  AUDIENCES,
  DEFAULT_AUDIENCE,
  VOICE,
  DEFAULT_VOICE,
  LIMITS,
  RESPONSE_SCHEMA,
  clampToSentence,
  normaliseAudience,
  normaliseVoice,
  prepareSourceText,
  buildSystemInstruction,
  buildDraftPrompt,
  parseDraftResponse,
  firstPersonSentences,
  nameForms,
  selfReferenceSentences,
  pronounConsistency,
  isVerbatim,
};
