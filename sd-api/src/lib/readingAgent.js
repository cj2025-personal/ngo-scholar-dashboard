"use strict";

/**
 * The reading companion: a reader's question about a story, answered from
 * the story and the paper behind it.
 *
 * ── The shape ───────────────────────────────────────────────────────────────
 * The model is handed the article as numbered blocks at the level the reader
 * is on, the paper's passages, what has been said in this conversation, and
 * tools to read and to search by meaning. It decides what to read, when it
 * has read enough, how long the answer should be for this reader, whether the
 * question needs a clarifying question back, and what the reader might want
 * to ask next. Each tool call carries the agent's own one-line reason, which
 * is what the reader watches while it works.
 *
 * ── Four kinds of answer ────────────────────────────────────────────────────
 *   story        everything said is in the blocks or passages it cites.
 *   background   a plain definition of a word the text uses but never explains.
 *   not_here     the story does not say; said kindly, pointing nearby.
 *   clarify      the question could mean more than one thing in this story;
 *                the agent asks which, instead of guessing.
 *
 * ── Who checks what ─────────────────────────────────────────────────────────
 * The agent is told the rules; the Sentinel (lib/sentinel.js), a separate
 * model that never sees these instructions, rules on every answer before a
 * reader sees it. The only thing checked here is that what the answer cites
 * exists, because a citation that points nowhere cannot be shown.
 *
 * Pure: the model and the search are injected; every limit comes from policy.
 */

const { AUDIENCES, normaliseAudience } = require("./audiences");

const AGENT_VERSION = "reading-agent-2026.2";

const GROUNDING = { STORY: "story", BACKGROUND: "background", NOT_HERE: "not_here", CLARIFY: "clarify" };
const GROUNDINGS = new Set(Object.values(GROUNDING));
const INTENTS = ["explain", "define", "evidence", "summary", "quiz", "compare", "clarify", "not_in_story", "other"];

/* ── tools ───────────────────────────────────────────────────────────────── */

const REASON = { type: "STRING", description: "One short sentence, spoken to the reader, saying what you are doing and why. Shown live while you work." };

function toolDeclarations({ maxFollowUps }) {
  return [
    {
      name: "read_block",
      description: "Read one block of the story in full, with the passages of the paper it cites.",
      parameters: { type: "OBJECT", properties: { index: { type: "INTEGER", description: "Block number as shown, 1-based." }, reason: REASON }, required: ["index", "reason"] },
    },
    {
      name: "read_passage",
      description: "Read one passage of the paper in full, by id, e.g. \"p3\".",
      parameters: { type: "OBJECT", properties: { id: { type: "STRING" }, reason: REASON }, required: ["id", "reason"] },
    },
    {
      name: "search",
      description: "Search the story and the paper by meaning. Returns the blocks and passages closest to what you describe, best first, with a similarity score.",
      parameters: { type: "OBJECT", properties: { query: { type: "STRING", description: "What you are looking for, in a phrase or a sentence." }, reason: REASON }, required: ["query", "reason"] },
    },
    {
      name: "answer",
      description: "Give the reader your answer. This is the only thing the reader sees. Cite every block and passage the answer rests on.",
      parameters: {
        type: "OBJECT",
        properties: {
          text: { type: "STRING", description: "The answer, spoken to the reader. Plain text." },
          grounding: { type: "STRING", enum: [...GROUNDINGS], description: "story: everything said is in the cited blocks or passages. background: a plain definition of a word the text uses. not_here: the story does not say this. clarify: you are asking the reader which part they mean." },
          intent: { type: "STRING", enum: INTENTS, description: "What kind of answer this is." },
          block_ids: { type: "ARRAY", items: { type: "STRING" }, description: "Blocks the answer rests on, e.g. [\"b3\"]. For not_here or clarify, the blocks you are pointing the reader to, if any." },
          passage_ids: { type: "ARRAY", items: { type: "STRING" }, description: "Passages of the paper the answer rests on, e.g. [\"p2\"]." },
          term: { type: "STRING", description: "For background only: the word being defined, as the text uses it." },
          follow_ups: { type: "ARRAY", items: { type: "STRING" }, description: `Up to ${maxFollowUps} short questions this reader might want to ask next, each answerable from this story.` },
          reason: REASON,
        },
        required: ["text", "grounding", "intent", "reason"],
      },
    },
  ];
}

/* ── the prompt ──────────────────────────────────────────────────────────── */

function buildSystem({ audience = "adults", maxFollowUps = 3 } = {}) {
  const aud = AUDIENCES[normaliseAudience(audience)];
  return [
    "You are a reading companion on Archivyn, sitting beside a reader as they read an article about a research paper.",
    `The reader: ${aud.brief}`,
    "You answer ONLY by calling the `answer` tool. Nothing you say outside it is shown.",
    "",
    "How to work:",
    "- Think about what the reader is really asking, then read before you answer: read the block they are looking at,",
    "  search the story and the paper by meaning, read the passages a block cites. Stop when you have enough.",
    "- Every tool call carries a short reason, spoken to the reader, saying what you are doing.",
    "",
    "What a good answer is — a separate reviewer checks every answer against these before the reader sees it:",
    "1. Everything you say comes from the story's blocks or the paper's passages, and you cite them. Never bring in",
    "   what you know from elsewhere, never guess.",
    "2. If the story and the paper do not say it, say so kindly (grounding not_here) and point to the nearest paragraph.",
    "3. If the question could mean more than one thing in this story, ask which (grounding clarify), offering the",
    "   choices, rather than guessing.",
    "4. A plain definition of a word the text uses but never explains is allowed (grounding background, the word in",
    "   `term`); it names no number, date, person, place, product or study, because nobody checked those.",
    "5. Never ask the reader about themselves, never repeat anything they said about themselves, and never give a",
    "   link, an address or contact details. The article is the subject; no advice about the reader's own life.",
    "6. Asked for a quiz, ask a few questions a cited paragraph answers, without giving the answers.",
    "7. Decide the length yourself: as short as answers this reader fully. A companion answers; it does not lecture.",
    "   Speak to the reader directly, in words they use, never talking down.",
    "8. Nothing frightening, graphic or unsuitable for this reader, however the question is put.",
    `9. Offer up to ${maxFollowUps} follow-up questions the reader might want next, each answerable from this story.`,
  ].join("\n");
}

const plain = (html) =>
  String(html || "").replace(/<[^>]+>/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();

/**
 * The story as the agent reads it: text blocks numbered from 1, images skipped.
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

/* ── carrying out a tool call ────────────────────────────────────────────── */

/**
 * @param {object} fc   {name, args}
 * @param {object} ctx  {blocks, passages, search: async (query) => [{id, text, score}], maxFollowUps}
 * @returns {Promise<{result: string, finished?: boolean, answer?: object}>}
 */
async function applyTool(fc, ctx) {
  const args = fc.args || {};
  const blocks = ctx.blocks || [];
  const passages = ctx.passages || [];
  const byBlock = new Map(blocks.map((b) => [b.id, b]));
  const byPassage = new Map(passages.map((p) => [p.id, p]));

  switch (fc.name) {
    case "read_block": {
      const n = Number(args.index);
      const b = blocks[n - 1];
      if (!Number.isInteger(n) || !b) return { result: `there is no block ${args.index}; blocks run 1 to ${blocks.length}` };
      const cited = b.passageIds.map((id) => byPassage.get(id)).filter(Boolean);
      return { result: [`[${b.id}] (${b.type}): ${b.text}`, ...cited.map((p) => `  [${p.id}] ${p.text}`)].join("\n") };
    }
    case "read_passage": {
      const p = byPassage.get(String(args.id || "").trim());
      if (!p) return { result: `there is no passage ${args.id}` };
      return { result: `[${p.id}] ${p.text}` };
    }
    case "search": {
      const q = String(args.query || "").trim();
      if (!q) return { result: "say what to look for" };
      const hits = ctx.search ? await ctx.search(q) : [];
      return { result: hits.length ? hits.map((h) => `[${h.id}] (similarity ${h.score.toFixed(2)}) ${h.text.slice(0, 500)}`).join("\n\n") : "nothing in the story or the paper is close to that" };
    }
    case "answer": {
      const text = String(args.text || "").trim();
      if (!text) return { result: "the answer is empty; write it" };
      const grounding = GROUNDINGS.has(args.grounding) ? args.grounding : null;
      if (!grounding) return { result: `grounding must be one of ${[...GROUNDINGS].join(", ")}` };
      const blockIds = [...new Set((Array.isArray(args.block_ids) ? args.block_ids : []).map((v) => String(v).trim()).filter(Boolean))];
      const passageIds = [...new Set((Array.isArray(args.passage_ids) ? args.passage_ids : []).map((v) => String(v).trim()).filter(Boolean))];
      /* A citation must point at something the reader can open. */
      const unknown = [...blockIds.filter((id) => !byBlock.has(id)), ...passageIds.filter((id) => !byPassage.has(id))];
      if (unknown.length) return { result: `these do not exist: ${unknown.join(", ")}; cite only blocks and passages shown` };
      const followUps = (Array.isArray(args.follow_ups) ? args.follow_ups : []).map((s) => String(s || "").trim()).filter(Boolean).slice(0, ctx.maxFollowUps);
      return {
        result: "ok",
        finished: true,
        answer: {
          text, grounding,
          intent: INTENTS.includes(args.intent) ? args.intent : "other",
          blockIds, passageIds,
          term: grounding === GROUNDING.BACKGROUND ? String(args.term || "").trim() || null : null,
          followUps,
          words: wordCount(text),
        },
      };
    }
    default:
      return { result: `there is no tool called ${fc.name}` };
  }
}

/* ── the loop ────────────────────────────────────────────────────────────── */

/**
 * Answer one question.
 *
 * @param {object} p
 * @param {object[]} p.blocks
 * @param {{id,text}[]} p.passages
 * @param {string} p.question
 * @param {string} [p.storyTitle]
 * @param {number|null} [p.focusIndex]
 * @param {{role:string,text:string}[]} [p.history]   recent turns, oldest first
 * @param {string|null} [p.threadSummary]               what was said before those
 * @param {string} [p.audience]
 * @param {string[]} [p.revise]                         the reviewer's guidance on the last answer
 * @param {{maxSteps:number, maxToolCalls:number, maxFollowUps:number}} p.limits
 * @param {(q:string)=>Promise<object[]>} [p.search]
 * @param {(req:object)=>Promise<object>} p.generate
 * @param {(e:{tool:string,summary:string,result:string})=>Promise<void>} [p.onProgress]
 */
async function runReadingAgent({ blocks, passages, question, storyTitle = "", focusIndex = null, history = [], threadSummary = null, audience = "adults", revise = [], limits, search = null, generate, onProgress = async () => {} }) {
  const ctx = { blocks, passages, search, maxFollowUps: limits.maxFollowUps };
  const calls = [];
  const usage = [];
  const models = [];
  const focus = Number.isInteger(focusIndex) && blocks[focusIndex - 1] ? blocks[focusIndex - 1] : null;

  const opening = [
    `THE STORY${storyTitle ? `: ${storyTitle}` : ""}`,
    renderBlocks(blocks),
    "",
    "PASSAGES OF THE PAPER (cite by id):",
    renderPassages(passages),
    "",
    ...(threadSummary ? ["EARLIER IN THIS CONVERSATION, IN SHORT:", threadSummary, ""] : []),
    ...(history.length ? ["MOST RECENTLY IN THIS CONVERSATION:", ...history.map((h) => `${h.role === "user" ? "Reader" : "You"}: ${h.text}`), ""] : []),
    ...(focus ? [`THE READER IS LOOKING AT: [${focus.id}]`, ""] : []),
    ...(revise.length ? ["A REVIEWER SENT YOUR LAST ANSWER BACK. Their guidance:", ...revise.map((r) => `- ${r}`), ""] : []),
    `THE READER ASKS: ${String(question || "").trim()}`,
  ].join("\n");

  const contents = [{ role: "user", parts: [{ text: opening }] }];
  const tools = [{ functionDeclarations: toolDeclarations(limits) }];
  const system = buildSystem({ audience, maxFollowUps: limits.maxFollowUps });
  let answer = null;

  for (let step = 0; step < limits.maxSteps && !answer; step += 1) {
    /* When the budget is nearly spent, the only tool left is the answer. */
    const lastStep = step === limits.maxSteps - 1 || calls.length >= limits.maxToolCalls;
    const r = await generate({
      contents,
      systemInstruction: system,
      tools,
      toolConfig: { functionCallingConfig: lastStep ? { mode: "ANY", allowedFunctionNames: ["answer"] } : { mode: "ANY" } },
    });
    if (r.usage) usage.push(r.usage);
    if (r.model) models.push(r.model);
    let fcs = r.functionCalls || [];
    if (!fcs.length) {
      const prose = (r.text || "").trim();
      if (!prose) break;
      /* Prose instead of a tool: treated as an answer with nothing cited, which the reviewer will rule on. */
      fcs = [{ name: "answer", args: { text: prose, grounding: GROUNDING.STORY, intent: "other", reason: "Answering" } }];
      contents.push({ role: "model", parts: [{ functionCall: fcs[0] }] });
    } else {
      contents.push({ role: "model", parts: r.parts && r.parts.length ? r.parts : fcs.map((fc) => ({ functionCall: fc })) });
    }
    const responses = [];
    for (const fc of fcs) {
      if (answer) break;
      const out = await applyTool(fc, ctx);
      const summary = String(fc.args?.reason || "").trim();
      calls.push({ name: fc.name, args: fc.args || {}, result: out.result });
      await onProgress({ tool: fc.name, summary, result: out.result });
      responses.push({ functionResponse: { name: fc.name, response: { result: out.result } } });
      if (out.finished) answer = out.answer;
    }
    if (!answer) contents.push({ role: "user", parts: responses });
  }

  return { answer, calls, usage, models, agentVersion: AGENT_VERSION };
}

module.exports = {
  AGENT_VERSION, GROUNDING, INTENTS, toolDeclarations,
  buildSystem, blocksFromStory, renderBlocks, renderPassages, applyTool, runReadingAgent, plain, wordCount,
};
