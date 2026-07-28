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

const router = express.Router();

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
