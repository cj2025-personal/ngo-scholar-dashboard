/**
 * Writing without the scholar's papers.
 *
 * A scholar may ask Kivyn for an article that draws on none of their work: a
 * subject they want to write about, from their brief alone. That article is
 * still theirs and still checked, by the machinery the author's own context
 * already has. Every section is their own account (a "context" beat with no
 * passages). The context judge reads each paragraph for anything dressed as
 * a study's finding, and lists every specific it brings in. Nothing is
 * published until the author has ticked each one. What it may not claim is
 * the authority of research it is not drawn from, so readers are told it is
 * the author's own account.
 *
 * In the pipeline it is a source like any other, so a job, a story and its
 * provenance carry it without a second code path; the source simply has no
 * text and no passages.
 */

const BRIEF_ORIGIN = "brief";
const BRIEF_SOURCE_ID = "only";
/** The key the conversation agent and the page use for "no paper". */
const BRIEF_KEY = `${BRIEF_ORIGIN}:${BRIEF_SOURCE_ID}`;
const BRIEF_TITLE = "No paper — write from the scholar's brief alone, drawing on none of their work";
/** The line under the byline on an article written this way. */
const BRIEF_LINE = "The author's own account, written without drawing on their research papers.";

/** Whether a source, job source or story provenance is a brief with no paper behind it. */
function isBriefOnly(x) {
  return Boolean(x) && x.origin === BRIEF_ORIGIN;
}

module.exports = { BRIEF_ORIGIN, BRIEF_SOURCE_ID, BRIEF_KEY, BRIEF_TITLE, BRIEF_LINE, isBriefOnly };
