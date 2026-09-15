/**
 * The chip's live preview: is this block still traceable to its source?
 *
 * The same token-overlap measure the server applies on save (sd-api
 * `lib/provenance.js`), so the chip the scholar watches while editing
 * predicts the chip that will be stored. Content words of three or more
 * characters, minus a short stop list; the fraction of the drafted block's
 * words still present in the current text.
 */

export const TRACE_THRESHOLD = 0.6;

const STOP = new Set([
  "the", "and", "for", "that", "with", "this", "from", "which", "were", "was", "are", "has", "have", "had",
  "but", "not", "its", "their", "they", "than", "then", "when", "into", "also", "more", "most", "such",
  "about", "over", "under", "between", "these", "those", "there", "here", "where", "what", "who", "how",
]);

export function plainText(html) {
  return String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(text) {
  const out = new Set();
  for (const raw of plainText(text).toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length >= 3 && !STOP.has(raw)) out.add(raw);
  }
  return out;
}

export function overlap(draftedText, currentText) {
  const drafted = tokenSet(draftedText);
  if (drafted.size === 0) return 0;
  const current = tokenSet(currentText);
  let kept = 0;
  for (const t of drafted) if (current.has(t)) kept += 1;
  return kept / drafted.size;
}

/** What the chip should say for a block right now. Null for a block never drafted. */
export function chipFor(block, sourceLabel) {
  if (!block || block.type === "image") return null;
  /* The author's own context: no passage behind it, by design; what it
     carries is the list of specifics the author must verify. */
  if (block.ownView && block.context) {
    const toVerify = Array.isArray(block.context.toVerify) ? block.context.toVerify : [];
    const unverified = toVerify.filter((v) => !v.verified).length;
    return {
      context: true,
      traceable: true,
      overlap: 1,
      label: unverified ? `your own context · ${unverified} to verify` : toVerify.length ? "your own context · verified" : "your own context",
      title: unverified
        ? `Written as your own knowledge, not from the paper. ${unverified} specific${unverified === 1 ? "" : "s"} the agent brought in ${unverified === 1 ? "is" : "are"} not yet verified by you; the story cannot be published until ${unverified === 1 ? "it is" : "they are"}.`
        : "Written as your own knowledge, not from the paper. Readers see it as yours.",
      partial: false,
      unsupportedClaims: [],
    };
  }
  if (!Array.isArray(block.sourceRefs) || block.sourceRefs.length === 0) return null;
  const ids = block.sourceRefs.map((r) => r.passageId).join(", ");
  const live = overlap(block.draftedText || "", block.html || "");
  const traceable = Boolean(block.draftedText) && live >= TRACE_THRESHOLD;
  const fidelity = block.fidelity || null;
  return {
    traceable,
    overlap: live,
    label: traceable ? `from ${sourceLabel || "source"} · ${ids}` : "no longer traceable",
    title: traceable
      ? `Drafted from passage${block.sourceRefs.length === 1 ? "" : "s"} ${ids} of the source. ${Math.round(live * 100)}% of the drafted wording remains.`
      : `This block has been edited beyond its source: ${Math.round(live * 100)}% of the drafted wording remains, under the ${Math.round(TRACE_THRESHOLD * 100)}% needed to keep the chip.`,
    partial: traceable && fidelity?.verdict === "partial",
    unsupportedClaims: fidelity?.unsupportedClaims || [],
  };
}

/** "Gupta 2011" for the chip. */
export function shortSourceLabel({ title, year, scholarSurname }) {
  const who = scholarSurname || (title ? String(title).split(/\s+/).slice(0, 3).join(" ") : "source");
  return year ? `${who} ${year}` : who;
}
