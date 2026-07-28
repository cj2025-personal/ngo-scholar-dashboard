const express = require("express");

const { asyncHandler } = require("../lib/async-handler");
const {
  requireAuth,
  communityScopeFromAuth,
} = require("../middleware/auth.middleware");
const { getScholarProfileData } = require("../services/profile.service");
const {
  createSuggestion,
  listSuggestionsForScholar,
} = require("../services/suggestion.service");

const router = express.Router();

router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const profile = await getScholarProfileData({
      scholarId: req.auth.user.scholar_id,
      profileId: req.auth.user.profile_id,
      user: req.auth.user,
    });

    res.status(200).json(profile);
  }),
);

// Submit a suggested edit / reported issue for a section of the scholar's own
// profile. Stored in scholar_suggestions, categorized by professor + community.
router.post(
  "/suggestions",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = req.body || {};

    const suggestion = await createSuggestion({
      user: req.auth.user,
      communities: communityScopeFromAuth(req),
      sectionKey: body.sectionKey,
      fieldLabel: body.fieldLabel,
      currentText: body.currentText,
      message: body.message,
      kind: body.kind,
      community: body.community,
    });

    res.status(201).json({ suggestion });
  }),
);

// List the authenticated scholar's own suggestions (for pending state / dedupe).
router.get(
  "/suggestions",
  requireAuth,
  asyncHandler(async (req, res) => {
    const suggestions = await listSuggestionsForScholar({
      user: req.auth.user,
      sectionKey: req.query.section,
    });

    res.status(200).json({ suggestions });
  }),
);

module.exports = router;
