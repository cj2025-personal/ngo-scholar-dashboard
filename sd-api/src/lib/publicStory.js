/**
 * A story as the public may see it: out now, by a scholar who is listed.
 *
 * ── Why the author is part of it ────────────────────────────────────────────
 * A scholar who hides their profile (consent.listing, lib/scholarConsent) is
 * absent from everything public: the directory, search, students' stories,
 * and so the stories they published here. Their studio still shows them every
 * story, and nothing is unpublished or changed: a story is public only while
 * its status says so AND its author is listed, so unhiding brings each one
 * back exactly as it was.
 *
 * Every public read of a story (the article by slug, its images, its evidence,
 * its passages, the reading companion, the read counter) finds it here, so no
 * path can forget the second half. A hidden author's story answers as absent,
 * the same 404 as a slug that never existed: "this exists but is hidden"
 * would itself say something about the person.
 *
 * Here rather than in editorial.service because reads.service needs it, and
 * editorial.service requires reads.service.
 */
const { COLLECTIONS } = require("../db/mongo");
const { scholarFilter } = require("./identity");
const { isListed } = require("./scholarConsent");

/** Out now: published, or scheduled and its time has come. */
function buildPublicStoryQuery(now = new Date()) {
  return {
    $or: [
      { status: "published" },
      { status: "scheduled", scheduled_for: { $lte: now } },
    ],
  };
}

/**
 * Is this story's author listed? A story with no author on record matches no
 * scholar who could have asked to be hidden, so it is not held back here.
 */
async function authorIsListed(db, profileId) {
  if (!profileId) return true;
  const scholar = await db.collection("scholars").findOne(scholarFilter(profileId), { projection: { "consent.listing": 1 } });
  return isListed(scholar);
}

/**
 * The public story matching `filter`, or null when there is none or its
 * author is hidden. `options` are findOne's; an inclusion projection gets
 * `profile_id` added, which the author check needs.
 */
async function findPublicStory(db, filter, options = {}) {
  const projection = options.projection ? { ...options.projection, profile_id: 1 } : undefined;
  const story = await db
    .collection(COLLECTIONS.scholarEditorials)
    .findOne({ $and: [filter, buildPublicStoryQuery()] }, projection ? { ...options, projection } : options);
  if (!story) return null;
  return (await authorIsListed(db, story.profile_id)) ? story : null;
}

module.exports = { buildPublicStoryQuery, authorIsListed, findPublicStory };
