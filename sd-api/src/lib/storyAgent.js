/**
 * The story agent: edit a draft by instruction, with tools, like a coding agent edits a repo.
 *
 * ── The shape ───────────────────────────────────────────────────────────────
 * The scholar types what they want: "shorten section two", "add the
 * limitation about multipath", "put an illustration of the array after the
 * first paragraph". The model is handed the draft as numbered blocks, the
 * passages of the paper, and a small set of tools that change the draft. It
 * calls tools; each call is applied to a working copy; when it calls
 * `finish` the working copy is diffed against the original and returned as
 * a PROPOSAL. Nothing touches the stored story until the scholar accepts.
 *
 * ── Why tools and not a rewrite ─────────────────────────────────────────────
 * A model asked to "return the edited article" rewrites paragraphs it was
 * not asked to touch, and every untouched paragraph loses its receipt. Tools
 * make edits explicit: a block that no tool touched is byte-identical and
 * keeps its provenance; a block a tool wrote carries the passages the tool
 * cited, and the fact-checker looks only at those. The diff the scholar
 * sees is the list of tool calls, in effect.
 *
 * ── What the agent may not do ───────────────────────────────────────────────
 * Publish. Change the byline. Cite a passage that does not exist. Write in
 * the first person. Add a fact without a passage (it may add a paragraph
 * marked as the scholar's own view only when the instruction says so, and a
 * paragraph that goes beyond the paper — an implication built on passages it
 * cites — only when asked what the work means or why it matters; the reach
 * judge then checks it). The model is told these; the reducer enforces the
 * ones it can.
 *
 * Pure: `applyTool` is a reducer over a plain state object; `runStoryAgent`
 * takes the model, the judge and the image maker as injected functions.
 */

const { AUDIENCES, normaliseAudience } = require("./audiences");
const composer = require("./draftComposer");
const AGENT_VERSION = "story-agent-2026.3";
const MAX_STEPS = 12;
const MAX_TOOL_CALLS = 24;

/* ── tools ───────────────────────────────────────────────────────────────── */

const TOOL_DECLARATIONS = [
  {
    name: "replace_block",
    description: "Replace the text of one existing text block (paragraph, subheading or quote). Cite every passage the new text draws on.",
    parameters: {
      type: "OBJECT",
      properties: {
        index: { type: "INTEGER", description: "Block number as shown, 1-based." },
        text: { type: "STRING", description: "The new plain text for the block. No HTML." },
        passage_ids: { type: "ARRAY", items: { type: "STRING" }, description: "Passages every fact in the new text comes from, e.g. [\"p3\"]. Empty only when own_view is true." },
        own_view: { type: "BOOLEAN", description: "True only when the scholar asked for their own commentary, not a claim from the paper." },
        extension: { type: "BOOLEAN", description: "True only when the scholar asked what the work means or why it matters: the text draws an implication from the passages in passage_ids, said as an implication, with no fact from outside the paper." },
      },
      required: ["index", "text", "passage_ids"],
    },
  },
  {
    name: "insert_block",
    description: "Insert a new text block after an existing block (after 0 = at the top).",
    parameters: {
      type: "OBJECT",
      properties: {
        after: { type: "INTEGER", description: "Insert after this block number; 0 for the top." },
        kind: { type: "STRING", enum: ["paragraph", "subheading", "quote"] },
        text: { type: "STRING" },
        passage_ids: { type: "ARRAY", items: { type: "STRING" } },
        own_view: { type: "BOOLEAN" },
        extension: { type: "BOOLEAN", description: "True only when the scholar asked what the work means or why it matters: an implication drawn from passage_ids, with no fact from outside the paper." },
      },
      required: ["after", "kind", "text", "passage_ids"],
    },
  },
  {
    name: "delete_block",
    description: "Remove a block.",
    parameters: { type: "OBJECT", properties: { index: { type: "INTEGER" } }, required: ["index"] },
  },
  {
    name: "move_block",
    description: "Move a block to a new position.",
    parameters: { type: "OBJECT", properties: { index: { type: "INTEGER" }, to: { type: "INTEGER", description: "New 1-based position." } }, required: ["index", "to"] },
  },
  {
    name: "set_heading_fields",
    description: "Change the story's title, subtitle (deck) or summary. Only the fields given change.",
    parameters: { type: "OBJECT", properties: { title: { type: "STRING" }, subtitle: { type: "STRING" }, excerpt: { type: "STRING" } } },
  },
  {
    name: "add_image",
    description: "Add an illustration after a block. Describe the picture plainly; it will be generated and labelled as an illustration, never presented as a figure from the paper.",
    parameters: {
      type: "OBJECT",
      properties: {
        after: { type: "INTEGER" },
        description: { type: "STRING", description: "What the picture should show, for the image model." },
        caption: { type: "STRING", description: "Caption shown to readers." },
        alt: { type: "STRING", description: "Alt text for screen readers." },
      },
      required: ["after", "description", "caption", "alt"],
    },
  },
  {
    name: "search_passages",
    description: "Find passages in the paper matching a phrase, to cite or to check whether the paper says something.",
    parameters: { type: "OBJECT", properties: { query: { type: "STRING" } }, required: ["query"] },
  },
  {
    name: "finish",
    description: "Stop, with a one- or two-sentence summary for the scholar of what changed and anything you could not do because the paper does not support it.",
    parameters: { type: "OBJECT", properties: { summary: { type: "STRING" } }, required: ["summary"] },
  },
];

/**
 * The agent's instructions, which depend on whose account the article is.
 * Rule 2 is the only difference: an article the scholar publishes as their
 * own work refers to them nowhere, so an edit must not put them back in.
 *
 * @param {object} [p]
 * @param {string} [p.voice]  composer.VOICE.AUTHOR or VOICE.ABOUT
 * @param {string|null} [p.scholarName]
 */
function buildSystem({ voice = composer.VOICE.ABOUT, scholarName = null } = {}) {
  const name = scholarName || "the scholar";
  const authorVoice = composer.normaliseVoice(voice) === composer.VOICE.AUTHOR;
  return [
  "You are an editing assistant for a scholar's article about their own research paper, on Archivyn.",
  "The scholar tells you what to change. You change the draft ONLY by calling the tools. Do not answer with prose except through `finish`.",
  "",
  "Rules, checked after you finish:",
  "1. Every factual claim you write must come from the passages shown, and the block you write must cite them in passage_ids.",
  "   If the scholar asks for something the passages do not support, do not invent it: leave it out and say so in `finish`.",
  authorVoice
    ? `2. This article is the scholar's own account, under their byline. Never refer to them: no "${name}", no "the author",` +
      '\n   no "he" or "she" standing for them. The work is the subject. No "I", "we", "my", "our" either, outside a verbatim quote.'
    : '2. Write about the scholar in the third person, never as them. No "I", "we", "my", "our" outside a verbatim quote.',
  "3. Touch only what the instruction asks for. Blocks you do not call a tool on stay exactly as they are.",
  "4. A quote block must be copied word for word from a passage.",
  "5. Use `own_view` only when the scholar explicitly asks for their own opinion or commentary to be added.",
  "6. Use `extension` only when the scholar asks what the work means, implies, or why it matters. Such a paragraph",
  "   still cites the passages it builds on, says what follows from them as an implication (\"which means\", \"would",
  "   matter wherever\"), never as a finding, and names no product, company, event, number or practice the",
  "   passages do not mention. A reviewer checks it claim by claim.",
  "7. Images are illustrations. Describe what to draw; never claim an image is from the paper.",
  "8. Keep the reading level the scholar chose; prefer short sentences and plain words.",
  "",
  "Work in small steps: call a tool, read the result, continue. Call `finish` when done.",
  ].join("\n");
}

/** The instructions for an article written about a scholar. Kept for callers that pass no voice. */
const SYSTEM = buildSystem();

/* ── state ───────────────────────────────────────────────────────────────── */

function escapeHtml(v) {
  return String(v || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function unescapeHtml(v) {
  return String(v || "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}
function plain(html) {
  return unescapeHtml(String(html || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/** A working state from a story as the API presents it (mapStoryDocument shape). */
function stateFromStory(story) {
  return {
    title: story.title || "",
    subtitle: story.subtitle || "",
    excerpt: story.excerpt || "",
    blocks: (story.bodyBlocks || []).map((b, i) =>
      b.type === "image"
        ? { key: `b${i + 1}`, type: "image", imageId: b.imageId || null, caption: b.caption || "", alt: b.alt || "", width: b.width || "body", url: b.url || null }
        : { key: `b${i + 1}`, type: b.type, html: b.html || "", sourceRefs: Array.isArray(b.sourceRefs) ? b.sourceRefs.map((r) => ({ passageId: r.passageId })) : [], draftedText: b.draftedText || "", fidelity: b.fidelity || null, ownView: Boolean(b.ownView), extension: Boolean(b.extension), reach: b.reach || null, context: b.context || null },
    ),
  };
}

/** The draft as the model reads it. */
function renderState(state) {
  const lines = [`TITLE: ${state.title || "(none)"}`, `SUBTITLE: ${state.subtitle || "(none)"}`, `SUMMARY: ${state.excerpt || "(none)"}`, "", "BLOCKS:"];
  state.blocks.forEach((b, i) => {
    const n = i + 1;
    if (b.type === "image") lines.push(`[${n}] (image) caption: ${b.caption || "(none)"}`);
    else {
      const refs = b.sourceRefs?.length ? ` ${b.extension ? "builds on" : "cites"} ${b.sourceRefs.map((r) => r.passageId).join(",")}` : b.ownView ? " (scholar's own view)" : " (no citation)";
      lines.push(`[${n}] (${b.type})${refs}: ${plain(b.html)}`);
    }
  });
  return lines.join("\n");
}

function renderPassages(passages) {
  return passages.map((p) => `[${p.id}] ${p.text}`).join("\n\n");
}

/* One definition of "the author speaking", shared with the drafter: "I" and
   "my" always, "we" and "our" only where they stand for the people who did
   the work. Two copies of this rule drifted apart once already — this one
   refused "things we use every day" in a paragraph written for a child. */
const FIRST_PERSON = { test: (t) => composer.firstPersonSentences(t).length > 0 };

/**
 * Apply one tool call to a state. Returns { state, result } where result is
 * what the model is told; a refused call returns the unchanged state and a
 * reason. Never throws on model input.
 */
function applyTool(state, call, ctx) {
  const { name, args = {} } = call;
  const known = new Set((ctx.passages || []).map((p) => p.id));
  const blocks = state.blocks.slice();
  const idx = (n) => Number(n) - 1;
  const inRange = (i) => Number.isInteger(i) && i >= 0 && i < blocks.length;
  const refsOf = (ids) => (Array.isArray(ids) ? ids.map(String).filter((id) => known.has(id)) : []);
  /* A paragraph is one of three things, never two: the paper's (cited), the
     scholar's own view (uncited), or built on the paper (cited, extension). */
  const textBlock = (kind, text, refs, ownView, extension) => ({
    key: `n${ctx.nextKey()}`, type: kind, html: escapeHtml(String(text || "").replace(/\s+/g, " ").trim()),
    sourceRefs: refs.map((passageId) => ({ passageId })), draftedText: "", fidelity: null, ownView: Boolean(ownView) && !extension,
    extension: kind === "paragraph" && Boolean(extension), reach: null, changed: true,
  });
  const checkText = (text, refs, ownView, kind, extension = false) => {
    const t = String(text || "").trim();
    if (!t) return "refused: empty text";
    if (kind !== "quote" && FIRST_PERSON.test(t)) return "refused: first-person wording; write about the scholar, not as them";
    /* An article published as the scholar's own work names them nowhere, so
       an edit must not put them back in. Their own view is theirs to assert,
       but it is still written without naming themselves. */
    if (kind !== "quote" && ctx.authorVoice && composer.selfReferenceSentences(t, ctx.scholarName).named.length) {
      return "refused: this article is the scholar's own work and never refers to them; make the work the subject of the sentence";
    }
    if (extension && refs.length === 0) return "refused: a paragraph that goes beyond the paper must cite the passages it builds on in passage_ids";
    if (refs.length === 0 && !ownView) return "refused: no valid passage_ids; cite the passages the text comes from, or set own_view if the scholar asked for their own commentary";
    if (kind === "quote" && refs.length && !refs.some((id) => ctx.isVerbatim(t, id))) return "refused: a quote must be copied word for word from the cited passage";
    return null;
  };

  switch (name) {
    case "replace_block": {
      const i = idx(args.index);
      if (!inRange(i)) return { state, result: `refused: no block ${args.index}` };
      if (blocks[i].type === "image") return { state, result: "refused: that block is an image; use delete_block or add_image" };
      const refs = refsOf(args.passage_ids);
      const extension = blocks[i].type === "paragraph" && args.extension === true;
      const bad = checkText(args.text, refs, args.own_view, blocks[i].type, extension);
      if (bad) return { state, result: bad };
      blocks[i] = { ...textBlock(blocks[i].type, args.text, refs, args.own_view, extension), key: blocks[i].key };
      return { state: { ...state, blocks }, result: `ok: block ${args.index} replaced` };
    }
    case "insert_block": {
      const after = Number(args.after);
      if (!Number.isInteger(after) || after < 0 || after > blocks.length) return { state, result: `refused: cannot insert after ${args.after}` };
      const kind = ["paragraph", "subheading", "quote"].includes(args.kind) ? args.kind : "paragraph";
      const refs = refsOf(args.passage_ids);
      const extension = kind === "paragraph" && args.extension === true;
      const bad = kind === "subheading" ? (String(args.text || "").trim() ? null : "refused: empty text") : checkText(args.text, refs, args.own_view, kind, extension);
      if (bad) return { state, result: bad };
      blocks.splice(after, 0, textBlock(kind, args.text, refs, args.own_view, extension));
      return { state: { ...state, blocks }, result: `ok: inserted as block ${after + 1}; later blocks are renumbered` };
    }
    case "delete_block": {
      const i = idx(args.index);
      if (!inRange(i)) return { state, result: `refused: no block ${args.index}` };
      blocks.splice(i, 1);
      return { state: { ...state, blocks }, result: `ok: block ${args.index} removed; later blocks are renumbered` };
    }
    case "move_block": {
      const i = idx(args.index);
      const to = idx(args.to);
      if (!inRange(i) || !inRange(to)) return { state, result: "refused: index out of range" };
      const [b] = blocks.splice(i, 1);
      blocks.splice(to, 0, { ...b, changed: true });
      return { state: { ...state, blocks }, result: `ok: block ${args.index} is now block ${args.to}` };
    }
    case "set_heading_fields": {
      const next = { ...state };
      const changed = [];
      for (const f of ["title", "subtitle", "excerpt"]) {
        if (typeof args[f] === "string" && args[f].trim()) {
          if (FIRST_PERSON.test(args[f])) return { state, result: `refused: ${f} uses first-person wording` };
          next[f] = composer.clampToSentence(args[f], f === "title" ? composer.LIMITS.MAX_TITLE_CHARS : composer.LIMITS.MAX_DECK_CHARS);
          changed.push(f);
        }
      }
      if (!changed.length) return { state, result: "refused: nothing to change" };
      return { state: next, result: `ok: ${changed.join(", ")} changed` };
    }
    case "add_image": {
      const after = Number(args.after);
      if (!Number.isInteger(after) || after < 0 || after > blocks.length) return { state, result: `refused: cannot insert after ${args.after}` };
      if (!ctx.imagesAllowed) return { state, result: "refused: images are not available on this deployment" };
      const description = String(args.description || "").trim();
      if (!description) return { state, result: "refused: describe the picture" };
      blocks.splice(after, 0, {
        key: `n${ctx.nextKey()}`, type: "image", pending: { description, caption: String(args.caption || "").trim(), alt: String(args.alt || "").trim() || description.slice(0, 120) },
        caption: String(args.caption || "").trim(), alt: String(args.alt || "").trim(), width: "body", changed: true, generated: true,
      });
      return { state: { ...state, blocks }, result: `ok: an illustration will be generated as block ${after + 1} and labelled as an illustration` };
    }
    case "search_passages": {
      const q = String(args.query || "").toLowerCase().split(/\W+/).filter((w) => w.length > 3);
      if (!q.length) return { state, result: "no query" };
      const hits = (ctx.passages || [])
        .map((p) => ({ p, score: q.filter((w) => p.text.toLowerCase().includes(w)).length }))
        .filter((h) => h.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 4);
      return { state, result: hits.length ? hits.map((h) => `[${h.p.id}] ${h.p.text.slice(0, 400)}`).join("\n\n") : "no passages match; the paper may not say this" };
    }
    case "finish":
      return { state, result: "done", finished: true, summary: String(args.summary || "").trim() };
    default:
      return { state, result: `refused: unknown tool ${name}` };
  }
}

/** Before/after, block by block, for the scholar to read. */
function diffStates(before, after) {
  const beforeByKey = new Map(before.blocks.map((b, i) => [b.key, { b, i }]));
  const afterKeys = new Set(after.blocks.map((b) => b.key));
  const changes = [];
  after.blocks.forEach((b, i) => {
    const prev = beforeByKey.get(b.key);
    if (!prev) changes.push({ kind: "added", index: i + 1, type: b.type, text: b.type === "image" ? b.caption || b.pending?.description || "" : plain(b.html) });
    else if (b.type !== "image" && plain(b.html) !== plain(prev.b.html)) changes.push({ kind: "changed", index: i + 1, type: b.type, before: plain(prev.b.html), text: plain(b.html) });
    else if (prev.i !== i && b.changed) changes.push({ kind: "moved", index: i + 1, from: prev.i + 1, type: b.type, text: b.type === "image" ? b.caption : plain(b.html) });
  });
  before.blocks.forEach((b, i) => {
    if (!afterKeys.has(b.key)) changes.push({ kind: "removed", index: i + 1, type: b.type, text: b.type === "image" ? b.caption : plain(b.html) });
  });
  for (const f of ["title", "subtitle", "excerpt"]) if ((before[f] || "") !== (after[f] || "")) changes.push({ kind: "field", field: f, before: before[f] || "", text: after[f] || "" });
  return changes;
}

/**
 * Run one instruction to a proposal.
 *
 * @param {object} p
 * @param {object} p.state         from stateFromStory
 * @param {{id,text}[]} p.passages
 * @param {string} p.instruction
 * @param {{role:string,text:string}[]} [p.history]   earlier turns, oldest first, for context
 * @param {string} [p.audience]
 * @param {(req:object)=>Promise<{text:string,functionCalls:object[],parts:object[],usage?:object}>} p.generate
 * @param {boolean} [p.imagesAllowed]
 * @param {(text:string, passageId:string)=>boolean} [p.isVerbatim]
 */
async function runStoryAgent({ state, passages, instruction, history = [], audience = "general", voice = composer.VOICE.ABOUT, scholarName = null, generate, imagesAllowed = false, isVerbatim = () => true, onProgress = async () => {} }) {
  let working = { ...state, blocks: state.blocks.map((b) => ({ ...b })) };
  let counter = 0;
  const authorVoice = composer.normaliseVoice(voice) === composer.VOICE.AUTHOR;
  const ctx = { passages, imagesAllowed, isVerbatim, authorVoice, scholarName, nextKey: () => ++counter };
  const calls = [];
  const usage = [];

  const opening = [
    `The reader this article is written for: ${AUDIENCES[normaliseAudience(audience)].brief}`,
    "",
    "THE DRAFT:",
    renderState(working),
    "",
    "PASSAGES OF THE PAPER (cite by id):",
    renderPassages(passages),
    "",
    ...(history.length ? ["EARLIER IN THIS CONVERSATION:", ...history.slice(-6).map((h) => `${h.role === "user" ? "Scholar" : "You"}: ${h.text}`), ""] : []),
    `THE SCHOLAR ASKS: ${instruction}`,
  ].join("\n");

  const contents = [{ role: "user", parts: [{ text: opening }] }];
  let summary = null;

  for (let step = 0; step < MAX_STEPS; step += 1) {
    const r = await generate({ contents, systemInstruction: buildSystem({ voice, scholarName }), tools: [{ functionDeclarations: TOOL_DECLARATIONS }], toolConfig: { functionCallingConfig: { mode: "ANY" } }, temperature: 0.2, maxOutputTokens: 2048 });
    if (r.usage) usage.push(r.usage);
    const fcs = r.functionCalls || [];
    if (!fcs.length) {
      /* Prose instead of a tool: treat as finish. */
      summary = (r.text || "").trim() || "No changes were made.";
      break;
    }
    contents.push({ role: "model", parts: r.parts && r.parts.length ? r.parts : fcs.map((fc) => ({ functionCall: fc })) });
    const responses = [];
    let finished = false;
    for (const fc of fcs) {
      if (calls.length >= MAX_TOOL_CALLS) { responses.push({ functionResponse: { name: fc.name, response: { result: "refused: too many changes in one instruction; call finish" } } }); continue; }
      const out = applyTool(working, fc, ctx);
      working = out.state;
      calls.push({ name: fc.name, args: fc.args, result: out.result });
      await onProgress({ tool: fc.name, result: out.result });
      responses.push({ functionResponse: { name: fc.name, response: { result: out.result } } });
      if (out.finished) { finished = true; summary = out.summary || "Done."; }
    }
    if (finished) break;
    contents.push({ role: "user", parts: responses });
  }
  if (summary === null) summary = "Stopped after the maximum number of steps; the changes so far are shown.";

  /* Drop the loop bookkeeping from the blocks handed back. */
  const changes = diffStates(state, working);
  return { state: working, changes, summary, calls, usage, agentVersion: AGENT_VERSION };
}

module.exports = { AGENT_VERSION, MAX_STEPS, TOOL_DECLARATIONS, SYSTEM, buildSystem, stateFromStory, renderState, applyTool, diffStates, runStoryAgent, plain };
