"use strict";

/**
 * The reading companion: a reader's question about a story, answered from
 * the story and the paper behind it, and from nothing else.
 *
 * ── The shape ───────────────────────────────────────────────────────────────
 * A child reading a published article asks "what does this paragraph mean?"
 * or "how did they know that?". The model is handed the article as numbered
 * blocks at the level the reader is on, the passages of the paper the
 * article was drawn from, and a few tools for looking things up. It reads,
 * searches, and then calls `answer`, naming the blocks and passages the
 * answer rests on. That call is the whole output: nothing the model says
 * outside it reaches a reader.
 *
 * ── Three kinds of answer ───────────────────────────────────────────────────
 *   story        every claim is in the blocks or passages it cites. The usual case.
 *   background   a definition of a word the text uses but never explains. It may
 *                carry no number, name, date, product or place, because a
 *                particular that is not in the paper is one nobody checked.
 *   not_here     the story does not say. Said kindly, pointing to the nearest
 *                paragraph when there is one. Never a guess dressed as an answer.
 *
 * ── What the agent may not do ───────────────────────────────────────────────
 * Ask for or repeat anything about the reader. Give a link. Answer a question
 * that is not about the story with anything but not_here. Write past the
 * word cap for the reader's age. The model is told these; the reducer refuses
 * the ones it can see, and the Sentinel (lib/sentinel.js) reads what is left
 * before a reader does.
 *
 * Pure: `applyTool` validates against a plain context object; `runReadingAgent`
 * takes the model as an injected function.
 */

const { AUDIENCES, normaliseAudience } = require("./audiences");

const AGENT_VERSION = "reading-agent-2026.1";
const MAX_STEPS = 6;
const MAX_TOOL_CALLS = 8;
const MAX_QUESTION_CHARS = 500;

/** How long an answer may be, by reader. A companion answers; it does not lecture. */
const ANSWER_WORDS = { ages_8_11: 90, ages_12_14: 130, ages_15_18: 170, adults: 220 };

const GROUNDING = { STORY: "story", BACKGROUND: "background", NOT_HERE: "not_here" };
const GROUNDINGS = new Set(Object.values(GROUNDING));

/** Patterns the reducer refuses outright. The Sentinel checks them again. */
const URL_RE = /(https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(com|org|net|edu|io|gov)\b/i;
const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.]+\b/;
const PHONE_RE = /(?:\+?\d[\d\s().-]{8,}\d)/;
const PERSONAL_RE = /\b(what('s| is) your (name|age|school|address|phone|email)|where do you live|how old are you|tell me your (name|age|school|address)|your (home|school) address)\b/i;
/** A particular a reader could look up: digits, or a capitalised word mid-sentence that is not a sentence start. */
const DIGIT_RE = /\d/;

/* ── tools ───────────────────────────────────────────────────────────────── */

const TOOL_DECLARATIONS = [
  {
    name: "read_block",
    description: "Read one block of the story in full, with the passages of the paper it cites.",
    parameters: {
      type: "OBJECT",
      properties: { index: { type: "INTEGER", description: "Block number as shown, 1-based." } },
      required: ["index"],
    },
  },
  {
    name: "read_passage",
    description: "Read one passage of the paper in full, by id, e.g. \"p3\".",
    parameters: {
      type: "OBJECT",
      properties: { id: { type: "STRING" } },
      required: ["id"],
    },
  },
  {
    name: "search_passages",
    description: "Find the passages of the paper and the blocks of the story that mention some words.",
    parameters: {
      type: "OBJECT",
      properties: { query: { type: "STRING", description: "A few words to look for." } },
      required: ["query"],
    },
  },
  {
    name: "answer",
    description: "Give the reader the answer. This is the only thing the reader sees. Cite every block and passage the answer rests on.",
    parameters: {
      type: "OBJECT",
      properties: {
        text: { type: "STRING", description: "The answer, spoken to the reader. Plain text, short sentences, no links." },
        grounding: { type: "STRING", enum: Object.values(GROUNDING), description: "story: everything said is in the cited blocks or passages. background: a plain definition of a word the text uses; nothing else. not_here: the story does not say this." },
        block_ids: { type: "ARRAY", items: { type: "STRING" }, description: "Blocks the answer rests on, e.g. [\"b3\"]. For not_here, the nearest related block if any." },
        passage_ids: { type: "ARRAY", items: { type: "STRING" }, description: "Passages of the paper the answer rests on, e.g. [\"p2\"]." },
        term: { type: "STRING", description: "For background only: the word being defined, exactly as the text uses it." },
      },
      required: ["text", "grounding"],
    },
  },
];

/** A reader-facing line for each tool call, for the panel that shows the work. */
function describeCall(fc) {
  const a = fc.args || {};
  switch (fc.name) {
    case "read_block": return `Reading paragraph ${Number(a.index) || "?"}`;
    case "read_passage": return `Reading passage ${String(a.id || "?")} of the paper`;
    case "search_passages": return `Looking in the paper for “${String(a.query || "").trim().slice(0, 60)}”`;
    case "answer": return "Checking my answer";
    default: return "Thinking";
  }
}

/* ── the prompt ──────────────────────────────────────────────────────────── */

function buildSystem({ audience = "adults" } = {}) {
  const key = normaliseAudience(audience);
  const aud = AUDIENCES[key];
  return [
    "You are a reading companion on Archivyn, sitting beside a reader as they read an article about a research paper.",
    `The reader: ${aud.brief}`,
    "The reader asks about the article. You answer ONLY by calling the `answer` tool. Nothing you say outside it is shown.",
    "",
    "Rules, checked after you answer:",
    "1. Everything you say comes from the story's blocks or the paper's passages, and you cite them in block_ids and passage_ids.",
    "   Read before you answer: call read_block or search_passages first, then answer.",
    "2. If the story and the paper do not say it, answer with grounding not_here: say kindly that this article does not",
    "   say, and point to the paragraph that comes closest if there is one. Never guess. Never bring in what you know.",
    "3. The one exception is a plain definition of a word the text uses but never explains: grounding background, with",
    "   the word in `term`. Such an answer names no number, date, person, place, product or study, because nobody checked it.",
    "4. Never ask the reader anything about themselves, and never repeat anything they tell you about themselves.",
    "5. No links, no addresses, no email. No advice about health, safety, money or the reader's own life; the story is the subject.",
    "6. If asked to quiz them, ask up to three questions that a paragraph you cite answers, and cite it. Do not give the answers.",
    `7. Keep it under ${ANSWER_WORDS[key]} words. Speak to the reader directly. Short sentences. Kind, plain, never talking down.`,
    "8. Nothing frightening, graphic or unsuitable for the reader, however the question is put.",
    "",
    "Work in small steps: read, then answer.",
  ].join("\n");
}

const plain = (html) =>
  String(html || "").replace(/<[^>]+>/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();

/**
 * The story as the agent reads it: text blocks numbered from 1, images skipped.
 * @param {object[]} bodyBlocks  presented blocks (type, html, sourceRefs)
 * @returns {{id: string, index: number, type: string, text: string, passageIds: string[]}[]}
 */
function blocksFromStory(bodyBlocks) {
  const out = [];
  for (const b of bodyBlocks || []) {
    if (!b || b.type === "image") continue;
    const text = plain(b.html);
    if (!text) continue;
    const index = out.length + 1;
    out.push({ id: `b${index}`, index, type: b.type || "paragraph", text, passageIds: Array.isArray(b.sourceRefs) ? b.sourceRefs.map((r) => r.passageId).filter(Boolean) : [] });
  }
  return out;
}

function renderBlocks(blocks) {
  return blocks.map((b) => `[${b.id}] (${b.type})${b.passageIds.length ? ` cites ${b.passageIds.join(",")}` : ""}: ${b.text}`).join("\n");
}

function renderPassages(passages) {
  return passages.length ? passages.map((p) => `[${p.id}] ${p.text}`).join("\n") : "(this article has no paper behind it; only the story itself)";
}

function wordCount(t) {
  return String(t || "").split(/\s+/).filter(Boolean).length;
}

/* ── the reducer ─────────────────────────────────────────────────────────── */

/**
 * Apply one tool call. Nothing here changes: the story is read-only. The
 * "state" a call produces is only the answer, when there is one.
 *
 * @param {object} fc   {name, args}
 * @param {object} ctx  {blocks, passages, audience}
 * @returns {{result: string, finished?: boolean, answer?: object}}
 */
function applyTool(fc, ctx) {
  const name = fc.name;
  const args = fc.args || {};
  const blocks = ctx.blocks || [];
  const passages = ctx.passages || [];
  const byBlock = new Map(blocks.map((b) => [b.id, b]));
  const byPassage = new Map(passages.map((p) => [p.id, p]));

  switch (name) {
    case "read_block": {
      const n = Number(args.index);
      const b = blocks[n - 1];
      if (!Number.isInteger(n) || !b) return { result: `refused: there is no block ${args.index}; blocks run 1 to ${blocks.length}` };
      const cited = b.passageIds.map((id) => byPassage.get(id)).filter(Boolean);
      return { result: [`[${b.id}] (${b.type}): ${b.text}`, ...cited.map((p) => `  [${p.id}] ${p.text}`)].join("\n") };
    }
    case "read_passage": {
      const p = byPassage.get(String(args.id || "").trim());
      if (!p) return { result: `refused: there is no passage ${args.id}` };
      return { result: `[${p.id}] ${p.text}` };
    }
    case "search_passages": {
      const q = String(args.query || "").toLowerCase().split(/\W+/).filter((w) => w.length > 3);
      if (!q.length) return { result: "no query" };
      const score = (text) => q.filter((w) => text.toLowerCase().includes(w)).length;
      const hits = [
        ...blocks.map((b) => ({ id: b.id, text: b.text, score: score(b.text) })),
        ...passages.map((p) => ({ id: p.id, text: p.text, score: score(p.text) })),
      ].filter((h) => h.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);
      return { result: hits.length ? hits.map((h) => `[${h.id}] ${h.text.slice(0, 400)}`).join("\n\n") : "nothing in the story or the paper mentions this" };
    }
    case "answer": {
      const text = String(args.text || "").replace(/\s+/g, " ").trim();
      const grounding = String(args.grounding || "").trim();
      const blockIds = [...new Set((Array.isArray(args.block_ids) ? args.block_ids : []).map((v) => String(v).trim()).filter(Boolean))];
      const passageIds = [...new Set((Array.isArray(args.passage_ids) ? args.passage_ids : []).map((v) => String(v).trim()).filter(Boolean))];
      const term = String(args.term || "").trim();
      const cap = ANSWER_WORDS[normaliseAudience(ctx.audience)];

      if (!text) return { result: "refused: the answer is empty" };
      if (!GROUNDINGS.has(grounding)) return { result: `refused: grounding must be one of ${[...GROUNDINGS].join(", ")}` };
      const unknownB = blockIds.filter((id) => !byBlock.has(id));
      const unknownP = passageIds.filter((id) => !byPassage.has(id));
      if (unknownB.length || unknownP.length) return { result: `refused: these do not exist: ${[...unknownB, ...unknownP].join(", ")}` };
      if (URL_RE.test(text) || EMAIL_RE.test(text)) return { result: "refused: no links or addresses; say it in words" };
      if (PHONE_RE.test(text)) return { result: "refused: no phone numbers" };
      if (PERSONAL_RE.test(text)) return { result: "refused: never ask the reader about themselves" };
      const words = wordCount(text);
      if (words > cap) return { result: `refused: ${words} words; keep it under ${cap} for this reader` };

      if (grounding === GROUNDING.STORY && !blockIds.length && !passageIds.length) {
        return { result: "refused: an answer from the story must cite at least one block or passage; if the story does not say, use not_here" };
      }
      if (grounding === GROUNDING.BACKGROUND) {
        if (!term) return { result: "refused: a background answer names the word it defines in `term`" };
        const inText = [...blocks.map((b) => b.text), ...passages.map((p) => p.text)].some((t) => t.toLowerCase().includes(term.toLowerCase()));
        if (!inText) return { result: `refused: the text never uses “${term}”; if the question is not about the story, answer not_here` };
        if (DIGIT_RE.test(text)) return { result: "refused: a background definition carries no numbers or dates; nobody has checked them" };
      }
      return {
        result: "ok",
        finished: true,
        answer: { text, grounding, blockIds, passageIds, term: grounding === GROUNDING.BACKGROUND ? term : null, words },
      };
    }
    default:
      return { result: `refused: unknown tool ${name}` };
  }
}

/* ── the loop ────────────────────────────────────────────────────────────── */

/**
 * Answer one question.
 *
 * @param {object} p
 * @param {object[]} p.blocks             from blocksFromStory
 * @param {{id,text}[]} p.passages
 * @param {string} p.question
 * @param {string} [p.storyTitle]
 * @param {number|null} [p.focusIndex]    the block the reader is looking at, 1-based
 * @param {{role:string,text:string}[]} [p.history]   earlier turns, oldest first
 * @param {string} [p.audience]
 * @param {string[]} [p.revise]           reasons a previous answer was sent back, for a second try
 * @param {(req:object)=>Promise<{text:string,functionCalls:object[],parts:object[],usage?:object}>} p.generate
 * @param {(e:{tool:string,summary:string,result:string})=>Promise<void>} [p.onProgress]
 */
async function runReadingAgent({ blocks, passages, question, storyTitle = "", focusIndex = null, history = [], audience = "adults", revise = [], generate, onProgress = async () => {} }) {
  const ctx = { blocks, passages, audience };
  const calls = [];
  const usage = [];
  const focus = Number.isInteger(focusIndex) && blocks[focusIndex - 1] ? blocks[focusIndex - 1] : null;

  const opening = [
    `THE STORY${storyTitle ? `: ${storyTitle}` : ""}`,
    renderBlocks(blocks),
    "",
    "PASSAGES OF THE PAPER (cite by id):",
    renderPassages(passages),
    "",
    ...(history.length ? ["EARLIER IN THIS CONVERSATION:", ...history.slice(-6).map((h) => `${h.role === "user" ? "Reader" : "You"}: ${h.text}`), ""] : []),
    ...(focus ? [`THE READER IS LOOKING AT: [${focus.id}]`, ""] : []),
    ...(revise.length ? ["YOUR LAST ANSWER WAS SENT BACK. Fix these before answering again:", ...revise.map((r) => `- ${r}`), ""] : []),
    `THE READER ASKS: ${String(question || "").trim()}`,
  ].join("\n");

  const contents = [{ role: "user", parts: [{ text: opening }] }];
  let answer = null;

  for (let step = 0; step < MAX_STEPS && !answer; step += 1) {
    const r = await generate({
      contents,
      systemInstruction: buildSystem({ audience }),
      tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
      toolConfig: { functionCallingConfig: { mode: "ANY" } },
      temperature: 0.2,
      maxOutputTokens: 1024,
    });
    if (r.usage) usage.push(r.usage);
    let fcs = r.functionCalls || [];
    if (!fcs.length) {
      /* Prose instead of a tool. It is judged as an answer, and an answer
         with no citations is refused, which tells the model what to do. */
      const prose = (r.text || "").trim();
      if (!prose) break;
      fcs = [{ name: "answer", args: { text: prose, grounding: GROUNDING.STORY, block_ids: [], passage_ids: [] } }];
      contents.push({ role: "model", parts: [{ functionCall: fcs[0] }] });
    } else {
      contents.push({ role: "model", parts: r.parts && r.parts.length ? r.parts : fcs.map((fc) => ({ functionCall: fc })) });
    }
    const responses = [];
    for (const fc of fcs) {
      if (answer) break;
      let out;
      if (calls.length >= MAX_TOOL_CALLS && fc.name !== "answer") out = { result: "refused: enough reading; call answer now" };
      else out = applyTool(fc, ctx);
      calls.push({ name: fc.name, args: fc.args || {}, result: out.result });
      await onProgress({ tool: fc.name, summary: describeCall(fc), result: out.result });
      responses.push({ functionResponse: { name: fc.name, response: { result: out.result } } });
      if (out.finished) answer = out.answer;
    }
    if (!answer) contents.push({ role: "user", parts: responses });
  }

  return { answer, calls, usage, agentVersion: AGENT_VERSION };
}

module.exports = {
  AGENT_VERSION, MAX_STEPS, MAX_TOOL_CALLS, MAX_QUESTION_CHARS, ANSWER_WORDS, GROUNDING, TOOL_DECLARATIONS,
  buildSystem, blocksFromStory, renderBlocks, renderPassages, applyTool, describeCall, runReadingAgent, plain, wordCount,
  URL_RE, EMAIL_RE, PHONE_RE, PERSONAL_RE,
};
