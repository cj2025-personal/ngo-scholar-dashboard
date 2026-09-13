"use strict";

/**
 * Watching the scientific record.
 *
 * ── The failure this prevents ───────────────────────────────────────────────
 * An explainer is published, and years later the paper it rests on is
 * retracted or corrected. Every other explainer in the world stays as it was,
 * still carrying the scholar's name over a claim the record has withdrawn.
 * This one knows which passages each paragraph rests on and which paper
 * those passages came from, so it can notice, say which paragraphs are
 * affected, and put the question to the scholar.
 *
 * ── Where the record is read ────────────────────────────────────────────────
 * Crossref carries every notice a publisher registers against a DOI:
 * retractions, withdrawals, corrections, errata, expressions of concern.
 * They arrive as `updated-by` entries on the work. Nothing here decides what
 * to do about a notice; it only makes sure one is never missed.
 */

const RECORD_VERSION = "record-watch-2026.1";

/** What a notice means, in one word the scholar and the reader both understand. */
const KIND = { RETRACTED: "retracted", WITHDRAWN: "withdrawn", CORRECTED: "corrected", CONCERN: "concern", UPDATED: "updated" };

const NOTICE_KINDS = {
  retraction: KIND.RETRACTED,
  partial_retraction: KIND.RETRACTED,
  withdrawal: KIND.WITHDRAWN,
  removal: KIND.WITHDRAWN,
  correction: KIND.CORRECTED,
  erratum: KIND.CORRECTED,
  corrigendum: KIND.CORRECTED,
  addendum: KIND.UPDATED,
  new_edition: KIND.UPDATED,
  new_version: KIND.UPDATED,
  expression_of_concern: KIND.CONCERN,
};

/** Kinds that deserve the scholar's attention. An addendum does not. */
const ALERT_KINDS = new Set([KIND.RETRACTED, KIND.WITHDRAWN, KIND.CORRECTED, KIND.CONCERN]);

/** A DOI out of a URL, a "doi:" prefix, or a bare string. Null when there is none. */
function doiFrom(value) {
  const m = String(value || "").match(/10\.\d{4,9}\/[^\s"'<>]+/i);
  if (!m) return null;
  return m[0].replace(/[.,;:)\]]+$/, "").toLowerCase();
}

function dateFrom(updated) {
  if (!updated) return null;
  if (typeof updated["date-time"] === "string") return updated["date-time"].slice(0, 10);
  const parts = Array.isArray(updated["date-parts"]) ? updated["date-parts"][0] : null;
  if (Array.isArray(parts) && parts.length) {
    const [y, mo = 1, d = 1] = parts;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return null;
}

/**
 * The notices registered against a Crossref work.
 * @param {object} work   the `message` of a Crossref /works/{doi} response
 * @returns {{type: string, kind: string, doi: string|null, label: string|null, date: string|null}[]}
 */
function noticesFrom(work) {
  const rows = Array.isArray(work?.["updated-by"]) ? work["updated-by"] : [];
  return rows
    .map((r) => {
      const type = String(r?.type || "").toLowerCase().replace(/[\s-]+/g, "_");
      return {
        type,
        kind: NOTICE_KINDS[type] || KIND.UPDATED,
        doi: doiFrom(r?.DOI || r?.doi) || null,
        label: r?.label ? String(r.label) : null,
        date: dateFrom(r?.updated),
      };
    })
    .filter((n) => n.type);
}

function sentenceFor(kind, { title, date }) {
  const paper = title ? `“${title}”` : "the paper this article is drawn from";
  const when = date ? ` on ${date}` : "";
  switch (kind) {
    case KIND.RETRACTED: return `${paper} was retracted${when}. Claims drawn from it can no longer stand under your name as they are.`;
    case KIND.WITHDRAWN: return `${paper} was withdrawn${when}. Claims drawn from it can no longer stand under your name as they are.`;
    case KIND.CORRECTED: return `${paper} was corrected${when}. Check whether the correction touches what this article says.`;
    case KIND.CONCERN: return `An expression of concern was issued for ${paper}${when}. Readers should know, and you may want to say so in the article.`;
    default: return `${paper} was updated${when}.`;
  }
}

/**
 * The alerts a story should carry: one per notice worth attention, naming the
 * paragraphs that rest on the paper.
 * @param {object} p
 * @param {object[]} p.notices    from noticesFrom
 * @param {object} p.story        the mapped story: bodyBlocks, provenance
 */
function alertsFor({ notices, story }) {
  const blocks = Array.isArray(story?.bodyBlocks) ? story.bodyBlocks : [];
  const affected = blocks.map((b, i) => (b.type === "paragraph" && Array.isArray(b.sourceRefs) && b.sourceRefs.length ? i + 1 : null)).filter(Boolean);
  return notices
    .filter((n) => ALERT_KINDS.has(n.kind))
    .map((n) => ({
      kind: n.kind,
      type: n.type,
      notice_doi: n.doi,
      notice_url: n.doi ? `https://doi.org/${n.doi}` : null,
      date: n.date,
      sentence: sentenceFor(n.kind, { title: story?.provenance?.title || null, date: n.date }),
      affected_blocks: affected,
    }));
}

/** The one line for a Studio to-do or a banner, from the worst alert. */
function headline(alerts) {
  if (!alerts?.length) return null;
  const order = [KIND.RETRACTED, KIND.WITHDRAWN, KIND.CONCERN, KIND.CORRECTED];
  const worst = alerts.slice().sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))[0];
  return worst.sentence;
}

module.exports = { RECORD_VERSION, KIND, NOTICE_KINDS, ALERT_KINDS, doiFrom, noticesFrom, alertsFor, sentenceFor, headline };
