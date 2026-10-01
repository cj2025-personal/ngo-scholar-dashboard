"use strict";

/**
 * A reading of the assembled article, by a model, for the three things no
 * paragraph-level judge can see.
 *
 * ── Headings ────────────────────────────────────────────────────────────────
 * Every judge reads paragraphs, so headings and the title were the one part
 * of an article nothing read. Asked to link a signal-processing paper to
 * cancer, the drafter obeyed where it could not be caught: "Potential
 * Applications in Cancer Treatment and Protein Folding" sat over paragraphs
 * that said nothing of the kind. That was caught by looking for heading words
 * absent from the article and the paper — with a list of two hundred
 * everyday words to ignore, a stemmer, and a rule that one odd word is
 * imagery and two are a topic. A model reads the heading against what is
 * said and decides whether it promises something unsaid.
 *
 * ── Whose pronoun ───────────────────────────────────────────────────────────
 * Sections are drafted by separate calls, so they can disagree about the
 * scholar's pronoun — and did, under a real name. Counting he and she cannot
 * tell the scholar from a colleague the paper names; the model says which
 * pronoun, in which paragraph, stands for the scholar. Whether they agree is
 * then a count, in code.
 *
 * ── Rhythm ──────────────────────────────────────────────────────────────────
 * Whether the prose drones. The opening-word counts are given as evidence,
 * as the reading grade is to the band judge; the model weighs them.
 *
 * Pure: the model is injected. One call per assembled article; `only`
 * re-reads just the headings a repair rewrote.
 */

const REVIEW_VERSION = "article-review-2026.4";
const MARKER = "ARTICLE TO REVIEW:";
const PRONOUNS = ["he", "she", "they"];

const SYSTEM = [
  "You review an article about a scholar's research paper before the scholar reads it. You do not rewrite it.",
  "",
  "1. Headings and the title. A heading may frame a section in its own words, and may use imagery. A framing heading —",
  "   why this matters, what it means, how it works, where it breaks, what comes next — promises only that the section",
  "   answers it in some way, and almost any honest section does. A heading fails only when it names a specific topic",
  "   — a field, a disease, a technology or product, an organisation, a place, an application, a result — that",
  "   is said nowhere: not in the section under it, not anywhere else in the article, not in the paper. If any",
  "   paragraph of the article says it, the heading may name it, even when the paper does not — whether those",
  "   paragraphs may say it is other judges' work, not yours. The paper's own work is always said: a heading may call",
  "   it the study, the trial, the experiment, the method, the research or its results, whatever words the paper",
  "   uses. Do not fail a heading for promising significance, depth",
  "   or breadth. For each heading listed, say whether it names something said nowhere; if so, `unsaid` is that topic",
  "   in two to five words, as the heading names it (\"cancer treatment\"), not a sentence.",
  "2. Whose pronoun. For each paragraph where he, she or they refers to the scholar themselves — not to another person",
  "   the paper names — give that pronoun. Leave out paragraphs where none does.",
  "3. Rhythm. Whether the prose drones: sentences opening the same way again and again, paragraphs that never join to",
  "   the one before, a sameness a reader feels as flatness. Counts of sentence openings are given as evidence; weigh",
  "   them. If it drones, say in one sentence what the writer could change.",
].join("\n");

const idForBlock = (b, i) => `${b.type === "subheading" || b.type === "heading" ? "H" : "B"}${i + 1}`;

/**
 * @param {object} p
 * @param {string|null} p.title
 * @param {{type:string, text:string}[]} p.blocks   plain text, in order
 * @param {{id:string, text:string}[]} p.passages
 * @param {string[]|null} [p.only]   heading ids to re-read; nothing else is asked
 */
function plan({ title, blocks, passages, only = null }) {
  const headingIds = [...(title ? ["TITLE"] : []), ...blocks.map((b, i) => (b.type === "subheading" || b.type === "heading" ? idForBlock(b, i) : null)).filter(Boolean)];
  const paragraphIds = blocks.map((b, i) => (b.type === "paragraph" ? idForBlock(b, i) : null)).filter(Boolean);
  const asked = only ? headingIds.filter((id) => only.includes(id)) : headingIds;
  return { asked, paragraphIds: only ? [] : paragraphIds, rhythm: !only, passages };
}

function schemaFor(p) {
  const properties = {};
  const required = [];
  if (p.asked.length) {
    properties.headings = { type: "ARRAY", items: { type: "OBJECT", properties: { id: { type: "STRING", enum: p.asked }, promises_unsaid: { type: "BOOLEAN" }, unsaid: { type: "STRING" } }, required: ["id", "promises_unsaid", "unsaid"] } };
    required.push("headings");
  }
  if (p.paragraphIds.length) {
    properties.author_pronouns = { type: "ARRAY", items: { type: "OBJECT", properties: { id: { type: "STRING", enum: p.paragraphIds }, pronoun: { type: "STRING", enum: PRONOUNS } }, required: ["id", "pronoun"] } };
    required.push("author_pronouns");
  }
  if (p.rhythm) {
    properties.rhythm = { type: "OBJECT", properties: { droning: { type: "BOOLEAN" }, note: { type: "STRING" } }, required: ["droning", "note"] };
    required.push("rhythm");
  }
  return { type: "OBJECT", properties, required };
}

function buildPrompt({ title, blocks, passages, voice, scholarName, openers = [], repeatedRuns = 0, sentences = 0, only = null }) {
  return [
    `THE VOICE: ${voice === "author" ? "author — the scholar's own account under their byline" : "about — an article about the scholar"}`,
    `THE SCHOLAR: ${scholarName || "(name not known)"}`,
    ...(only
      ? [`JUDGE ONLY THESE HEADINGS: ${only.join(", ")}`]
      : [`SENTENCE OPENINGS: ${openers.length ? openers.map((o) => `“${o.word}” opens ${o.n} of ${sentences}`).join("; ") : "none counted"}; ${repeatedRuns} run${repeatedRuns === 1 ? "" : "s"} of three sentences opening the same way`]),
    "",
    "THE PAPER, IN PASSAGES:",
    ...passages.map((x) => `[${x.id}] ${String(x.text || "").replace(/\s+/g, " ").trim()}`),
    "",
    MARKER,
    ...(title ? [`[TITLE] ${title}`] : []),
    ...blocks.map((b, i) => `[${idForBlock(b, i)}] (${b.type === "subheading" || b.type === "heading" ? "heading" : b.type}) ${b.text}`),
  ].join("\n");
}

function parse(raw, p, { title, blocks }) {
  let j;
  try { j = JSON.parse(String(raw || "").replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { return null; }
  if (!j || typeof j !== "object") return null;
  const headings = new Map();
  for (const h of Array.isArray(j.headings) ? j.headings : []) {
    if (p.asked.includes(h?.id) && !headings.has(h.id)) headings.set(h.id, { promisesUnsaid: h.promises_unsaid === true, unsaid: String(h.unsaid || "").replace(/\s+/g, " ").trim().slice(0, 200) });
  }
  /* Every heading asked about must be answered, or the reading is not one. */
  if (headings.size !== p.asked.length) return null;
  if (p.rhythm && (!j.rhythm || typeof j.rhythm.droning !== "boolean")) return null;
  const indexOf = (id) => (id === "TITLE" ? null : Number(id.slice(1)));
  return {
    headings: p.asked.map((id) => ({
      id,
      index: indexOf(id),
      kind: id === "TITLE" ? "title" : "heading",
      text: id === "TITLE" ? String(title || "") : blocks[indexOf(id) - 1].text,
      ...headings.get(id),
    })),
    pronouns: (Array.isArray(j.author_pronouns) ? j.author_pronouns : [])
      .filter((x) => p.paragraphIds.includes(x?.id) && PRONOUNS.includes(x?.pronoun))
      .map((x) => ({ index: indexOf(x.id), pronoun: x.pronoun })),
    rhythm: p.rhythm ? { droning: j.rhythm.droning, note: String(j.rhythm.note || "").replace(/\s+/g, " ").trim().slice(0, 300) } : null,
  };
}

/**
 * Review the assembled article. One correction round when the reading is
 * not legible or leaves a heading out; after that it is returned unchecked,
 * and callers say so rather than pass anything.
 *
 * @param {object} p
 * @param {string|null} p.title
 * @param {{type:string, text:string}[]} p.blocks      the article's blocks, plain text
 * @param {{id:string, text:string}[]} p.passages
 * @param {"author"|"about"} p.voice
 * @param {string|null} [p.scholarName]
 * @param {{word:string, n:number}[]} [p.openers]     the commonest sentence openings, counted
 * @param {number} [p.repeatedRuns]
 * @param {number} [p.sentences]
 * @param {string[]|null} [p.only]
 * @param {Function} p.generate
 * @returns {Promise<{headings: object[], pronouns: {index:number, pronoun:string}[], rhythm: {droning:boolean, note:string}|null, unchecked: boolean, version: string, calls: object[]}>}
 */
async function reviewArticle({ title = null, blocks, passages, voice, scholarName = null, openers = [], repeatedRuns = 0, sentences = 0, only = null, generate }) {
  const p = plan({ title, blocks, passages, only });
  const empty = { headings: [], pronouns: [], rhythm: null, version: REVIEW_VERSION };
  if (!p.asked.length && !p.paragraphIds.length) return { ...empty, unchecked: false, calls: [] };
  const prompt = buildPrompt({ title, blocks, passages, voice, scholarName, openers, repeatedRuns, sentences, only });
  const calls = [];
  for (let round = 0; round < 2; round += 1) {
    const r = await generate({
      prompt: round ? `${prompt}\n\nYOUR LAST REVIEW COULD NOT BE READ, OR LEFT A HEADING OUT. Review again, every heading listed.` : prompt,
      systemInstruction: SYSTEM,
      responseSchema: schemaFor(p),
    });
    calls.push({ step: "review_article", usage: r.usage || null, model: r.model || r.modelVersion || null, promptVersion: REVIEW_VERSION, only: only ? only.length : null });
    const out = parse(r.text, p, { title, blocks });
    if (out) return { ...out, unchecked: false, version: REVIEW_VERSION, calls };
  }
  return { ...empty, unchecked: true, calls };
}

module.exports = { REVIEW_VERSION, MARKER, PRONOUNS, SYSTEM, idForBlock, plan, schemaFor, buildPrompt, parse, reviewArticle };
