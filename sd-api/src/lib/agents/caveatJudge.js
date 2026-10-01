"use strict";

/**
 * Where a paper states its own limitations, found by a model that reads it.
 *
 * The most-omitted part of any popular account of research is the paper's
 * own caveats, so an article is told when it cites none of the passages that
 * state them. Which passages those are was a list of words — "limited",
 * "only", "did not" — two of which made a passage a caveat. "Only" is in
 * half the sentences of any paper, and a caveat said without any of the
 * words was missed. So a model reads the passages and names the ones where
 * the authors qualify their own results, and what the caveat is.
 *
 * Whether the article cites them is then a lookup, done in code
 * (`checks.limitationsCoverage`). Depends only on the paper, so callers
 * cache it per passage set.
 *
 * Pure: the model is injected.
 */

const CAVEAT_VERSION = "caveat-judge-2026.1";
const MARKER = "PASSAGES TO READ FOR CAVEATS:";

const SYSTEM = [
  "You read a research paper, given as numbered passages, and find where the authors state the limits of their own",
  "results: what was not tested or measured, conditions under which the results may not hold, a small sample or a",
  "narrow setting, assumptions the results rest on, what the authors say still needs work. Not the problem the paper",
  "set out to solve, and not the shortcomings of earlier methods the paper improves on — only the paper's caveats about",
  "itself. List each passage that states one, with a few words naming the caveat. A paper may state none.",
].join("\n");

const schemaFor = (passages) => ({
  type: "OBJECT",
  properties: {
    caveats: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { passage_id: { type: "STRING", enum: passages.map((p) => p.id) }, caveat: { type: "STRING" } },
        required: ["passage_id", "caveat"],
      },
    },
  },
  required: ["caveats"],
});

function buildPrompt(passages) {
  return [MARKER, ...passages.map((p) => `[${p.id}] ${String(p.text || "").replace(/\s+/g, " ").trim()}`)].join("\n");
}

function parse(raw, passages) {
  let j;
  try { j = JSON.parse(String(raw || "").replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { return null; }
  if (!Array.isArray(j?.caveats)) return null;
  const known = new Set(passages.map((p) => p.id));
  const seen = new Map();
  for (const c of j.caveats) {
    const id = String(c?.passage_id || "").trim();
    if (!known.has(id) || seen.has(id)) continue;
    seen.set(id, String(c?.caveat || "").replace(/\s+/g, " ").trim().slice(0, 160));
  }
  return [...seen.entries()].map(([id, caveat]) => ({ id, caveat }));
}

/**
 * @param {object} p
 * @param {{id:string, text:string}[]} p.passages
 * @param {(req:object)=>Promise<{text:string, usage?:object, model?:string}>} p.generate
 * @returns {Promise<{ids: string[], caveats: {id:string, caveat:string}[], unchecked: boolean, version: string, calls: object[]}>}
 */
async function findCaveats({ passages, generate }) {
  const list = (passages || []).filter((p) => p && p.id && String(p.text || "").trim());
  if (!list.length) return { ids: [], caveats: [], unchecked: false, version: CAVEAT_VERSION, calls: [] };
  const prompt = buildPrompt(list);
  const calls = [];
  for (let round = 0; round < 2; round += 1) {
    const r = await generate({ prompt: round ? `${prompt}\n\nYOUR LAST ANSWER COULD NOT BE READ. Answer again.` : prompt, systemInstruction: SYSTEM, responseSchema: schemaFor(list) });
    calls.push({ step: "judge_caveats", usage: r.usage || null, model: r.model || r.modelVersion || null, promptVersion: CAVEAT_VERSION });
    const caveats = parse(r.text, list);
    if (caveats) return { ids: caveats.map((c) => c.id), caveats, unchecked: false, version: CAVEAT_VERSION, calls };
  }
  return { ids: [], caveats: [], unchecked: true, version: CAVEAT_VERSION, calls };
}

module.exports = { CAVEAT_VERSION, MARKER, SYSTEM, schemaFor, buildPrompt, parse, findCaveats };
