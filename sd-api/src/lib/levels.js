"use strict";

/**
 * One article, every reading age.
 *
 * ── What a level is ─────────────────────────────────────────────────────────
 * The scholar approves one article. A level is that article rewritten for a
 * different reader, paragraph by paragraph, with every rewritten paragraph
 * resting on the same passages as the paragraph it replaces. Headings,
 * quotes, pictures and the scholar's own-view paragraphs are carried as they
 * are. Block for block, a level lines up with the article, which is what
 * lets a reader slide between levels on one page and a teacher assign one
 * per student.
 *
 * ── What is rewritten and what is not ───────────────────────────────────────
 * Only a paragraph that is still drawn from the paper. A paragraph the
 * scholar rewrote away from its source is theirs, in their words, and is
 * carried rather than re-imagined at another level; the same for a paragraph
 * marked as their own view. A level never adds a claim: the rewrite is judged
 * against the passages exactly as the original was, claim by claim.
 *
 * ── Staleness ───────────────────────────────────────────────────────────────
 * A level records a hash of every block it was made from. When the article
 * changes, the level is stale, and a stale level is never shown to the
 * public, because a reader switching levels must never find the levels
 * saying different things.
 */

const crypto = require("crypto");

const composer = require("./draftComposer");
const { AUDIENCES, normaliseAudience } = require("./audiences");

const LEVELS_VERSION = "reading-levels-2026.1";
const LEVEL_MARKER = "=== PARAGRAPH TO REWRITE FOR ANOTHER READER ===";
const PASSAGES_MARKER = "=== PASSAGES THIS PARAGRAPH RESTS ON ===";
const MAX_LEVEL_CHARS = 2500;

const LEVEL_SCHEMA = { type: "OBJECT", properties: { text: { type: "STRING" } }, required: ["text"] };

const plain = (html) =>
  String(html || "").replace(/<[^>]+>/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const escapeHtml = (t) => String(t || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const hash = (t) => crypto.createHash("sha256").update(String(t), "utf8").digest("hex");

/** Which bands a story can be written for: every band but its own, or the subset asked for. */
function targetsFor(storyAudience, requested = null) {
  const own = normaliseAudience(storyAudience);
  const all = Object.keys(AUDIENCES).filter((a) => a !== own);
  if (!Array.isArray(requested) || requested.length === 0) return all;
  const wanted = new Set(requested.map((a) => normaliseAudience(a)));
  return all.filter((a) => wanted.has(a));
}

/** Which blocks a level rewrites; the rest are carried. */
function levelPlan(blocks) {
  return (blocks || []).map((b, i) => ({
    index: i,
    rewrite:
      b.type === "paragraph" &&
      !b.ownView &&
      Array.isArray(b.sourceRefs) && b.sourceRefs.length > 0 &&
      b.traceable !== false,
  }));
}

/**
 * @param {object} p
 * @param {{name?: string}} p.scholar
 * @param {string} p.title
 * @param {object} p.block            the mapped paragraph: html, sourceRefs
 * @param {{id: string, text: string}[]} p.passages   all passages; the cited subset is shown
 * @param {string} p.audience         the band to write for
 * @param {string} p.sourceAudience   the band the article was written for
 * @param {boolean} [p.strictVoice]
 */
function buildLevelPrompt({ scholar = {}, title, block, passages, audience, sourceAudience, strictVoice = false }) {
  const to = AUDIENCES[normaliseAudience(audience)];
  const from = AUDIENCES[normaliseAudience(sourceAudience)];
  const name = scholar.name || "the scholar";
  const ids = (block.sourceRefs || []).map((r) => r.passageId);
  const cited = (passages || []).filter((p) => ids.includes(p.id));
  const lines = [
    `Rewrite one paragraph of an article about a paper by ${name}. The article was written for ${from.brief}`,
    `Rewrite this paragraph for ${to.brief}`,
    "",
    `Article title: ${title || "Untitled"}`,
    "",
    "Rules:",
    "- Keep every fact the paragraph states and add none. Say nothing the passages below do not say.",
    "- Same meaning, different reader: shorter sentences and plainer words for a younger reader. Do not talk down.",
    `- Write about ${name}, never as ${name}. Third person only.`,
    "- One paragraph, 40 to 160 words. Return only the JSON described by the schema.",
  ];
  if (strictVoice) lines.push(`- Your previous attempt used first-person language. Third person only, about ${name}.`);
  lines.push("", PASSAGES_MARKER, ...cited.map((p) => `[${p.id}] ${p.text}`), "", LEVEL_MARKER, plain(block.html));
  return lines.join("\n");
}

function parseLevelResponse(raw) {
  let data;
  try {
    data = JSON.parse(stripFence(raw));
  } catch {
    throw new Error("The level writer did not return valid JSON.");
  }
  const text = String(data?.text || "").replace(/\s+/g, " ").trim().slice(0, MAX_LEVEL_CHARS);
  if (!text) throw new Error("The level writer returned an empty paragraph.");
  return { text, violations: composer.firstPersonSentences(text) };
}

/** A block carried into a level unchanged, in the shape the judge and the store both read. */
function carry(b) {
  if (b.type === "image") return { type: "image", imageId: b.imageId || null, caption: b.caption || "", alt: b.alt || "", width: b.width || "body" };
  const refs = Array.isArray(b.sourceRefs) && b.sourceRefs.length ? b.sourceRefs.map((r) => ({ passageId: r.passageId })) : null;
  return {
    type: b.type,
    html: b.html || "",
    ...(refs ? { sourceRefs: refs, draftedText: b.draftedText || plain(b.html), fidelity: b.fidelity || null } : {}),
    ...(b.ownView ? { ownView: true } : {}),
  };
}

/**
 * A level's blocks, aligned with the article's: rewritten paragraphs in
 * place, everything else carried.
 * @param {object} p
 * @param {object[]} p.blocks   the mapped article blocks
 * @param {Map<number, {text: string, fidelity?: object}>} p.rewrites  by block index
 */
function assembleLevel({ blocks, rewrites }) {
  return (blocks || []).map((b, i) => {
    const r = rewrites.get(i);
    if (!r) return carry(b);
    return {
      type: "paragraph",
      html: escapeHtml(r.text),
      sourceRefs: (b.sourceRefs || []).map((x) => ({ passageId: x.passageId })),
      draftedText: r.text,
      fidelity: r.fidelity || null,
    };
  });
}

/** What a level was made from, block by block, so a later edit is noticed. */
function sourceHashes(blocks) {
  return (blocks || []).map((b) => (b.type === "image" ? `image:${b.imageId || ""}` : hash(plain(b.html))));
}

/** Whether the article has moved on since a level was made. */
function staleness(level, blocks) {
  const now = sourceHashes(blocks);
  const then = Array.isArray(level?.source_hashes) ? level.source_hashes : [];
  if (then.length !== now.length) return { stale: true, reason: "the article has a different number of blocks than when this level was written" };
  const changed = now.map((h, i) => (h === then[i] ? null : i + 1)).filter(Boolean);
  if (!changed.length) return { stale: false, reason: null };
  return { stale: true, reason: `block${changed.length === 1 ? "" : "s"} ${changed.join(", ")} changed since this level was written` };
}

function stripFence(raw) {
  const s = String(raw || "").trim();
  const m = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return m ? m[1] : s;
}

module.exports = {
  LEVELS_VERSION,
  LEVEL_MARKER,
  PASSAGES_MARKER,
  LEVEL_SCHEMA,
  plain,
  targetsFor,
  levelPlan,
  buildLevelPrompt,
  parseLevelResponse,
  assembleLevel,
  sourceHashes,
  staleness,
};
