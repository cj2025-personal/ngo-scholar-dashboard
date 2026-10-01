"use strict";

/**
 * The companion's memory of a long conversation about one story.
 *
 * The most recent turns are given to the companion word for word. What came
 * before them is folded, by a model, into a short running summary: what the
 * reader has asked about, what they have been told, what they seemed unsure
 * of. Each new summary is written from the last one and the turns that have
 * just aged out of the recent window, so the cost stays flat however long
 * the conversation runs.
 *
 * It remembers the conversation, never the person: questions reach it with
 * personal details already masked, and it is told to keep none.
 *
 * Pure: the model is injected.
 */

const MEMORY_VERSION = "reader-memory-2026.1";
const MARKER = "THREAD TO SUMMARISE:";

const SYSTEM = [
  "You keep a short running summary of a conversation between a reader and a reading companion about one article.",
  "Write what the reader has asked about, what they were told, and anything they seemed unsure of or keen on, so the",
  "companion can carry on naturally. Keep nothing about the reader as a person — no names, ages, places or details",
  "of their life — even if it appears. Plain sentences. Stay within the word limit you are given.",
].join("\n");
const SCHEMA = { type: "OBJECT", properties: { summary: { type: "STRING" } }, required: ["summary"] };

/**
 * @param {object} p
 * @param {string|null} p.previous          the summary so far
 * @param {{question:string, answer:string}[]} p.turns   turns leaving the recent window, oldest first
 * @param {number} p.maxWords
 * @param {(req:object)=>Promise<object>} p.generate
 * @returns {Promise<{summary: string|null, usage, model}>}
 */
async function summarise({ previous = null, turns, maxWords, generate }) {
  if (!turns?.length) return { summary: previous, usage: null, model: null };
  const prompt = [
    `WORD LIMIT: ${maxWords}`,
    `SUMMARY SO FAR: ${previous || "(none yet)"}`,
    "",
    MARKER,
    ...turns.map((t) => `Reader: ${t.question}\nCompanion: ${t.answer}`),
  ].join("\n");
  const r = await generate({ prompt, systemInstruction: SYSTEM, responseSchema: SCHEMA });
  let summary = null;
  try { summary = String(JSON.parse(r.text).summary || "").trim() || null; } catch { summary = null; }
  return { summary: summary || previous, usage: r.usage || null, model: r.model || null };
}

module.exports = { MEMORY_VERSION, MARKER, SYSTEM, SCHEMA, summarise };
