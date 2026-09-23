"use strict";

/**
 * Judge one paragraph again, against the words it says now.
 *
 * A verdict is stored on the block when the drafter writes it, and it is
 * about the text as drafted. When the scholar rewrites that paragraph the
 * verdict stays behind, describing sentences that are no longer in the
 * article — so a scholar who fixed a "partly supported" paragraph by cutting
 * the unsupported sentence stayed flagged for it, with nothing in the
 * workspace able to clear it and no explanation of why.
 *
 * This re-runs the judge that owns the paragraph — fidelity for one drawn
 * from the paper, reach for one that goes beyond it — over the text as it
 * currently stands, and stores what comes back. It judges the saved story,
 * not text posted with the request: the verdict has to be about the words in
 * the article, and the publish check is already unavailable while a draft has
 * unsaved edits.
 */

const { ApiError } = require("../lib/api-error");
const fidelity = require("../lib/fidelity");
const reach = require("../lib/reach");
const storyVersion = require("../lib/storyVersion");
const vertex = require("../lib/vertex");
const { traced } = require("../lib/tracing");
const { getDb } = require("../db/mongo");
const { normaliseAudience } = require("../lib/audiences");
const { passagesFor } = require("./passages.service");

/**
 * @param {object} p
 * @param {string} p.storyId
 * @param {number} p.index          0-based index into the story's body blocks
 * @param {number|null} p.baseVersion
 * @param {function|null} p.generate  injected by the tests; Vertex otherwise
 * @returns {Promise<{story: object, verdict: string, changed: boolean}>}
 */
async function recheckBlock({ storyId, scholarId, profileId, user, index, baseVersion = null, generate = null }) {
  const editorial = require("./editorial.service");
  const db = await getDb();
  const story = await editorial.findOwnedStory({ storyId, scholarId, profileId });

  const blocks = Array.isArray(story.body_blocks) ? story.body_blocks : [];
  const at = Number(index);
  if (!Number.isInteger(at) || at < 0 || at >= blocks.length) throw new ApiError(400, "That paragraph is not in this story.");

  const raw = blocks[at];
  /* Names what it found. A quote carries source refs exactly as a paragraph
     does, so "only a paragraph is checked" is a sentence a caller can read
     while believing they sent one — the block's type is the fact that
     resolves it. */
  if (raw?.type !== "paragraph") {
    throw new ApiError(400, `Only a paragraph is checked against the paper; block ${at} is a ${raw?.type || "block of unknown type"}.`);
  }
  const provenance = raw.provenance || null;
  if (!provenance || !(provenance.source_refs || []).length) {
    throw new ApiError(409, "This paragraph cites no passage, so there is nothing to check it against.");
  }

  const passages = await passagesFor(db, story);
  if (!passages.length) throw new ApiError(409, "This story has no source paper on record, so its paragraphs cannot be checked against it.");

  const gen = generate || traced("recheck.generateContent", (req) => vertex.generateContent(req), { metadata: { storyId: String(story._id) } });

  /* The judges take the client-shaped block, the same one the drafter hands
     them, so a re-check is judged exactly as the first pass was. */
  const extension = Boolean(provenance.extension);
  const before = extension ? provenance.reach?.verdict || null : provenance.fidelity?.verdict || null;
  const subject = {
    type: "paragraph",
    html: raw.html || "",
    sourceRefs: (provenance.source_refs || []).map((r) => ({ passageId: r.passageId || r.passage_id })),
    ...(extension ? { extension: true } : {}),
  };

  const judged = extension
    ? await reach.judgeSection({ blocks: [subject], passages, audience: normaliseAudience(story.provenance?.audience), generate: gen })
    : await fidelity.judgeSection({ blocks: [subject], passages, generate: gen });
  const result = judged.blocks[0];
  const verdict = extension ? result.reach?.verdict || null : result.fidelity?.verdict || null;

  /* Only the verdict moves.
   *
   * `drafted_text` is what the machine wrote, and the evidence ledger hashes
   * the block against it to say how far the author's hand went. Replacing it
   * with the author's own words to make the chip read "traceable" again would
   * have the ledger claim the drafter produced sentences it never wrote. A
   * paragraph the author rewrote stays theirs on the record; what a re-check
   * changes is whether what it now says is borne out by the passages. */
  const nextBlocks = blocks.map((b, i) => (i === at
    ? {
        ...b,
        provenance: {
          ...provenance,
          ...(extension ? { reach: result.reach || null } : { fidelity: result.fidelity || null }),
          rechecked_at: new Date(),
        },
      }
    : b));

  const { version } = await editorial.commitStoryWrite(db, {
    story,
    set: { body_blocks: nextBlocks },
    source: storyVersion.SOURCE.SCHOLAR,
    actor: user?.email || "the author",
    note: `Paragraph ${at + 1} checked again: ${before || "unjudged"} → ${verdict || "unjudged"}`,
    baseVersion,
  });

  const fresh = await editorial.getEditorialStory({ storyId, scholarId, profileId });
  return { ...fresh, kind: extension ? "reach" : "fidelity", verdict, before, changed: verdict !== before, version };
}

module.exports = { recheckBlock };
