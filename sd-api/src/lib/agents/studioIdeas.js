"use strict";

/**
 * Ideas: what the studio agent could do next for this scholar, written by a
 * model that has read what is on the page.
 *
 * For a story in review, it reads the draft — every block, and what the
 * fact-checkers said about it — the record of the paper, the reader it is
 * for and the paragraph the scholar is on, and writes instructions the agent
 * could carry out next, grouped, most useful first. For a new story, it reads
 * the scholar's papers and writes briefs worth starting from, and may offer
 * to read a chosen paper and propose what it could become.
 *
 * Pure: the model is injected.
 */

const { AUDIENCES, normaliseAudience } = require("../audiences");

const IDEAS_VERSION = "studio-ideas-2026.2";
const MARKER_STORY = "DRAFT TO SUGGEST EDITS FOR:";
const MARKER_NEW = "PAPERS TO SUGGEST ARTICLES FROM:";

const ACTIONS = ["prefill", "propose"];
const schemaFor = (actions) => ({
  type: "OBJECT",
  properties: {
    groups: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          ideas: { type: "ARRAY", items: { type: "OBJECT", properties: { text: { type: "STRING" }, action: { type: "STRING", enum: actions } }, required: ["text", "action"] } },
        },
        required: ["title", "ideas"],
      },
    },
  },
  required: ["groups"],
});
const SCHEMA = schemaFor(ACTIONS);
/* A story in review is changed by instruction; proposing what a paper could become is for a new story. */
const STORY_SCHEMA = schemaFor(["prefill"]);

const STORY_SYSTEM = [
  "You suggest what an editing agent could do next to a scholar's draft article about their own paper.",
  "Every idea is an instruction to change the draft that the agent can carry out, written so the scholar could send",
  "it as it stands, naming paragraphs by number: \"Rewrite paragraph 3 so ...\", \"Shorten the opening to ...\".",
  "Never write a status report, a notice to the scholar, or that nothing needs doing: if nothing needs doing first,",
  "leave that group out. Put first what most needs doing — paragraphs the checkers flagged; a short notice to readers",
  "at the top, only when the paper's record has changed; the paragraph the scholar is on — then improvements for this",
  "reader. Never suggest adding facts from outside the paper; suggest implications drawn from it, said as implications.",
].join("\n");

const NEW_SYSTEM = [
  "You suggest articles a scholar could write about their own research papers, for readers outside their field.",
  "Each idea is a brief the scholar could send as written: what to focus on and who it is for. Draw on the titles you",
  "are given and do not invent findings. When a paper is chosen, the first idea is to have the agent read it and",
  "propose what it could become, with action propose; every other idea has action prefill.",
].join("\n");

function blockLine(b) {
  const notes = [];
  if (b.fidelity) notes.push(`checker: ${b.fidelity}`);
  if (b.reach) notes.push(`beyond the paper: ${b.reach}`);
  if (b.ownView) notes.push("the scholar's own view");
  if (b.edited) notes.push("rewritten by the scholar since drafting");
  return `[${b.index}] (${b.type})${notes.length ? ` {${notes.join("; ")}}` : ""} ${b.text}`;
}

function parseGroups(raw, count) {
  try {
    const j = JSON.parse(String(raw || "").replace(/^```(?:json)?\s*|\s*```$/g, ""));
    let left = count;
    return (Array.isArray(j.groups) ? j.groups : [])
      .map((g) => ({ title: String(g?.title || "").trim().slice(0, 60), ideas: Array.isArray(g?.ideas) ? g.ideas : [] }))
      .filter((g) => g.title)
      .map((g) => {
        const ideas = g.ideas
          .map((i) => ({ text: String(i?.text || "").trim(), action: ACTIONS.includes(i?.action) ? i.action : "prefill" }))
          .filter((i) => i.text)
          .slice(0, Math.max(0, left));
        left -= ideas.length;
        return { title: g.title, ideas };
      })
      .filter((g) => g.ideas.length);
  } catch {
    return [];
  }
}

/** Ideas for a story in review. */
async function ideasForStory({ title, blocks, record = null, audience, focusIndex = null, count, generate }) {
  const aud = AUDIENCES[normaliseAudience(audience)];
  const prompt = [
    `THE READER THE ARTICLE IS FOR: ${aud.readers}.`,
    `HOW MANY IDEAS, IN ALL: about ${count}`,
    focusIndex ? `THE SCHOLAR IS ON PARAGRAPH: ${focusIndex}` : "NO PARAGRAPH IN FOCUS",
    record ? `THE PAPER'S RECORD: ${record}` : "THE PAPER'S RECORD: nothing has changed",
    "",
    `${MARKER_STORY} ${title || "(untitled)"}`,
    ...blocks.map(blockLine),
  ].join("\n");
  const r = await generate({ prompt, systemInstruction: STORY_SYSTEM, responseSchema: STORY_SCHEMA });
  return { groups: parseGroups(r.text, count), usage: r.usage || null, model: r.model || null };
}

/** Ideas before there is a story. */
async function ideasForNewStory({ papers, chosen = null, count, generate }) {
  const prompt = [
    `HOW MANY IDEAS, IN ALL: about ${count}`,
    chosen ? `THE CHOSEN PAPER: ${chosen.title}` : "NO PAPER CHOSEN YET",
    "",
    MARKER_NEW,
    ...papers.map((p) => `- ${p.title}${p.year ? ` (${p.year})` : ""}`),
  ].join("\n");
  const r = await generate({ prompt, systemInstruction: NEW_SYSTEM, responseSchema: SCHEMA });
  return { groups: parseGroups(r.text, count), usage: r.usage || null, model: r.model || null };
}

module.exports = { IDEAS_VERSION, MARKER_STORY, MARKER_NEW, ACTIONS, SCHEMA, STORY_SCHEMA, ideasForStory, ideasForNewStory, parseGroups };
