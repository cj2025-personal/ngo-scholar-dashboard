"use strict";

/**
 * Whose voice a paragraph is written in, judged by a model.
 *
 * An article on Archivyn is either the scholar's own account under their
 * byline — impersonal, the work as its subject — or an article about them in
 * the third person. In neither may the prose speak as the scholar. In the
 * scholar's own account it may not refer to them either.
 *
 * That line is a judgement, not a pattern. "We measured the gain" is the
 * researchers speaking; "things we use every day" is ordinary English that
 * includes the reader. "Smith built the array" names the author in their own
 * account, unless Smith is someone else the paper cites. A list of words got
 * this wrong in both directions — it refused an article for children over
 * an inclusive "we", and passed "we wanted to know whether" — so a model
 * reads each paragraph with both voices explained and says which sentences,
 * if any, cross the line, and why.
 *
 * The judge never sees the writer's instructions, and the writer never sees
 * the judge's: what comes back is a verdict, and the writer is told only
 * which sentences and why. Sentences the judge quotes are kept only if they
 * are in the paragraph, so a warning to the scholar never quotes something
 * the draft does not say.
 *
 * Pure: the model is injected.
 */

const VOICE_JUDGE_VERSION = "voice-judge-2026.3";
const MARKER = "PARAGRAPHS TO CHECK FOR VOICE:";

const SYSTEM = [
  "You check whose voice paragraphs of an article are written in. You do not write; you only judge.",
  "The article is about a scholar's own research paper. It is written in one of two voices:",
  "- author: the scholar's own account, published under their byline. Impersonal: the work is the subject. It must",
  "  never speak as the scholar (\"I\", \"my\", or a \"we\"/\"our\" that means the researchers, as in \"we measured\",",
  "  \"our results\"), and never refer to the scholar — not by name, not as \"the author\" or \"the researchers\" meaning",
  "  them, not by a pronoun standing in for them.",
  "- about: an article about the scholar, in the third person. It must never speak as the scholar (\"I\", \"my\", or",
  "  the researchers' \"we\"). Naming the scholar and using their pronoun is expected.",
  "An inclusive \"we\"/\"us\"/\"our\" meaning people in general, or the writer together with the reader (\"things we use",
  "every day\", \"it helps us see\", \"our planet\"), is ordinary English and allowed in both voices. Other people the",
  "paper names may be named in both voices.",
  "",
  "Read every sentence of every paragraph. For each paragraph, list its findings — one per offending sentence:",
  "- sentence: the sentence, copied exactly from the paragraph.",
  "- kind: speaks_as_author (it speaks as the scholar, in either voice); names_author (author voice only: it names",
  "  or refers to the scholar); pronoun_for_author (author voice only: a he/she/they that seems to stand for the",
  "  scholar, though it might be someone else the paper names — the scholar will decide).",
  "- reason: one short sentence, about that sentence, a writer could act on.",
  "A paragraph with nothing wrong has no findings. Every paragraph listed must appear in your answer, by its id.",
].join("\n");

const KINDS = ["speaks_as_author", "names_author", "pronoun_for_author"];
/* A paragraph is named P1, P2… and the schema allows only those names: a
   model left to number paragraphs itself counted from zero, and every
   ruling then looked one paragraph short. */
const idOf = (index) => `P${index}`;
const schemaFor = (paragraphs) => ({
  type: "OBJECT",
  properties: {
    paragraphs: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING", enum: paragraphs.map((p) => idOf(p.index)) },
          findings: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: { sentence: { type: "STRING" }, kind: { type: "STRING", enum: KINDS }, reason: { type: "STRING" } },
              required: ["sentence", "kind", "reason"],
            },
          },
        },
        required: ["id", "findings"],
      },
    },
  },
  required: ["paragraphs"],
});

const squash = (t) => String(t || "").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();

function buildPrompt({ paragraphs, voice, scholarName }) {
  return [
    `THE VOICE: ${voice === "author" ? "author — the scholar's own account under their byline" : "about — an article about the scholar"}`,
    `THE SCHOLAR: ${scholarName || "(name not known)"}`,
    "",
    MARKER,
    ...paragraphs.map((p) => `[${idOf(p.index)}] ${p.text}`),
  ].join("\n");
}

function stripFence(raw) {
  const s = String(raw || "").trim();
  const m = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return m ? m[1] : s;
}

/** The model's verdicts by paragraph index, or null when it is not legible or leaves a paragraph out. */
function parseVerdicts(raw, paragraphs, voice) {
  let j;
  try { j = JSON.parse(stripFence(raw)); } catch { return null; }
  const rows = Array.isArray(j?.paragraphs) ? j.paragraphs : null;
  if (!rows) return null;
  const byId = new Map(paragraphs.map((p) => [idOf(p.index), p]));
  const out = new Map();
  const author = voice === "author";
  for (const row of rows) {
    const p = byId.get(String(row?.id || "").trim().toUpperCase());
    if (!p) continue;
    const said = squash(p.text);
    /* Naming the scholar is expected in an article about them, so those kinds count only in their own account. */
    const findings = (Array.isArray(row.findings) ? row.findings : [])
      .filter((f) => KINDS.includes(f?.kind) && (author || f.kind === "speaks_as_author"))
      .map((f) => ({ kind: f.kind, sentence: squash(f.sentence), reason: String(f.reason || "").trim().slice(0, 300) }));
    const has = (kind) => findings.some((f) => f.kind === kind);
    out.set(p.index, {
      speaksAsAuthor: has("speaks_as_author"),
      namesAuthor: has("names_author"),
      pronounForAuthor: has("pronoun_for_author"),
      findings,
      /* The judge decides; only the quotes are checked: the scholar is never shown a sentence the draft does not contain. */
      sentences: [...new Set(findings.map((f) => f.sentence).filter((s) => s && said.includes(s)))].slice(0, 6),
      reason: [...new Set(findings.filter((f) => f.kind !== "pronoun_for_author").map((f) => f.reason).filter(Boolean))].join(" ").slice(0, 400),
    });
  }
  return out.size === paragraphs.length ? out : null;
}

/**
 * Judge paragraphs for voice. One correction round when the answer is not
 * legible or leaves a paragraph out; after that the paragraphs are returned
 * unchecked, and the caller says so rather than guessing.
 *
 * @param {object} p
 * @param {{index:number, text:string}[]} p.paragraphs
 * @param {"author"|"about"} p.voice
 * @param {string|null} [p.scholarName]
 * @param {(req:object)=>Promise<{text:string, usage?:object, model?:string, modelVersion?:string}>} p.generate
 * @returns {Promise<{verdicts: Map<number, object>|null, unchecked: boolean, calls: object[]}>}
 */
async function judgeVoice({ paragraphs, voice, scholarName = null, generate }) {
  if (!paragraphs.length) return { verdicts: new Map(), unchecked: false, calls: [] };
  const prompt = buildPrompt({ paragraphs, voice, scholarName });
  const calls = [];
  for (let round = 0; round < 2; round += 1) {
    const r = await generate({
      prompt: round ? `${prompt}\n\nYOUR LAST ANSWER COULD NOT BE READ, OR LEFT A PARAGRAPH OUT. Judge every paragraph listed, by its id.` : prompt,
      systemInstruction: SYSTEM,
      responseSchema: schemaFor(paragraphs),
    });
    calls.push({ step: "judge_voice", usage: r.usage || null, model: r.model || r.modelVersion || null, paragraphs: paragraphs.length, promptVersion: VOICE_JUDGE_VERSION });
    const verdicts = parseVerdicts(r.text, paragraphs, voice);
    if (verdicts) return { verdicts, unchecked: false, calls };
  }
  return { verdicts: null, unchecked: true, calls };
}

/**
 * The paragraph blocks of a section or level, judged; quotes and headings are
 * not the article's own voice and are not sent.
 *
 * @returns {Promise<{speaking: number[], naming: number[], pronouns: number[], sentences: {speaking: string[], naming: string[], pronouns: string[]}, note: string|null, unchecked: boolean, calls: object[]}>}
 *   indexes are positions in `blocks`; `note` is what to tell the writer on a retry
 */
async function judgeBlocks({ blocks, voice, scholarName = null, generate, plain }) {
  const paragraphs = [];
  blocks.forEach((b, i) => { if (b.type === "paragraph") paragraphs.push({ index: paragraphs.length + 1, blockIndex: i, text: plain(b.html) }); });
  const { verdicts, unchecked, calls } = await judgeVoice({ paragraphs: paragraphs.map(({ index, text }) => ({ index, text })), voice, scholarName, generate });
  const out = { speaking: [], naming: [], pronouns: [], sentences: { speaking: [], naming: [], pronouns: [] }, reasons: [], note: null, unchecked, calls };
  if (!verdicts) return out;
  for (const p of paragraphs) {
    const v = verdicts.get(p.index);
    const quoted = (kind) => v.findings.filter((f) => f.kind === kind && v.sentences.includes(f.sentence)).map((f) => f.sentence);
    if (v.speaksAsAuthor) { out.speaking.push(p.blockIndex); out.sentences.speaking.push(...quoted("speaks_as_author")); }
    else if (v.namesAuthor) { out.naming.push(p.blockIndex); out.sentences.naming.push(...quoted("names_author")); }
    else if (v.pronounForAuthor) { out.pronouns.push(p.blockIndex); out.sentences.pronouns.push(...quoted("pronoun_for_author")); }
    if ((v.speaksAsAuthor || v.namesAuthor) && v.reason) out.reasons.push(v.reason);
  }
  if (out.speaking.length || out.naming.length) {
    const quoted = [...out.sentences.speaking, ...out.sentences.naming].slice(0, 4).map((s) => `“${s.slice(0, 160)}”`);
    out.note = [
      "A reviewer found your last attempt in the wrong voice.",
      ...(quoted.length ? [`These sentences: ${quoted.join(" ")}`] : []),
      ...(out.reasons.length ? [`Why: ${[...new Set(out.reasons)].slice(0, 3).join(" ")}`] : []),
    ].join("\n");
  }
  return out;
}

module.exports = { VOICE_JUDGE_VERSION, MARKER, KINDS, SYSTEM, schemaFor, idOf, buildPrompt, parseVerdicts, judgeVoice, judgeBlocks };
