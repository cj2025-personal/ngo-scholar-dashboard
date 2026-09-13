"use strict";

/**
 * One current version of a story, and a history behind it.
 *
 * ── The failure this exists to prevent ──────────────────────────────────────
 * Two people write the same story and one of them silently loses. The two
 * people are usually the same scholar: they type into the editor, the agent's
 * accepted change lands underneath them, and their save overwrites it. Before
 * this, every write filtered on the story id alone, so the last write won and
 * nobody was told.
 *
 * So every write carries the version it was made against. If the story has
 * moved on, the write is refused and the scholar is shown what changed. The
 * version is a plain counter on the story, and each version has a row holding
 * the content as of that version, which is what makes restore possible.
 *
 * ── Why save points rather than keystrokes ──────────────────────────────────
 * The editor autosaves, so an hour of writing would be hundreds of rows and a
 * history nobody can read. Consecutive writes by the same author, from the
 * same source, close together in time, collapse into one row: the version
 * number moves but the row is rewritten. The result reads like save points.
 * A write from the agent never collapses into a scholar's, and the other way
 * round, because the question "who changed this" must stay answerable.
 */

/** Versions kept per story, over and above version 1, which is never pruned. */
const KEEP_REVISIONS = 50;

/** Consecutive writes closer together than this collapse into one version. */
const COALESCE_MS = 2 * 60 * 1000;

/** Who made a version. Recorded, never inferred later. */
const SOURCE = {
  /* A person typing in the editor. */
  SCHOLAR: "scholar",
  /* An agent proposal the scholar accepted. Carries the turn it came from. */
  AGENT: "agent",
  /* The first version of a story the drafter wrote from a paper. */
  DRAFTER: "drafter",
  /* An older version put back, which is itself a new version. */
  RESTORE: "restore",
};

const SOURCES = new Set(Object.values(SOURCE));

function isVersion(value) {
  return Number.isInteger(value) && value >= 1;
}

/**
 * The version a story document is at.
 *
 * Stories written before versioning carry no counter; they are version 1, so
 * the first guarded write they receive behaves like any other.
 */
function versionOf(story) {
  return isVersion(story?.version) ? story.version : 1;
}

/**
 * A client's claim about what it was editing.
 *
 * Absent means unguarded, which is allowed so that callers that never read a
 * version can still write. Present and malformed is a mistake worth refusing,
 * because silently ignoring it would turn a guard into a no-op.
 *
 * @returns {number|null}
 */
function parseBaseVersion(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!isVersion(n)) {
    /* Both spellings: `statusCode` is what the error middleware maps to a
       response, `status` is what a caller that is not behind Express reads. */
    const error = new Error("The version you are editing must be a whole number of 1 or more.");
    error.statusCode = 400;
    error.status = 400;
    throw error;
  }
  return n;
}

/**
 * The filter that makes a write conditional on the version it was made against.
 *
 * Version 1 also matches a document that has no counter at all, which is every
 * story written before this existed.
 */
function guardFilter(id, baseVersion) {
  if (baseVersion === null || baseVersion === undefined) return { _id: id };
  if (baseVersion === 1) return { _id: id, $or: [{ version: 1 }, { version: { $exists: false } }] };
  return { _id: id, version: baseVersion };
}

/** What a scholar reads when their write lost a race. Names the cause, not the mechanism. */
function conflictSentence({ current, who = null }) {
  const byWhom = who === "agent" ? " by the agent" : who ? " somewhere else" : "";
  return (
    `This story was changed${byWhom} while you were editing, so your change was not saved over it. ` +
    `It is now at version ${current}. Reload to see the current text, then make your change again.`
  );
}

/** Whether a new write should rewrite the last version's row instead of adding one. */
function shouldCoalesce({ last, source, actor, turnId = null, at }) {
  if (!last || turnId || last.turn_id) return false;
  if (last.version === 1) return false;
  if (last.source !== source || last.created_by !== actor) return false;
  if (source !== SOURCE.SCHOLAR) return false;
  const then = last.created_at ? new Date(last.created_at).getTime() : null;
  if (then === null || Number.isNaN(then)) return false;
  return at.getTime() - then < COALESCE_MS;
}

/**
 * The row holding a story's content as of one version.
 *
 * @param {object} p
 * @param {object} p.story     the story as it will be after the write
 * @param {number} p.version
 * @param {string} p.source    one of SOURCE
 * @param {string} p.actor     the email or id of whoever caused it
 */
function revisionDocument({ storyId, profileId, story, version, source, actor, note = null, turnId = null, jobId = null, at }) {
  if (!SOURCES.has(source)) throw new Error(`Unknown revision source "${source}".`);
  return {
    story_id: storyId,
    profile_id: profileId,
    version,
    title: story.title || "",
    subtitle: story.subtitle || "",
    excerpt: story.excerpt || "",
    content: story.content || "",
    body_blocks: Array.isArray(story.body_blocks) ? story.body_blocks : [],
    status: story.status || "draft",
    source,
    turn_id: turnId,
    job_id: jobId,
    note,
    created_at: at,
    created_by: actor,
  };
}

/** What a version looks like in the history panel. Never the whole body. */
function viewRevision(doc) {
  const words = String(doc.content || "").split(/\s+/).filter(Boolean).length;
  return {
    version: doc.version,
    title: doc.title || "",
    source: doc.source,
    note: doc.note || null,
    turnId: doc.turn_id ? String(doc.turn_id) : null,
    createdAt: doc.created_at || null,
    createdBy: doc.created_by || null,
    words,
    blocks: Array.isArray(doc.body_blocks) ? doc.body_blocks.length : 0,
  };
}

module.exports = {
  KEEP_REVISIONS,
  COALESCE_MS,
  SOURCE,
  SOURCES,
  isVersion,
  versionOf,
  parseBaseVersion,
  guardFilter,
  conflictSentence,
  shouldCoalesce,
  revisionDocument,
  viewRevision,
};
