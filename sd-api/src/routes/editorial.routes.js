const express = require("express");
const multer = require("multer");

const { asyncHandler } = require("../lib/async-handler");
const { ApiError } = require("../lib/api-error");
const { requireAuth } = require("../middleware/auth.middleware");
const {
  createEditorialStory,
  getEditorialStory,
  getPublishedStoryBySlug,
  listEditorialStories,
  streamEditorialImage,
  streamPublishedEditorialImage,
  updateEditorialStory,
} = require("../services/editorial.service");
const { askStoryAgent, listStoryTurns, resolveStoryTurn, streamProposalImage, storyPassages, publicStoryPassages } = require("../services/storyAgent.service");
const { rateLimit } = require("../middleware/rate-limit.middleware");

const router = express.Router();

/* Each instruction is a tool-calling loop of several model calls. */
const agentLimiter = rateLimit({ name: "story-agent", limit: 30, windowMs: 10 * 60 * 1000 });

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 16,
  },
  fileFilter(req, file, callback) {
    if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype)) {
      callback(
        new ApiError(
          400,
          "Only JPG, PNG, WEBP, AVIF, and GIF images are supported.",
        ),
      );
      return;
    }

    callback(null, true);
  },
});

const storyUpload = upload.fields([
  { name: "coverImage", maxCount: 1 },
  { name: "inlineImages", maxCount: 15 },
]);

router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await listEditorialStories({
      scholarId: req.auth.user.scholar_id,
      profileId: req.auth.user.profile_id,
      status: req.query.status || "all",
    });

    res.status(200).json(result);
  }),
);

router.get(
  "/public/slug/:slug",
  asyncHandler(async (req, res) => {
    const result = await getPublishedStoryBySlug(req.params.slug);

    res.status(200).json(result);
  }),
);

router.get(
  "/public/images/:fileId",
  asyncHandler(async (req, res) => {
    await streamPublishedEditorialImage({
      fileId: req.params.fileId,
      res,
    });
  }),
);

router.get(
  "/:storyId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await getEditorialStory({
      storyId: req.params.storyId,
      scholarId: req.auth.user.scholar_id,
      profileId: req.auth.user.profile_id,
    });

    res.status(200).json(result);
  }),
);

router.post(
  "/",
  requireAuth,
  storyUpload,
  asyncHandler(async (req, res) => {
    const result = await createEditorialStory({
      scholarId: req.auth.user.scholar_id,
      profileId: req.auth.user.profile_id,
      user: req.auth.user,
      body: req.body || {},
      files: req.files || {},
    });

    res.status(201).json(result);
  }),
);

router.patch(
  "/:storyId",
  requireAuth,
  storyUpload,
  asyncHandler(async (req, res) => {
    const result = await updateEditorialStory({
      storyId: req.params.storyId,
      scholarId: req.auth.user.scholar_id,
      profileId: req.auth.user.profile_id,
      user: req.auth.user,
      body: req.body || {},
      files: req.files || {},
    });

    res.status(200).json(result);
  }),
);

/* ── passages behind a story ─────────────────────────────────────────────── */

/** Public: the passages a published story's chips point at, for the Sources toggle. */
router.get(
  "/public/slug/:slug/passages",
  asyncHandler(async (req, res) => {
    res.status(200).json(await publicStoryPassages({ slug: req.params.slug }));
  }),
);

/** The scholar's: the same passages, for the source rail in the workspace. */
router.get(
  "/:storyId/passages",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.status(200).json(await storyPassages({ storyId: req.params.storyId, scholarId: req.auth.user.scholar_id, profileId: req.auth.user.profile_id }));
  }),
);

/* ── the story agent ─────────────────────────────────────────────────────── */

/**
 * Tell the agent what to change. Returns a proposal: the summary, the
 * changes block by block, and the checks on what it wrote. The stored story
 * is untouched until the proposal is accepted.
 */
router.post(
  "/:storyId/agent",
  requireAuth,
  agentLimiter,
  asyncHandler(async (req, res) => {
    const instruction = typeof req.body?.instruction === "string" ? req.body.instruction.trim() : "";
    if (!instruction) throw new ApiError(400, "Say what you'd like changed.");
    if (instruction.length > 2000) throw new ApiError(400, "Keep an instruction under 2,000 characters.");
    const result = await askStoryAgent({
      storyId: req.params.storyId,
      scholarId: req.auth.user.scholar_id,
      profileId: req.auth.user.profile_id,
      user: req.auth.user,
      instruction,
    });
    res.status(200).json(result);
  }),
);

router.get(
  "/:storyId/agent/turns",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.status(200).json(await listStoryTurns({ storyId: req.params.storyId, scholarId: req.auth.user.scholar_id, profileId: req.auth.user.profile_id }));
  }),
);

/** Preview an illustration a proposal generated, before it is accepted into the story. */
router.get(
  "/:storyId/agent/turns/:turnId/images/:fileId",
  requireAuth,
  asyncHandler(async (req, res) => {
    await streamProposalImage({
      storyId: req.params.storyId, turnId: req.params.turnId, fileId: req.params.fileId,
      scholarId: req.auth.user.scholar_id, profileId: req.auth.user.profile_id, res,
    });
  }),
);

/** Accept or reject a proposal. Accept applies it to the story; reject discards it and any image it generated. */
router.post(
  "/:storyId/agent/turns/:turnId/:action",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { action } = req.params;
    if (action !== "accept" && action !== "reject") throw new ApiError(400, "Action must be accept or reject.");
    const result = await resolveStoryTurn({
      storyId: req.params.storyId,
      turnId: req.params.turnId,
      scholarId: req.auth.user.scholar_id,
      profileId: req.auth.user.profile_id,
      user: req.auth.user,
      action,
    });
    res.status(200).json(result);
  }),
);

router.get(
  "/images/:fileId",
  requireAuth,
  asyncHandler(async (req, res) => {
    await streamEditorialImage({
      fileId: req.params.fileId,
      scholarId: req.auth.user.scholar_id,
      profileId: req.auth.user.profile_id,
      res,
    });
  }),
);

module.exports = router;
