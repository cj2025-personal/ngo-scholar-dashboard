/**
 * The fidelity judge: does the paper say what the draft says it says?
 *
 * ── A separate role, on purpose ─────────────────────────────────────────────
 * The drafter is asked to write only what the passages state. A judge with
 * the same instructions in the same call would be the drafter marking its
 * own work, which is the pattern this whole plan is written against. So the
 * judge is a second prompt with a different job: it is handed the passages a
 * section cited and the paragraphs the section produced, and asked to find
 * the claims in each paragraph and check each one. It never sees the
 * drafter's instructions and has no stake in the draft passing.
 *
 * ── Claims, not paragraphs ──────────────────────────────────────────────────
 * The unit of judgement is the claim: one factual assertion about the study,
 * its method, its result, or the world. A paragraph is the sum of its claims.
 * This matters twice over. First, a reader can be shown which sentence rests
 * on which sentence of the paper, which is the evidence ledger. Second, it
 * stops the judge punishing what is not a claim at all: a definition of a
 * term in plain words, a transition, a restatement of the topic. Before, "an
 * area of weak signal" glossing the word "null" was marked as unsupported,
 * and a warning that fires on accurate writing is a warning people learn to
 * ignore.
 *
 * ── Verdicts, and what they do ──────────────────────────────────────────────
 *   supported    every claim is stated by, or follows directly from, the
 *                cited passages. A paragraph with no claims is supported,
 *                because there is nothing to dispute.
 *   partial      at least one claim is, and at least one is not.
 *   unsupported  no claim is.
 *
 * The graph treats anything short of `supported` as grounds to redraft that
 * section with the unsupported claims named. After the retries a paragraph
 * still unsupported is dropped and a partial one ships with a warning; if a
 * section loses all its prose the job fails with a sentence. A paragraph
 * that cited nothing is unsupported before the judge is asked — there is
 * nothing to check it against.
 *
 * ── Deterministic where it can be ───────────────────────────────────────────
 * No citation → unsupported, without a model call. A missing verdict from
 * the judge → unsupported, because silence is not support. One judge call
 * per section, not per paragraph: the passages are shared and the verdicts
 * come back indexed. The paragraph verdict is derived here from the claims,
 * never taken from the model, so the rule above is the rule that applies.
 */

const FIDELITY_VERSION = "fidelity-judge-2026.2";

const VERDICT = { SUPPORTED: "supported", PARTIAL: "partial", UNSUPPORTED: "unsupported" };

/** Paragraphs per judge call. Claims with quoted evidence add up; past this the answer is cut off mid-JSON. */
const JUDGE_BATCH = 3;

/** Bounds on what is stored per paragraph. Past these, the judge is confused, not thorough. */
const CLAIM_LIMITS = { perParagraph: 12, textChars: 300, evidenceChars: 400, passages: 6 };

const JUDGE_SYSTEM = [
  "You are a fact-checker. You are given numbered passages from a research paper and numbered paragraphs",
  "written about that paper by someone else. For each paragraph, list its claims and check each one against",
  "the passages that paragraph cites.",
  "",
  "What counts as a claim: one factual assertion about the study, its method, its result, its numbers, its",
  "authors, or the world. A sentence may hold more than one claim; split them.",
  "What does not count as a claim, and must not be listed: defining or explaining a term in plain words,",
  "a sentence that only introduces or frames the topic, a transition, a restatement of what the paper is",
  "about, or an attribution such as \"the authors note\". Rephrasing and simplifying are not claims either.",
  "",
  "Rules:",
  "- Judge only against the passages shown. Outside knowledge does not count as support, even if true.",
  "- A claim is \"supported\" if it is stated by, or follows directly from, a cited passage. Adding a number,",
  "  a cause, a comparison, a consequence, a prediction, or a motive the passages do not state is",
  "  \"unsupported\".",
  "- For every claim give the passage ids that support it and quote, verbatim, the passage sentence that",
  "  does. For an unsupported claim give an empty list and an empty quote.",
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
                verdict: { type: "STRING", enum: ["supported", "unsupported"] },
                passage_ids: { type: "ARRAY", items: { type: "STRING" } },
                evidence: { type: "STRING" },
              },
              required: ["text", "verdict", "passage_ids", "evidence"],
            },
          },
        },
        required: ["index", "claims"],
      },
    },
  },
  required: ["paragraphs"],
};

/**
 * @param {object} p
 * @param {{index:number, text:string}[]} p.paragraphs   the section's prose, numbered from 1
 * @param {{id:string, text:string}[]} p.passages        the passages those paragraphs cited
 */
function buildJudgePrompt({ paragraphs, passages }) {
  return [
    "PASSAGES FROM THE PAPER:",
    ...passages.map((p) => `[${p.id}] ${p.text}`),
    "",
    "PARAGRAPHS TO CHECK:",
    ...paragraphs.map((p) => `(${p.index}) ${p.text}`),
    "",
    `Return the claims, each checked, for each of the ${paragraphs.length} paragraph(s), by index.`,
  ].join("\n");
}

/** The paragraph's verdict is the sum of its claims. The model never decides this. */
function deriveVerdict(claims) {
  if (!claims.length) return VERDICT.SUPPORTED;
  const supported = claims.filter((c) => c.verdict === VERDICT.SUPPORTED).length;
  if (supported === claims.length) return VERDICT.SUPPORTED;
  if (supported === 0) return VERDICT.UNSUPPORTED;
  return VERDICT.PARTIAL;
}

function normaliseClaim(raw, knownIds) {
  const text = String(raw?.text || "").replace(/\s+/g, " ").trim().slice(0, CLAIM_LIMITS.textChars);
  if (!text) return null;
  const verdict = raw?.verdict === VERDICT.SUPPORTED ? VERDICT.SUPPORTED : VERDICT.UNSUPPORTED;
  const passageIds = (Array.isArray(raw?.passage_ids) ? raw.passage_ids : [])
    .map((id) => String(id).trim())
    .filter((id) => id && (!knownIds || knownIds.has(id)))
    .slice(0, CLAIM_LIMITS.passages);
  const evidence = String(raw?.evidence || "").replace(/\s+/g, " ").trim().slice(0, CLAIM_LIMITS.evidenceChars);
  /* A claim said to be supported by nothing is not supported. The rule holds
     even when the model's verdict says otherwise. */
  if (verdict === VERDICT.SUPPORTED && passageIds.length === 0) {
    return { text, verdict: VERDICT.UNSUPPORTED, passageIds: [], evidence: "" };
  }
  return { text, verdict, passageIds, evidence: verdict === VERDICT.SUPPORTED ? evidence : "" };
}

/**
 * @param {string} raw
 * @param {number[]} expectedIndexes
 * @param {Set<string>|null} [knownIds]  passage ids the judge was shown; others are dropped from claims
 * @returns {Map<number, {verdict: string, claims: object[], unsupportedClaims: string[], reasons: string[]}>}
 */
function parseJudgeResponse(raw, expectedIndexes, knownIds = null) {
  let data;
  try {
    data = JSON.parse(stripFence(raw));
  } catch {
    throw new Error("The fidelity judge did not return valid JSON.");
  }
  const rows = Array.isArray(data?.paragraphs) ? data.paragraphs : [];
  const byIndex = new Map();
  for (const r of rows) {
    const index = Number(r?.index);
    if (!Number.isInteger(index)) continue;

    if (Array.isArray(r?.claims)) {
      const claims = r.claims.map((c) => normaliseClaim(c, knownIds)).filter(Boolean).slice(0, CLAIM_LIMITS.perParagraph);
      byIndex.set(index, {
        verdict: deriveVerdict(claims),
        claims,
        unsupportedClaims: claims.filter((c) => c.verdict === VERDICT.UNSUPPORTED).map((c) => c.text),
        reasons: [],
      });
      continue;
    }

    /* The older shape, a verdict per paragraph. A model that ignores the
       schema, or a stored response from before claims, still parses; it just
       carries no claims to show. */
    const verdict = Object.values(VERDICT).includes(r?.verdict) ? r.verdict : VERDICT.UNSUPPORTED;
    const unsupportedClaims = (Array.isArray(r?.unsupported_claims) ? r.unsupported_claims : []).map((s) => String(s).trim()).filter(Boolean).slice(0, 6);
    byIndex.set(index, {
      verdict,
      claims: [],
      unsupportedClaims,
      reasons: (Array.isArray(r?.reasons) ? r.reasons : []).map((s) => String(s).trim()).filter(Boolean).slice(0, 6),
    });
  }
  const out = new Map();
  for (const index of expectedIndexes) {
    out.set(
      index,
      byIndex.get(index) || { verdict: VERDICT.UNSUPPORTED, claims: [], unsupportedClaims: [], reasons: ["the judge returned no verdict for this paragraph"] },
    );
  }
  return out;
}

/**
 * Judge one section's blocks. Attaches `fidelity` to each paragraph block.
 *
 * @param {object} p
 * @param {object[]} p.blocks            blocks from parseSection (paragraph / quote), with sourceRefs
 * @param {{id:string,text:string}[]} p.passages   all passages; the cited subset is selected here
 * @param {(req: object) => Promise<{text: string, usage?: object, modelVersion?: string|null}>} p.generate
 * @returns {Promise<{blocks: object[], call: object|null, failing: number[]}>}  failing = indexes into blocks
 */
async function judgeSection({ blocks, passages, generate }) {
  const byId = new Map(passages.map((p) => [p.id, p]));
  const out = blocks.map((b) => ({ ...b }));
  const toJudge = [];
  const failing = [];

  out.forEach((block, i) => {
    if (block.type !== "paragraph") return;
    const refs = (block.sourceRefs || []).map((r) => r.passageId).filter((id) => byId.has(id));
    if (refs.length === 0) {
      block.fidelity = {
        verdict: VERDICT.UNSUPPORTED, claims: [], unsupportedClaims: [], reasons: ["cites no passage"],
        checks: { cited: 0, judged: false, claims: 0 }, verifierVersion: FIDELITY_VERSION,
      };
      failing.push(i);
      return;
    }
    toJudge.push({ blockIndex: i, index: toJudge.length + 1, text: unescapeHtml(block.html), refs });
  });

  if (toJudge.length === 0) return { blocks: out, call: null, failing };

  const citedIds = [...new Set(toJudge.flatMap((p) => p.refs))];
  const cited = citedIds.map((id) => byId.get(id));
  const prompt = buildJudgePrompt({ paragraphs: toJudge.map((p) => ({ index: p.index, text: p.text })), passages: cited });
  const r = await generate({ prompt, systemInstruction: JUDGE_SYSTEM, responseSchema: JUDGE_SCHEMA, temperature: 0, maxOutputTokens: 8192 });
  const verdicts = parseJudgeResponse(r.text, toJudge.map((p) => p.index), new Set(citedIds));

  for (const p of toJudge) {
    const v = verdicts.get(p.index);
    out[p.blockIndex].fidelity = { ...v, checks: { cited: p.refs.length, judged: true, claims: v.claims.length }, verifierVersion: FIDELITY_VERSION };
    if (v.verdict !== VERDICT.SUPPORTED) failing.push(p.blockIndex);
  }
  failing.sort((a, b) => a - b);
  return { blocks: out, call: { step: "judge_fidelity", usage: r.usage || null, model: r.modelVersion || null, paragraphs: toJudge.length }, failing };
}

/** What to tell the drafter on a retry: the claims, in its own words. */
function fidelityNote(blocks, failing) {
  const claims = [];
  for (const i of failing) {
    const f = blocks[i]?.fidelity;
    if (!f) continue;
    if (f.unsupportedClaims.length) claims.push(...f.unsupportedClaims.map((c) => `"${c}"`));
    else if (f.reasons.length) claims.push(f.reasons[0]);
  }
  const listed = [...new Set(claims)].slice(0, 8).map((c) => `- ${c}`).join("\n");
  return (
    "A fact-checker compared your previous draft of this section with the passages and found claims the passages do not " +
    `support:\n${listed || "- (a paragraph that cited no passage)"}\n` +
    "Rewrite the section using only what the passages state. If a point is not in the passages, leave it out; do not soften it, and do not cite a passage that does not contain it."
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

module.exports = { FIDELITY_VERSION, VERDICT, CLAIM_LIMITS, JUDGE_BATCH, JUDGE_SYSTEM, JUDGE_SCHEMA, buildJudgePrompt, deriveVerdict, parseJudgeResponse, judgeSection, fidelityNote };
