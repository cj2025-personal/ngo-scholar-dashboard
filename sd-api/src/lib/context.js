"use strict";

/**
 * The context judge: the author's own context, checked for attribution.
 *
 * ── The third kind of paragraph ─────────────────────────────────────────────
 * A PAPER paragraph reports what the paper states; the fidelity judge holds
 * it to the passages. An EXTENSION paragraph says what follows from the
 * paper; the reach judge holds it to implication. A CONTEXT paragraph is the
 * author's own knowledge of the world around the work — where the problem
 * turns up in practice, what a reader needs that the paper does not say —
 * written under their byline as their own view. It may say what the paper
 * does not. That is its purpose, and the reason it exists: an article that
 * may only restate and imply cannot answer "what does this mean today".
 *
 * ── What it may not do ──────────────────────────────────────────────────────
 * Present the author's knowledge as the paper's finding. "The paper shows
 * this is used in every phone" is the sentence that puts a claim the paper
 * never made under the paper's authority. The judge reads every claim for
 * that wording — attributed to the paper, yet not in the passages — and
 * sends the section back with the sentences named. A paragraph that keeps
 * doing it is dropped.
 *
 * ── What the author must do ─────────────────────────────────────────────────
 * Verify the specifics. A model asked for context will name things: a
 * band, a standard, a company, a figure, a study. Some will be right. The
 * judge lists every such particular, and the workspace holds the story from
 * publication until the author has ticked each one. Nothing the model brings
 * in from outside the paper reaches a reader without the author's eyes on it
 * — which is the guardrail that makes the freedom safe.
 *
 * Verdicts: clear (every claim is the author's own or is in the passages),
 * partial (some claims present themselves as the paper's), misattributed
 * (all do, or one is unsuitable for a child). The judge never sees the
 * drafter's instructions.
 */

const { AUDIENCES, normaliseAudience } = require("./audiences");

const CONTEXT_VERSION = "context-judge-2026.1";

const VERDICT = { CLEAR: "clear", PARTIAL: "partial", MISATTRIBUTED: "misattributed" };
const REASON = { STATED_AS_FINDING: "stated_as_finding", UNSUITABLE: "unsuitable" };
const REASON_TEXT = {
  stated_as_finding: "presents the author's own context as something the paper found",
  unsuitable: "is not suitable for a young reader",
};
const SPECIFIC_KINDS = ["number", "study", "product", "organisation", "standard", "date", "place", "person", "practice", "other"];
const CLAIM_LIMITS = { perParagraph: 12, textChars: 300, specificsPerParagraph: 8, passages: 8 };

const JUDGE_SYSTEM = [
  "You check the author's own context beside a research paper. You are given numbered passages from the paper and",
  "numbered paragraphs written by the paper's author as their own context: what they know about the world around",
  "the work, under their own byline. The paragraphs may say things the paper does not; that is their purpose. What",
  "they may not do is present such things as the paper's findings. For each paragraph, list its claims and judge each.",
  "",
  "What counts as a claim: one assertion about the world, the field, practice, or the paper. A sentence may hold",
  "more than one claim; split them. Framing, transitions and plain-words explanation are not claims.",
  "",
  "For each claim give:",
  "- attributed: true if the sentence presents the claim as something the paper states, shows, found, proved,",
  '  measured or demonstrated — wording such as "the paper shows", "the study found", "the results prove", "as the',
  '  paper demonstrates", "this work established". False when it is said as the author\'s own knowledge or as a',
  "  general statement about the world.",
  "- in_passages: true if the passages state it; give their ids in anchor_ids. False otherwise, with an empty list.",
  "- specifics: the concrete particulars in the claim a reader could check against the world — a number or",
  "  statistic, a named study or paper, a product, a company or organisation, a standard, a date or year, a place,",
  "  a named person, or a named practice or technology — each with its kind. Empty when there are none. A general",
  '  category or everyday example ("crowded radio bands", "hospital equipment", "radar", "cell phone towers") is',
  '  not a specific; a particular a reader could look up is: "the 2.4 GHz band", "IEEE 802.11", "Philips", "since',
  '  2019", "the Hubble telescope", "a 2015 study by Smith".',
  "- unsuitable: ONLY when the prompt says the reader is a child: true if the claim is frightening, graphic, sexual,",
  "  about self-harm, or assumes a world beyond a child's. Otherwise false.",
  "",
  "Rules:",
  "- Judge attribution by the sentence's wording, not by whether the claim is true.",
  "- Judge in_passages only against the passages shown. Outside knowledge does not put a claim in the passages.",
  "- Quote the claim in the paragraph's own words, so the writer can find it.",
  "- Return only the JSON described by the schema.",
].join("\n");

const JUDGE_SCHEMA = {
  type: "OBJECT",
  properties: {
    paragraphs: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          index: { type: "INTEGER" },
          claims: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                text: { type: "STRING" },
                attributed: { type: "BOOLEAN" },
                in_passages: { type: "BOOLEAN" },
                anchor_ids: { type: "ARRAY", items: { type: "STRING" } },
                specifics: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: { text: { type: "STRING" }, kind: { type: "STRING", enum: SPECIFIC_KINDS } },
                    required: ["text", "kind"],
                  },
                },
                unsuitable: { type: "BOOLEAN" },
              },
              required: ["text", "attributed", "in_passages", "anchor_ids", "specifics"],
            },
          },
        },
        required: ["index", "claims"],
      },
    },
  },
  required: ["paragraphs"],
};

function buildJudgePrompt({ paragraphs, passages, audience = null }) {
  const aud = audience ? AUDIENCES[normaliseAudience(audience)] : null;
  return [
    ...(aud && aud.young ? [`THE READER: ${aud.readers}. Judge suitability for a child as well.`, ""] : []),
    "PASSAGES FROM THE PAPER:",
    ...passages.map((p) => `[${p.id}] ${p.text}`),
    "",
    "PARAGRAPHS OF THE AUTHOR'S OWN CONTEXT:",
    ...paragraphs.map((p) => `(${p.index}) ${p.text}`),
    "",
    `Return the claims, each judged, for each of the ${paragraphs.length} paragraph(s), by index.`,
  ].join("\n");
}

/** A claim fails when it wears the paper's authority without the paper's backing, or is unfit for the reader. */
function normaliseClaim(raw, knownIds) {
  const text = String(raw?.text || "").replace(/\s+/g, " ").trim().slice(0, CLAIM_LIMITS.textChars);
  if (!text) return null;
  const anchorIds = (Array.isArray(raw?.anchor_ids) ? raw.anchor_ids : [])
    .map((id) => String(id).trim())
    .filter((id) => id && (!knownIds || knownIds.has(id)))
    .slice(0, CLAIM_LIMITS.passages);
  const attributed = raw?.attributed === true;
  /* A claim said to be in the passages by no passage is not in them. */
  const inPassages = raw?.in_passages === true && anchorIds.length > 0;
  const unsuitable = raw?.unsuitable === true;
  const specifics = (Array.isArray(raw?.specifics) ? raw.specifics : [])
    .map((s) => ({ text: String(s?.text || "").replace(/\s+/g, " ").trim().slice(0, 120), kind: SPECIFIC_KINDS.includes(s?.kind) ? s.kind : "other" }))
    .filter((s) => s.text)
    .slice(0, CLAIM_LIMITS.specificsPerParagraph);
  const reason = unsuitable ? REASON.UNSUITABLE : attributed && !inPassages ? REASON.STATED_AS_FINDING : null;
  return { text, attributed, inPassages, anchorIds: inPassages ? anchorIds : [], specifics, reason };
}

/** The paragraph's verdict is the sum of its claims. An unsuitable claim is never partial. */
function deriveVerdict(claims) {
  if (!claims.length) return VERDICT.CLEAR;
  if (claims.some((c) => c.reason === REASON.UNSUITABLE)) return VERDICT.MISATTRIBUTED;
  const failing = claims.filter((c) => c.reason).length;
  if (failing === 0) return VERDICT.CLEAR;
  if (failing === claims.length) return VERDICT.MISATTRIBUTED;
  return VERDICT.PARTIAL;
}

/** Every particular the paragraph brings in, once each, for the author to verify. */
function specificsOf(claims) {
  const seen = new Set();
  const out = [];
  for (const c of claims) {
    for (const s of c.specifics) {
      const key = s.text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ text: s.text, kind: s.kind, verified: false });
    }
  }
  return out.slice(0, CLAIM_LIMITS.specificsPerParagraph);
}

/**
 * @param {string} raw
 * @param {number[]} expectedIndexes
 * @param {Set<string>|null} [knownIds]
 * @returns {Map<number, {verdict: string, claims: object[], misattributedClaims: string[], toVerify: object[], reasons: string[]}>}
 */
function parseJudgeResponse(raw, expectedIndexes, knownIds = null) {
  let data;
  try {
    data = JSON.parse(stripFence(raw));
  } catch {
    throw new Error("The context judge did not return valid JSON.");
  }
  const rows = Array.isArray(data?.paragraphs) ? data.paragraphs : [];
  const byIndex = new Map();
  for (const r of rows) {
    const index = Number(r?.index);
    if (!Number.isInteger(index)) continue;
    const claims = (Array.isArray(r?.claims) ? r.claims : []).map((c) => normaliseClaim(c, knownIds)).filter(Boolean).slice(0, CLAIM_LIMITS.perParagraph);
    const failing = claims.filter((c) => c.reason);
    byIndex.set(index, {
      verdict: deriveVerdict(claims),
      claims,
      misattributedClaims: failing.map((c) => c.text),
      toVerify: specificsOf(claims),
      reasons: [...new Set(failing.map((c) => REASON_TEXT[c.reason] || c.reason))],
    });
  }
  const out = new Map();
  for (const index of expectedIndexes) {
    /* Silence is not clearance. */
    out.set(index, byIndex.get(index) || { verdict: VERDICT.MISATTRIBUTED, claims: [], misattributedClaims: [], toVerify: [], reasons: ["the judge returned no verdict for this paragraph"] });
  }
  return out;
}

/**
 * Judge the context paragraphs among a section's blocks — those marked as
 * the author's own view with a `context` record. Attaches the verdict, the
 * claims and the list to verify; every other block is returned untouched.
 *
 * @param {object} p
 * @param {object[]} p.blocks
 * @param {{id:string,text:string}[]} p.passages
 * @param {string} [p.audience]
 * @param {(req: object) => Promise<{text: string, usage?: object, modelVersion?: string|null}>} p.generate
 * @returns {Promise<{blocks: object[], call: object|null, failing: number[]}>}
 */
async function judgeSection({ blocks, passages, audience = null, generate }) {
  const byId = new Map(passages.map((p) => [p.id, p]));
  const out = blocks.map((b) => ({ ...b }));
  const toJudge = [];

  out.forEach((block, i) => {
    if (block.type !== "paragraph" || !block.ownView || !block.context) return;
    const anchors = (Array.isArray(block.context.anchorIds) ? block.context.anchorIds : []).filter((id) => byId.has(id));
    toJudge.push({ blockIndex: i, index: toJudge.length + 1, text: unescapeHtml(block.html), anchors });
  });

  if (toJudge.length === 0) return { blocks: out, call: null, failing: [] };

  /* The passages the section relates to; failing any, the opening of the
     paper, so "in the passages" has something to be judged against. */
  const shownIds = [...new Set(toJudge.flatMap((p) => p.anchors))];
  const shown = (shownIds.length ? shownIds : passages.slice(0, CLAIM_LIMITS.passages).map((p) => p.id)).map((id) => byId.get(id));
  const prompt = buildJudgePrompt({ paragraphs: toJudge.map((p) => ({ index: p.index, text: p.text })), passages: shown, audience });
  const r = await generate({ prompt, systemInstruction: JUDGE_SYSTEM, responseSchema: JUDGE_SCHEMA, temperature: 0, maxOutputTokens: 8192 });
  const verdicts = parseJudgeResponse(r.text, toJudge.map((p) => p.index), new Set(shown.map((p) => p.id)));

  const failing = [];
  for (const p of toJudge) {
    const v = verdicts.get(p.index);
    out[p.blockIndex].context = { anchorIds: p.anchors, ...v, checks: { anchored: p.anchors.length, judged: true, claims: v.claims.length }, verifierVersion: CONTEXT_VERSION };
    if (v.verdict !== VERDICT.CLEAR) failing.push(p.blockIndex);
  }
  failing.sort((a, b) => a - b);
  return { blocks: out, call: { step: "judge_context", usage: r.usage || null, model: r.modelVersion || null, paragraphs: toJudge.length }, failing };
}

/** What to tell the drafter on a retry: the sentences, in its own words, and what each did. */
function contextNote(blocks, failing) {
  const lines = [];
  for (const i of failing) {
    const f = blocks[i]?.context;
    if (!f) continue;
    if (f.claims?.length) {
      for (const c of f.claims) if (c.reason) lines.push(`- "${c.text}" — ${REASON_TEXT[c.reason] || c.reason}`);
    } else if (f.reasons?.length) lines.push(`- ${f.reasons[0]}`);
  }
  const listed = [...new Set(lines)].slice(0, 8).join("\n");
  return (
    "A reviewer read the paragraphs of the author's own context and found sentences that put the author's knowledge under the paper's authority:\n" +
    `${listed || "- (a paragraph the reviewer could not judge)"}\n` +
    'Rewrite the section so that anything the paper does not state is said as the author\'s own knowledge — "in practice", "outside the lab", ' +
    '"anyone who has…" — and never as what the paper showed, found or proved. What the passages do state may be cited as the paper\'s.'
  );
}

/* helpers */
function stripFence(raw) {
  const s = String(raw || "").trim();
  const m = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return m ? m[1] : s;
}
function unescapeHtml(value) {
  return String(value || "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

module.exports = { CONTEXT_VERSION, VERDICT, REASON, REASON_TEXT, SPECIFIC_KINDS, CLAIM_LIMITS, JUDGE_SYSTEM, JUDGE_SCHEMA, buildJudgePrompt, normaliseClaim, deriveVerdict, parseJudgeResponse, judgeSection, contextNote };
