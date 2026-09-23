const express = require("express");

const { asyncHandler } = require("../lib/async-handler");
const { ApiError } = require("../lib/api-error");
const { requireAuth } = require("../middleware/auth.middleware");
const { canonicalScholarId } = require("../lib/identity");
const { listEpisodesForScholar, getEpisodeForScholar } = require("../services/podcasts.service");

const router = express.Router();

/**
 * The dialogues a scholar is named in.
 *
 * Read-only, and meant to stay that way. The portal's job is to show a scholar
 * what has been generated against their name; the decision about whether it
 * ships belongs to the editorial system that generated it, where the state
 * machine acting on that decision lives. No POST is planned here.
 */

function requireProfile(req) {
  const profileId = canonicalScholarId(req.auth.user);
  if (!profileId) throw new ApiError(403, "This session is not linked to a scholar profile.");
  return profileId;
}

/** Every episode, published or not, newest first. */
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const profileId = requireProfile(req);
    const limit = Number.parseInt(req.query.limit, 10);
    const episodes = await listEpisodesForScholar(profileId, {
      limit: Number.isFinite(limit) ? limit : 50,
    });
    res.status(200).json({ episodes });
  }),
);

/** One episode: the transcript, and the scholar's own passages behind it. */
router.get(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const profileId = requireProfile(req);
    const episode = await getEpisodeForScholar(profileId, req.params.id);
    /* An episode belonging to another scholar is indistinguishable from one
       that does not exist, which is the intent: the query is scoped by
       profile, so this cannot report on someone else's conversation. */
    if (!episode) throw new ApiError(404, "That episode is not one of yours.");
    res.status(200).json({ episode });
  }),
);

module.exports = router;
