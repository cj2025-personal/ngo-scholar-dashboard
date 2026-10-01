"use strict";

/**
 * Questions worth asking about a story, written by a model that has read it.
 *
 * Replaces suggestions assembled from headings and digits. The model reads
 * the article at the reader's level, and the paragraph they are on if any,
 * and writes the questions a curious reader of that age would want answered,
 * grouped, each one answerable from the article. The service caches them per
 * story version, level and paragraph.
 *
 * Pure: the model is injected.
 */

const { AUDIENCES, normaliseAudience } = require("../audiences");

const SUGGEST_VERSION = "reader-suggest-2026.1";
const MARKER = "QUESTIONS TO SUGGEST FOR:";

const SYSTEM = [
  "You suggest questions a reader might ask a reading companion about an article they are reading.",
  "Write questions this reader, at their age, would genuinely want answered: what something means, how the researchers",
  "know, what a number shows, what was not tested, a quiz to check understanding. Every question must be answerable",
  "from the article itself. Short, in the reader's own words, never talking down. Group them under short titles;",
  "when a paragraph is in focus, the first group is about that paragraph.",
].join("\n");

const SCHEMA = {
  type: "OBJECT",
  properties: {
    groups: {
      type: "ARRAY",
      items: { type: "OBJECT", properties: { title: { type: "STRING" }, questions: { type: "ARRAY", items: { type: "STRING" } } }, required: ["title", "questions"] },
    },
  },
  required: ["groups"],
};

/**
 * @returns {Promise<{groups: {title:string, questions:string[]}[], usage, model}>}
 */
async function suggestQuestions({ title, blocks, audience, focus = null, count, generate }) {
  const aud = AUDIENCES[normaliseAudience(audience)];
  const prompt = [
    `THE READER: ${aud.readers}.`,
    `HOW MANY QUESTIONS, IN ALL: about ${count}`,
    focus ? `THE PARAGRAPH IN FOCUS: [b${focus}]` : "NO PARAGRAPH IN FOCUS",
    "",
    `${MARKER} ${title || "(untitled)"}`,
    ...blocks.map((b) => `[${b.id}] (${b.type}) ${b.text}`),
  ].join("\n");
  const r = await generate({ prompt, systemInstruction: SYSTEM, responseSchema: SCHEMA });
  let groups = [];
  try {
    const j = JSON.parse(r.text);
    groups = (Array.isArray(j.groups) ? j.groups : [])
      .map((g) => ({ title: String(g?.title || "").trim().slice(0, 60), questions: (Array.isArray(g?.questions) ? g.questions : []).map((q) => String(q || "").trim()).filter(Boolean).slice(0, count) }))
      .filter((g) => g.title && g.questions.length);
  } catch { groups = []; }
  return { groups, usage: r.usage || null, model: r.model || null };
}

module.exports = { SUGGEST_VERSION, MARKER, SYSTEM, SCHEMA, suggestQuestions };
