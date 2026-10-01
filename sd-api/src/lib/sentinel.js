"use strict";

/**
 * The Sentinel: nothing the reading companion writes reaches a reader until
 * this has read it.
 *
 * ── A second reader, with a narrower question ───────────────────────────────
 * A separate model — by policy, a different one from the writer — that never
 * sees the companion's instructions and has no stake in the answer passing.
 * It reads the whole story, the passages the answer cites, the reader's
 * question and the answer, and rules:
 *
 *   pass      the reader sees it.
 *   revise    something is wrong that the companion can fix — a claim not in
 *             what it cites, an answer the story actually gives that it said
 *             was missing, too hard or too long for this reader, a link. The
 *             Sentinel says what to fix, and the companion tries again, as
 *             many times as the policy allows.
 *   refuse    the answer must not be shown: unsuitable for this reader, or
 *             about the reader personally. Not worth a second draft.
 *
 * It lists the answer's claims and judges each, judges the answer as a
 * whole, and then decides, giving its reasons and its guidance. The verdict
 * is the model's. The code carries it out; when the ruling is not legible,
 * nothing is shown, because an unread answer has not been approved.
 *
 * ── The refusal, in words ───────────────────────────────────────────────────
 * When an answer is refused, a model writes the sentence the reader sees,
 * from the reasons alone — it never sees the refused answer — kind, brief,
 * and pointing back to the story. If even that cannot be written, the
 * policy's fallback sentence is shown.
 *
 * Pure: the models are injected.
 */

const { AUDIENCES, normaliseAudience } = require("./audiences");

const SENTINEL_VERSION = "sentinel-2026.2";

const VERDICT = { PASS: "pass", REVISE: "revise", REFUSE: "refuse" };
const VERDICTS = Object.values(VERDICT);
const REASONS = [
  "unsuitable", "personal_data", "asks_about_reader", "link_or_contact", "not_in_sources", "missed_in_story",
  "off_topic", "too_hard", "too_long", "unchecked_specific", "unclear", "none",
];
const LEVEL = ["fits", "too_hard", "too_simple"];
const LENGTH = ["fits", "too_long", "too_short"];

const MARKER = "ANSWER TO RULE ON:";

const JUDGE_SYSTEM = [
  "You review an answer a reading companion wrote for a reader, before the reader sees it. You are given the whole",
  "article as numbered blocks, the passages of the research paper the answer cites, the reader's question, the kind",
  "of answer the companion says it gave (its grounding), and the answer.",
  "",
  "First, list the answer's claims and judge each:",
  "- in_sources: the article or the cited passages state it (a fair simplification counts). Give the block or passage",
  "  ids in anchor_ids. A greeting, a question back to the reader, a plain statement that the article does not say",
  "  something, or a definition given as background is not a claim about the paper: mark it in_sources true.",
  "- unsuitable: frightening, graphic, sexual, about self-harm, or beyond a child's world, when the reader is a child;",
  "  for any reader, hateful or dangerous.",
  "- personal_data: asks for or repeats anything about the reader as a person.",
  "- off_topic: about something other than the article, the paper, or a word they use.",
  "",
  "Then judge the answer as a whole:",
  "- link_or_contact: it contains a link, a web address, an email, a phone number or a street address.",
  "- asks_about_reader: it asks the reader anything about themselves.",
  "- reading_level: fits this reader, too_hard, or too_simple.",
  "- length: fits the question and this reader, too_long, or too_short.",
  "- unchecked_specifics: a background definition that names a number, date, person, place, product or study.",
  "- story_answers_it: when the answer says the article does not say, whether the article or passages in fact do.",
  "",
  "Then decide:",
  "- refuse when anything is unsuitable for this reader, or the answer asks about or repeats the reader's personal life.",
  "- revise when something is wrong that the companion can fix by trying again. Write guidance: what exactly to fix,",
  "  quoting the words concerned, and where in the article the answer is when it was missed.",
  "- pass otherwise. Small imperfections that would not mislead this reader are not a reason to revise.",
  "Give the reasons that apply, and one sentence of rationale. Return only the JSON described by the schema.",
].join("\n");

const JUDGE_SCHEMA = {
  type: "OBJECT",
  properties: {
    claims: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          text: { type: "STRING" },
          in_sources: { type: "BOOLEAN" },
          anchor_ids: { type: "ARRAY", items: { type: "STRING" } },
          unsuitable: { type: "BOOLEAN" },
          personal_data: { type: "BOOLEAN" },
          off_topic: { type: "BOOLEAN" },
        },
        required: ["text", "in_sources", "anchor_ids", "unsuitable", "personal_data", "off_topic"],
      },
    },
    link_or_contact: { type: "BOOLEAN" },
    asks_about_reader: { type: "BOOLEAN" },
    reading_level: { type: "STRING", enum: LEVEL },
    length: { type: "STRING", enum: LENGTH },
    unchecked_specifics: { type: "BOOLEAN" },
    story_answers_it: { type: "BOOLEAN" },
    verdict: { type: "STRING", enum: VERDICTS },
    reasons: { type: "ARRAY", items: { type: "STRING", enum: REASONS } },
    guidance: { type: "STRING" },
    rationale: { type: "STRING" },
  },
  required: ["claims", "link_or_contact", "asks_about_reader", "reading_level", "length", "unchecked_specifics", "story_answers_it", "verdict", "reasons", "guidance", "rationale"],
};

function buildJudgePrompt({ answer, blocks, passages, question, audience }) {
  const aud = AUDIENCES[normaliseAudience(audience)];
  const cited = new Set(answer.passageIds || []);
  /* The whole article, so a "the story doesn't say" can be checked; the
     cited passages, so every claim can be. */
  const shownPassages = passages.filter((p) => cited.has(p.id) || (answer.grounding === "not_here"));
  return [
    `THE READER: ${aud.readers}.${aud.young ? " A child: judge suitability for a child." : ""}`,
    "",
    "THE ARTICLE:",
    ...blocks.map((b) => `[${b.id}] ${b.text}`),
    "",
    answer.grounding === "not_here" ? "THE PAPER'S PASSAGES:" : "PASSAGES OF THE PAPER THE ANSWER CITES:",
    ...(shownPassages.length ? shownPassages.map((p) => `[${p.id}] ${p.text}`) : ["(none)"]),
    "",
    `THE READER ASKED: ${question}`,
    `THE COMPANION'S GROUNDING: ${answer.grounding}${answer.term ? ` (defining "${answer.term}")` : ""}; cites ${[...(answer.blockIds || []), ...(answer.passageIds || [])].join(", ") || "nothing"}`,
    "",
    `${MARKER} ${answer.text}`,
  ].join("\n");
}

function stripFence(raw) {
  const s = String(raw || "").trim();
  const m = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return m ? m[1] : s;
}

/** The ruling, cleaned to the schema; null when it is not legible. */
function parseRuling(raw, { knownIds = new Set(), maxClaims = 12, claimChars = 300 } = {}) {
  let j;
  try { j = JSON.parse(stripFence(raw)); } catch { return null; }
  if (!j || typeof j !== "object" || !VERDICTS.includes(j.verdict)) return null;
  const claims = (Array.isArray(j.claims) ? j.claims : []).slice(0, maxClaims).map((c) => ({
    text: String(c?.text || "").replace(/\s+/g, " ").trim().slice(0, claimChars),
    inSources: c?.in_sources === true,
    anchorIds: (Array.isArray(c?.anchor_ids) ? c.anchor_ids : []).map(String).filter((id) => knownIds.has(id)),
    unsuitable: c?.unsuitable === true,
    personalData: c?.personal_data === true,
    offTopic: c?.off_topic === true,
  })).filter((c) => c.text);
  return {
    verdict: j.verdict,
    reasons: [...new Set((Array.isArray(j.reasons) ? j.reasons : []).filter((r) => REASONS.includes(r) && r !== "none"))],
    guidance: String(j.guidance || "").slice(0, 800),
    rationale: String(j.rationale || "").slice(0, 400),
    claims,
    overall: {
      linkOrContact: j.link_or_contact === true,
      asksAboutReader: j.asks_about_reader === true,
      readingLevel: LEVEL.includes(j.reading_level) ? j.reading_level : null,
      length: LENGTH.includes(j.length) ? j.length : null,
      uncheckedSpecifics: j.unchecked_specifics === true,
      storyAnswersIt: j.story_answers_it === true,
    },
  };
}

/**
 * Rule on one answer.
 * @returns {Promise<{verdict, reasons, guidance, rationale, claims, overall, judged: boolean, usage, model, sentinelVersion}>}
 */
async function checkAnswer({ answer, blocks, passages, question, audience = "adults", limits = {}, generate }) {
  const prompt = buildJudgePrompt({ answer, blocks, passages, question, audience });
  const r = await generate({ prompt, systemInstruction: JUDGE_SYSTEM, responseSchema: JUDGE_SCHEMA });
  const known = new Set([...blocks.map((b) => b.id), ...passages.map((p) => p.id)]);
  const ruling = parseRuling(r.text, { knownIds: known, maxClaims: limits.maxClaims, claimChars: limits.claimChars });
  const base = { usage: r.usage || null, model: r.model || null, sentinelVersion: SENTINEL_VERSION };
  if (!ruling) return { ...base, verdict: VERDICT.REFUSE, reasons: ["unclear"], guidance: "", rationale: "The review could not be read, so the answer was not approved.", claims: [], overall: null, judged: false };
  return { ...base, ...ruling, judged: true };
}

/* ── the refusal, written ────────────────────────────────────────────────── */

const REFUSAL_SYSTEM = [
  "Write the one or two sentences a reading companion says to a reader when it will not give an answer.",
  "You are told why, in categories, and who the reader is. You are not shown the answer and must not guess at it.",
  "Be kind and brief. Do not lecture, do not repeat anything harmful, do not mention the reader's personal details,",
  "do not promise anything outside the article. Invite them to ask about something in the article instead.",
  "If the reason suggests the reader may be at risk of harm, gently suggest talking to a trusted adult.",
].join("\n");
const REFUSAL_SCHEMA = { type: "OBJECT", properties: { text: { type: "STRING" } }, required: ["text"] };
const REFUSAL_MARKER = "REFUSAL TO WRITE:";

/**
 * @returns {Promise<{text: string|null, usage, model}>}  text null when it could not be written
 */
async function writeRefusal({ reasons, audience = "adults", storyTitle = "", generate }) {
  const aud = AUDIENCES[normaliseAudience(audience)];
  const prompt = [`THE READER: ${aud.readers}.`, `THE ARTICLE: ${storyTitle || "(untitled)"}`, `${REFUSAL_MARKER} reasons: ${(reasons || []).join(", ") || "unspecified"}`].join("\n");
  try {
    const r = await generate({ prompt, systemInstruction: REFUSAL_SYSTEM, responseSchema: REFUSAL_SCHEMA });
    const j = JSON.parse(stripFence(r.text));
    const text = String(j?.text || "").replace(/\s+/g, " ").trim();
    return { text: text || null, usage: r.usage || null, model: r.model || null };
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    return { text: null, usage: null, model: null };
  }
}

module.exports = {
  SENTINEL_VERSION, VERDICT, VERDICTS, REASONS, MARKER, REFUSAL_MARKER, JUDGE_SYSTEM, JUDGE_SCHEMA,
  buildJudgePrompt, parseRuling, checkAnswer, writeRefusal,
};
