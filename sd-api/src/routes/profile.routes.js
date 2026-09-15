const express = require("express");

const { asyncHandler } = require("../lib/async-handler");
const {
  requireAuth,
  communityScopeFromAuth,
} = require("../middleware/auth.middleware");
const { getScholarProfileData } = require("../services/profile.service");
const { acceptAiTerms } = require("../services/aiTerms.service");
const {
  createSuggestion,
  listSuggestionsForScholar,
  withdrawSuggestion,
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

/**
 * A scholar changing their mind before anyone has acted.
 *
 * Scoped to the session, never to a parameter: the service refuses a request
 * that is not this scholar's, and reports it as absent rather than forbidden so
 * a guessed id cannot confirm that someone else's correction exists.
 */
router.post(
  "/suggestions/:suggestionId/withdraw",
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await withdrawSuggestion({
      suggestionId: req.params.suggestionId,
      user: req.auth.user,
    });
    res.status(200).json(result);
  }),
);

/**
 * The agent's terms, agreed to. The body carries the version the sheet
 * showed; the service refuses a stale one. Scoped to the session, keyed the
 * way the profile read is.
 */
router.post(
  "/ai-terms/accept",
  requireAuth,
  asyncHandler(async (req, res) => {
    const aiTerms = await acceptAiTerms({
      profileId: req.auth.user.profile_id || req.auth.user.scholar_id,
      version: req.body?.version,
    });
    res.status(200).json({ aiTerms });
  }),
);

module.exports = router;
