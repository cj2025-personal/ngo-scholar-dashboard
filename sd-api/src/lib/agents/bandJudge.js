"use strict";

/**
 * Whether prose suits the reader it was written for, judged by a model.
 *
 * This was a formula: Flesch-Kincaid against a grade per age band, with a
 * tolerance either side. The formula counts syllables and sentence length;
 * it cannot see that "convergence" is undefined for a twelve-year-old, that a
 * long sentence of short words is easy, or that an adult article of
 * one-clause sentences talks down. So a model reads the prose as an editor
 * for that reader would, says whether it fits, too hard or too simple, and
 * says what to change in terms a writer can act on — which sentences, which
 * terms, what kind of change — without adding a fact.
 *
 * The measured grade still goes to the judge, as one piece of evidence, and
 * is still shown to the scholar. It no longer decides anything.
 *
 * Pure: the model is injected.
 */

const { AUDIENCES, normaliseAudience } = require("../audiences");

const BAND_JUDGE_VERSION = "band-judge-2026.2";
const MARKER = "PROSE TO PLACE FOR ITS READER:";
const VERDICTS = ["fits", "too_hard", "too_simple"];

const SYSTEM = [
  "You are an editor who places writing for its reader. You read an article's prose and decide whether it suits the",
  "reader it is for: fits, too_hard, or too_simple. You do not rewrite it; you say what the writer should change.",
  "",
  "The bar: reading at a normal pace, could this reader follow the article and come away with its main points? If",
  "yes, it fits — even if some sentences could be easier still. An article about research carries technical terms;",
  "a term explained in plain words where it first appears is what this reader needs, not a fault.",
  "- too_hard only when this reader would lose the thread: terms the argument depends on left unexplained,",
  "  paragraphs they would have to reread to follow, abstraction with nothing concrete to hold, a register well above",
  "  them.",
  "- too_simple only when this reader would feel talked down to: one-clause sentences strung together, explaining",
  "  what they plainly know.",
  "A measured reading grade is given as one piece of evidence; it counts syllables and sentence length, not meaning,",
  "so weigh it, do not obey it.",
  "",
  "When the prose is a rewrite, you are shown your previous ruling. Judge whether what you asked for was done and",
  "whether the prose now clears the bar. Do not raise a new standard the first ruling did not apply.",
  "",
  "If it does not fit, give `guidance`: concrete instructions the writer can follow — which sentences or terms, what",
  "kind of change — and never ask for a fact that is not already in the prose. Quote up to five of the sentences that",
  "most need the change in `sentences`, copied exactly. `reason` is one sentence the scholar will read.",
].join("\n");

const SCHEMA = {
  type: "OBJECT",
  properties: {
    verdict: { type: "STRING", enum: VERDICTS },
    reason: { type: "STRING" },
    guidance: { type: "STRING" },
    sentences: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["verdict", "reason", "guidance", "sentences"],
};

const squash = (t) => String(t || "").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();

function buildPrompt({ text, audience, measured = null, previous = null }) {
  const a = AUDIENCES[normaliseAudience(audience)];
  return [
    `THE READER: ${a.readers}. What they need: ${a.brief}`,
    measured && measured.fkGrade !== null && measured.fkGrade !== undefined
      ? `MEASURED: Flesch-Kincaid grade ${measured.fkGrade} over ${measured.words} words (the usual grade for this reader is about ${a.grade})${measured.reliable === false ? "; too few words to measure reliably" : ""}.`
      : "MEASURED: nothing measurable.",
    ...(previous && previous.verdict && previous.verdict !== "fits"
      ? ["", `THIS IS A REWRITE. YOUR PREVIOUS RULING: ${previous.verdict} — ${previous.reason}`, ...(previous.guidance ? [`WHAT YOU ASKED FOR: ${previous.guidance}`] : [])]
      : []),
    "",
    MARKER,
    text,
  ].join("\n");
}

function stripFence(raw) {
  const s = String(raw || "").trim();
  const m = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return m ? m[1] : s;
}

function parseRuling(raw, text) {
  let j;
  try { j = JSON.parse(stripFence(raw)); } catch { return null; }
  if (!j || !VERDICTS.includes(j.verdict)) return null;
  const said = squash(text);
  return {
    verdict: j.verdict,
    reason: String(j.reason || "").trim().slice(0, 400),
    guidance: j.verdict === "fits" ? "" : String(j.guidance || "").trim().slice(0, 1200),
    sentences: (Array.isArray(j.sentences) ? j.sentences : []).map(squash).filter((s) => s && said.includes(s)).slice(0, 5),
  };
}

/**
 * Place the prose for its reader. One correction round when the ruling is
 * not legible; after that it is returned as unchecked, never as a pass.
 *
 * @param {object} p
 * @param {string} p.text        the prose, paragraphs separated by blank lines
 * @param {string} p.audience
 * @param {object|null} [p.measured]   the formula's measurement, as evidence
 * @param {{verdict:string, reason:string, guidance?:string}|null} [p.previous]   the ruling the rewrite answered
 * @param {(req:object)=>Promise<{text:string, usage?:object, model?:string}>} p.generate
 * @returns {Promise<{verdict: "fits"|"too_hard"|"too_simple"|"unchecked", reason: string, guidance: string, sentences: string[], calls: object[]}>}
 */
async function judgeBand({ text, audience, measured = null, previous = null, generate }) {
  if (!String(text || "").trim()) return { verdict: "unchecked", reason: "there is no prose to read", guidance: "", sentences: [], calls: [] };
  const prompt = buildPrompt({ text, audience, measured, previous });
  const calls = [];
  for (let round = 0; round < 2; round += 1) {
    const r = await generate({ prompt: round ? `${prompt}\n\nYOUR LAST RULING COULD NOT BE READ. Rule again.` : prompt, systemInstruction: SYSTEM, responseSchema: SCHEMA });
    calls.push({ step: "judge_band", usage: r.usage || null, model: r.model || r.modelVersion || null, promptVersion: BAND_JUDGE_VERSION });
    const ruling = parseRuling(r.text, text);
    if (ruling) return { ...ruling, calls };
  }
  return { verdict: "unchecked", reason: "the reading level could not be judged", guidance: "", sentences: [], calls };
}

/** What to tell the writer on a retry: the editor's guidance and the sentences it named. */
function bandNote(ruling, audience) {
  if (!ruling || ruling.verdict === "fits" || ruling.verdict === "unchecked") return null;
  const a = AUDIENCES[normaliseAudience(audience)];
  return [
    `An editor read your previous draft as ${ruling.verdict === "too_hard" ? "too hard" : "too simple"} for ${a.readers}: ${ruling.reason}`,
    ruling.guidance,
    ...(ruling.sentences.length ? [`Sentences that most need it: ${ruling.sentences.map((s) => `“${s.slice(0, 200)}”`).join(" ")}`] : []),
    "Keep every fact and add none; change only how it is said.",
  ].filter(Boolean).join("\n");
}

module.exports = { BAND_JUDGE_VERSION, MARKER, VERDICTS, SYSTEM, SCHEMA, buildPrompt, parseRuling, judgeBand, bandNote };
