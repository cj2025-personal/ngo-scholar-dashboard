"use strict";

/**
 * The guard: the first model to read a reader's question, before it is kept
 * or shown to anything else.
 *
 * It decides three things, and gives its reason:
 *   - which spans of the question are personal — a name, an age, a school, a
 *     place, an address, contact details, a link, health, family — so that
 *     they can be masked before the question is stored or answered;
 *   - whether the question is about the reader rather than about the story,
 *     so later turns do not carry it forward;
 *   - what kind of question it is, and whether to answer it at all. Almost
 *     everything goes on to the companion, which will say kindly when the
 *     story does not say. Only a message it would be harmful to engage with
 *     is declined here.
 *
 * The decisions are the model's. The code only carries them out: it masks
 * exactly the spans the model returned, and only where they occur.
 *
 * Pure: the model is injected.
 */

const { AUDIENCES, normaliseAudience } = require("../audiences");

const GUARD_VERSION = "reader-guard-2026.2";

const INTENTS = ["explain", "define", "evidence", "summary", "quiz", "compare", "opinion", "personal", "off_topic", "unsafe", "other"];
const PII_KINDS = ["name", "age", "email", "phone", "address", "school", "location", "link", "id_number", "health", "family", "other"];
const ROUTES = ["answer", "decline"];
const DECLINE_REASONS = ["none", "unsafe", "abusive", "self_harm", "personal_only"];

const MARKER = "QUESTION TO SCREEN:";

const SYSTEM = [
  "You screen messages a reader sends to a reading companion beside an article about a research paper.",
  "The reader may be a child. Read the message and decide, carefully and in this order:",
  "",
  "1. Personal spans. List every span that identifies or describes the reader or another private person: a name,",
  "   an age, a school, a town or address, an email, a phone number, a link, an id number, health, family details.",
  "   Copy each span EXACTLY as written, character for character, so it can be masked. Names of researchers, places",
  "   or things that the article itself is about are not personal. If there are none, return an empty list.",
  "2. about_reader: true when the message tells about the reader themselves (who they are, where they live, how",
  "   they feel about their own life), rather than asking about the article.",
  "3. intent: what the reader wants. explain, define, evidence (how do they know), summary, quiz, compare, opinion,",
  "   personal (about themselves), off_topic (not about the article), unsafe (asks for something harmful), other.",
  "4. route: answer for almost everything, including off-topic or personal messages — the companion will reply",
  "   kindly and steer back to the article. decline ONLY when engaging at all would be harmful: a request for",
  "   dangerous, sexual or hateful content, abuse, or a sign the reader may be at risk of harm (self_harm).",
  "5. rationale: one plain sentence saying why.",
].join("\n");

const SCHEMA = {
  type: "OBJECT",
  properties: {
    pii: {
      type: "ARRAY",
      items: { type: "OBJECT", properties: { text: { type: "STRING" }, kind: { type: "STRING", enum: PII_KINDS } }, required: ["text", "kind"] },
    },
    about_reader: { type: "BOOLEAN" },
    intent: { type: "STRING", enum: INTENTS },
    route: { type: "STRING", enum: ROUTES },
    decline_reason: { type: "STRING", enum: DECLINE_REASONS },
    rationale: { type: "STRING" },
  },
  required: ["pii", "about_reader", "intent", "route", "decline_reason", "rationale"],
};

function buildPrompt({ question, audience, storyTitle, headings = [] }) {
  const aud = AUDIENCES[normaliseAudience(audience)];
  return [
    `THE READER: ${aud.readers}.`,
    `THE ARTICLE: ${storyTitle || "(untitled)"}${headings.length ? ` — sections: ${headings.join(" · ")}` : ""}`,
    "",
    `${MARKER} ${question}`,
  ].join("\n");
}

function stripFence(raw) {
  const s = String(raw || "").trim();
  const m = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return m ? m[1] : s;
}

/** The model's decision, cleaned to the schema; null when it is not legible. */
function parseDecision(raw) {
  let j;
  try { j = JSON.parse(stripFence(raw)); } catch { return null; }
  if (!j || typeof j !== "object") return null;
  const pii = (Array.isArray(j.pii) ? j.pii : [])
    .map((p) => ({ text: String(p?.text || ""), kind: PII_KINDS.includes(p?.kind) ? p.kind : "other" }))
    .filter((p) => p.text.trim());
  return {
    pii,
    aboutReader: j.about_reader === true,
    intent: INTENTS.includes(j.intent) ? j.intent : "other",
    route: ROUTES.includes(j.route) ? j.route : "answer",
    declineReason: DECLINE_REASONS.includes(j.decline_reason) ? j.decline_reason : "none",
    rationale: String(j.rationale || "").slice(0, 400),
  };
}

/**
 * Carry out the masking the model decided: each span it named becomes the
 * kind it named, wherever it appears. A span the model named that is not in
 * the question is reported, not invented into it.
 */
function applyMasks(question, pii) {
  let out = String(question || "");
  const applied = [];
  const missing = [];
  /* Longest first, so a name inside a longer address is not masked twice. */
  for (const p of [...pii].sort((a, b) => b.text.length - a.text.length)) {
    if (!out.includes(p.text)) { missing.push(p.kind); continue; }
    out = out.split(p.text).join(`[${p.kind}]`);
    applied.push(p.kind);
  }
  return { text: out.replace(/\s+/g, " ").trim(), applied: [...new Set(applied)], missing };
}

/**
 * Screen one question.
 * @returns {Promise<{decision: object, masked: string, applied: string[], usage: object|null, model: string|null}>}
 * @throws when no model could screen it: an unscreened question is not answered
 */
async function screenQuestion({ question, audience, storyTitle, headings, generate }) {
  const r = await generate({ prompt: buildPrompt({ question, audience, storyTitle, headings }), systemInstruction: SYSTEM, responseSchema: SCHEMA });
  const decision = parseDecision(r.text);
  if (!decision) {
    const e = new Error("The guard's decision was not legible.");
    e.code = "GUARD_UNREADABLE";
    throw e;
  }
  const masked = applyMasks(question, decision.pii);
  return { decision, masked: masked.text, applied: masked.applied, usage: r.usage || null, model: r.model || null };
}

module.exports = { GUARD_VERSION, INTENTS, PII_KINDS, ROUTES, DECLINE_REASONS, MARKER, SYSTEM, SCHEMA, buildPrompt, parseDecision, applyMasks, screenQuestion };
