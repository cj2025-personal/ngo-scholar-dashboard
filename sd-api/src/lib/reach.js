/**
 * The reach judge: does what the draft says beyond the paper follow from it?
 *
 * ── Why a second judge ──────────────────────────────────────────────────────
 * A scholar asks for an article about why their work matters today. The
 * paper does not say why it matters today; papers say what was done and
 * found. The fidelity judge, rightly, would mark every such sentence
 * unsupported, the drafter would drop it, and the scholar would get a
 * summary they did not ask for. So a paragraph may be written as an
 * EXTENSION: it names the passages it builds on and says what follows from
 * them for the reader. This judge asks a different question of it than the
 * fidelity judge asks of a paper paragraph: not "does the paper say this?"
 * but "does this follow from what the paper says, is it said as an
 * implication, and does it bring in nothing from outside?"
 *
 * ── The three guardrails, and which one enforces each ───────────────────────
 *   anchored     an extension paragraph cites the passages it builds on, like
 *                any drafted paragraph. No anchor → overreach, without a
 *                model call. (Here.)
 *   implied      each claim is a consequence of the anchored passages, said
 *                as one. "The same problem faces any receiver in a crowded
 *                band" follows; "this method is used in 5G base stations" is
 *                a fact about the world the paper does not state, and is
 *                overreach even if true. (This judge, per claim.)
 *   suitable     for the two youngest bands, nothing frightening, nothing
 *                beyond the reader's world. (This judge, only when told the
 *                reader is young.)
 *
 * ── Verdicts, and what they do ──────────────────────────────────────────────
 *   follows      every claim follows from the anchors, as an implication.
 *   partial      at least one does, at least one does not.
 *   overreach    no claim does, or any claim is unsuitable for the reader.
 *
 * The graph treats anything short of `follows` as grounds to redraft with
 * the claims named, exactly as it treats fidelity. After the retries an
 * overreaching paragraph is dropped and a partial one ships with its claims
 * marked; an unsuitable claim is never partial, because a paragraph a child
 * should not read is not the scholar's to weigh later.
 *
 * ── Deterministic where it can be ───────────────────────────────────────────
 * The paragraph verdict is derived here from the claims, never taken from
 * the model. A missing verdict is overreach. The judge never sees the
 * drafter's instructions and has no stake in the draft passing.
 */

const { AUDIENCES, normaliseAudience } = require("./audiences");

const REACH_VERSION = "reach-judge-2026.1";

const VERDICT = { FOLLOWS: "follows", PARTIAL: "partial", OVERREACH: "overreach" };

/** Why a claim overreaches. Stable names: the UI and the ledger show them. */
const REASON = { OUTSIDE_FACT: "outside_fact", STATED_AS_FINDING: "stated_as_finding", DOES_NOT_FOLLOW: "does_not_follow", UNSUITABLE: "unsuitable" };
const REASONS = new Set(Object.values(REASON));

const REASON_TEXT = {
  outside_fact: "brings in a fact the paper does not state",
  stated_as_finding: "states an implication as if the paper found it",
  does_not_follow: "does not follow from the passages it builds on",
  unsuitable: "is not suitable for this reader",
};

/** Bounds on what is stored per paragraph, the same as the fidelity judge's. */
const CLAIM_LIMITS = { perParagraph: 12, textChars: 300, passages: 6 };

const JUDGE_SYSTEM = [
  "You check writing that goes beyond a research paper. You are given numbered passages from the paper and",
  "numbered paragraphs, written by someone else, that claim to say what FOLLOWS from those passages for a",
  "reader. For each paragraph, list its claims and judge each one.",
  "",
  "What counts as a claim: one assertion about the study, its results, or what they mean for the world.",
  "A sentence may hold more than one claim; split them.",
  "What does not count, and must not be listed: explaining a term in plain words, an everyday example used",
  "only to explain an idea the passages state, a sentence that frames or introduces, a transition, or an",
  'attribution such as "the authors note".',
  "",
  "A claim FOLLOWS when it is one of these:",
  "- a restatement of what a passage says (give the passage as its anchor);",
  "- a consequence that a careful reader could draw from the passages alone, said as a consequence:",
  '  "which means", "would matter wherever", "the same problem faces any", "a reader who ... would".',
  "A claim is OVERREACH, with one reason, when it is any of these:",
  "- outside_fact: it names a product, company, technology, event, place, number, study or practice",
  "  the passages do not mention, or asserts what is done in the world today. True or not, it is not",
  '  in the paper. A general everyday example used to explain is not an outside fact; "is used in",',
  '  "has led to", "today, engineers rely on" is.',
  "- stated_as_finding: it says the paper showed, proved, found or demonstrated something the passages",
  "  do not state, or presents a consequence as a result.",
  "- does_not_follow: it is a consequence the passages do not support, or reverses or exaggerates them.",
  "- unsuitable: ONLY when the prompt says the reader is a child: it is frightening, graphic, sexual,",
  "  about self-harm, or assumes a world beyond a child's.",
  "",
  "Rules:",
  "- Judge only against the passages shown. Outside knowledge is not an anchor, even if true.",
  "- For a claim that follows, give the passage ids it builds on and omit the reason. For overreach, give",
  "  the reason and an empty list of anchor ids.",
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
                verdict: { type: "STRING", enum: ["follows", "overreach"] },
                /* Only an overreaching claim has a reason. Vertex refuses an
                   empty string as an enum value, so the field is omitted
                   rather than sent blank — found by a real run, not a fake. */
                reason: { type: "STRING", enum: ["outside_fact", "stated_as_finding", "does_not_follow", "unsuitable"], nullable: true },
                anchor_ids: { type: "ARRAY", items: { type: "STRING" } },
              },
              required: ["text", "verdict", "anchor_ids"],
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
 * @param {{index:number, text:string}[]} p.paragraphs
 * @param {{id:string, text:string}[]} p.passages   the passages those paragraphs build on
 * @param {string} [p.audience]                      names the reader when the band is young
 */
function buildJudgePrompt({ paragraphs, passages, audience = null }) {
  const aud = audience ? AUDIENCES[normaliseAudience(audience)] : null;
  return [
    ...(aud && aud.young ? [`THE READER: ${aud.readers}. Judge suitability for a child as well.`, ""] : []),
    "PASSAGES FROM THE PAPER:",
    ...passages.map((p) => `[${p.id}] ${p.text}`),
    "",
    "PARAGRAPHS THAT BUILD ON THEM:",
    ...paragraphs.map((p) => `(${p.index}) ${p.text}`),
    "",
    `Return the claims, each judged, for each of the ${paragraphs.length} paragraph(s), by index.`,
  ].join("\n");
}

/** The paragraph's verdict is the sum of its claims. An unsuitable claim is never partial. */
function deriveVerdict(claims) {
  if (!claims.length) return VERDICT.FOLLOWS;
  if (claims.some((c) => c.reason === REASON.UNSUITABLE)) return VERDICT.OVERREACH;
  const follows = claims.filter((c) => c.verdict === VERDICT.FOLLOWS).length;
  if (follows === claims.length) return VERDICT.FOLLOWS;
  if (follows === 0) return VERDICT.OVERREACH;
  return VERDICT.PARTIAL;
}

function normaliseClaim(raw, knownIds) {
  const text = String(raw?.text || "").replace(/\s+/g, " ").trim().slice(0, CLAIM_LIMITS.textChars);
  if (!text) return null;
  const anchorIds = (Array.isArray(raw?.anchor_ids) ? raw.anchor_ids : [])
    .map((id) => String(id).trim())
    .filter((id) => id && (!knownIds || knownIds.has(id)))
    .slice(0, CLAIM_LIMITS.passages);
  const reason = REASONS.has(raw?.reason) ? raw.reason : null;
  /* A claim said to follow from nothing does not follow; a claim marked
     overreach without a reason is still overreach. The rule holds even when
     the model's verdict says otherwise. */
  if (raw?.verdict === VERDICT.FOLLOWS && anchorIds.length > 0) return { text, verdict: VERDICT.FOLLOWS, reason: null, anchorIds };
  return { text, verdict: VERDICT.OVERREACH, reason: reason || REASON.DOES_NOT_FOLLOW, anchorIds: [] };
}

/**
 * @param {string} raw
 * @param {number[]} expectedIndexes
 * @param {Set<string>|null} [knownIds]
 * @returns {Map<number, {verdict: string, claims: object[], overreachClaims: string[], reasons: string[]}>}
 */
function parseJudgeResponse(raw, expectedIndexes, knownIds = null) {
  let data;
  try {
    data = JSON.parse(stripFence(raw));
  } catch {
    throw new Error("The reach judge did not return valid JSON.");
  }
  const rows = Array.isArray(data?.paragraphs) ? data.paragraphs : [];
  const byIndex = new Map();
  for (const r of rows) {
    const index = Number(r?.index);
    if (!Number.isInteger(index)) continue;
    const claims = (Array.isArray(r?.claims) ? r.claims : []).map((c) => normaliseClaim(c, knownIds)).filter(Boolean).slice(0, CLAIM_LIMITS.perParagraph);
    const failing = claims.filter((c) => c.verdict === VERDICT.OVERREACH);
    byIndex.set(index, {
      verdict: deriveVerdict(claims),
      claims,
      overreachClaims: failing.map((c) => c.text),
      reasons: [...new Set(failing.map((c) => REASON_TEXT[c.reason] || c.reason))],
    });
  }
  const out = new Map();
  for (const index of expectedIndexes) {
    out.set(index, byIndex.get(index) || { verdict: VERDICT.OVERREACH, claims: [], overreachClaims: [], reasons: ["the judge returned no verdict for this paragraph"] });
  }
  return out;
}

/**
 * Judge the extension paragraphs among a section's blocks. Attaches `reach`
 * to each; blocks that are not extension paragraphs are returned untouched.
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
  const failing = [];

  out.forEach((block, i) => {
    if (block.type !== "paragraph" || !block.extension) return;
    const refs = (block.sourceRefs || []).map((r) => r.passageId).filter((id) => byId.has(id));
    if (refs.length === 0) {
      block.reach = {
        verdict: VERDICT.OVERREACH, claims: [], overreachClaims: [], reasons: ["builds on no passage"],
        checks: { anchored: 0, judged: false, claims: 0 }, verifierVersion: REACH_VERSION,
      };
      failing.push(i);
      return;
    }
    toJudge.push({ blockIndex: i, index: toJudge.length + 1, text: unescapeHtml(block.html), refs });
  });

  if (toJudge.length === 0) return { blocks: out, call: null, failing };

  const anchorIds = [...new Set(toJudge.flatMap((p) => p.refs))];
  const anchors = anchorIds.map((id) => byId.get(id));
  const prompt = buildJudgePrompt({ paragraphs: toJudge.map((p) => ({ index: p.index, text: p.text })), passages: anchors, audience });
  const r = await generate({ prompt, systemInstruction: JUDGE_SYSTEM, responseSchema: JUDGE_SCHEMA, temperature: 0, maxOutputTokens: 8192 });
  const verdicts = parseJudgeResponse(r.text, toJudge.map((p) => p.index), new Set(anchorIds));

  for (const p of toJudge) {
    const v = verdicts.get(p.index);
    out[p.blockIndex].reach = { ...v, checks: { anchored: p.refs.length, judged: true, claims: v.claims.length }, verifierVersion: REACH_VERSION };
    if (v.verdict !== VERDICT.FOLLOWS) failing.push(p.blockIndex);
  }
  failing.sort((a, b) => a - b);
  return { blocks: out, call: { step: "judge_reach", usage: r.usage || null, model: r.modelVersion || null, paragraphs: toJudge.length }, failing };
}

/** What to tell the drafter on a retry: the claims, in its own words, and why each went too far. */
function reachNote(blocks, failing) {
  const lines = [];
  for (const i of failing) {
    const f = blocks[i]?.reach;
    if (!f) continue;
    if (f.claims.length) {
      for (const c of f.claims) if (c.verdict === VERDICT.OVERREACH) lines.push(`- "${c.text}" — ${REASON_TEXT[c.reason] || c.reason}`);
    } else if (f.reasons.length) lines.push(`- ${f.reasons[0]}`);
  }
  const listed = [...new Set(lines)].slice(0, 8).join("\n");
  return (
    "A reviewer compared the paragraphs that go beyond the paper with the passages they build on and found claims that go too far:\n" +
    `${listed || "- (a paragraph that built on no passage)"}\n` +
    "Rewrite the section so that every implication is drawn only from the passages, is said as an implication and not as a finding, " +
    "and names nothing from outside the paper. If a point needs an outside fact, leave it out."
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

module.exports = { REACH_VERSION, VERDICT, REASON, REASON_TEXT, CLAIM_LIMITS, JUDGE_SYSTEM, JUDGE_SCHEMA, buildJudgePrompt, deriveVerdict, parseJudgeResponse, judgeSection, reachNote };
