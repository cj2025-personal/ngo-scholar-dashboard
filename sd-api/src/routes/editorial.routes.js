const express = require("express");
const multer = require("multer");

const { asyncHandler } = require("../lib/async-handler");
const { ApiError } = require("../lib/api-error");
const { requireAuth } = require("../middleware/auth.middleware");
const {
  createEditorialStory,
  deleteEditorialStory,
  getEditorialStory,
  listStoryRevisions,
  restoreStoryRevision,
  getPublishedStoryBySlug,
  listEditorialStories,
  streamEditorialImage,
  streamPublishedEditorialImage,
  updateEditorialStory,
} = require("../services/editorial.service");
const { askStoryAgent, listStoryTurns, resolveStoryTurn, streamProposalImage, storyPassages, publicStoryPassages } = require("../services/storyAgent.service");
const evidence = require("../services/evidence.service");
const { generateLevels, approveLevels, discardLevels } = require("../services/levels.service");
const recordService = require("../services/record.service");
const { recheckBlock } = require("../services/recheck.service");
const { recordStoryRead } = require("../services/reads.service");
const { env } = require("../config/env");
const { readServiceToken, secretsMatch } = require("../lib/service-auth");
const { getDb } = require("../db/mongo");
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

/** Delete a story: the owner only, and it is gone from every read at once. */
router.delete(
  "/:storyId",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.status(200).json(await deleteEditorialStory({
      storyId: req.params.storyId,
      scholarId: req.auth.user.scholar_id,
      profileId: req.auth.user.profile_id,
      user: req.auth.user,
    }));
  }),
);

/* ── versions ────────────────────────────────────────────────────────────── */

/** The story's history: what changed, when, and by whom. */
router.get(
  "/:storyId/revisions",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.status(200).json(await listStoryRevisions({
      storyId: req.params.storyId,
      scholarId: req.auth.user.scholar_id,
      profileId: req.auth.user.profile_id,
      limit: req.query.limit,
    }));
  }),
);

/** Put an earlier version back, as a new version. History is never rewritten. */
router.post(
  "/:storyId/revisions/:version/restore",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.status(200).json(await restoreStoryRevision({
      storyId: req.params.storyId,
      version: req.params.version,
      scholarId: req.auth.user.scholar_id,
      profileId: req.auth.user.profile_id,
      user: req.auth.user,
      baseVersion: req.body?.baseVersion ?? null,
    }));
  }),
);

/* ── the scientific record ───────────────────────────────────────────────── */

/** A scheduler's sweep of every public story. Guarded by RECORD_SWEEP_TOKEN; absent means disabled. */
router.post(
  "/record/sweep",
  asyncHandler(async (req, res) => {
    if (!env.record.enabled) throw new ApiError(503, "Record checks are switched off on this deployment (RECORD_CHECKS=false).");
    if (!env.record.sweepToken) throw new ApiError(503, "The record sweep is not configured on this deployment (RECORD_SWEEP_TOKEN unset).");
    const presented = readServiceToken(req.headers);
    if (!presented || !secretsMatch(presented, env.record.sweepToken)) throw new ApiError(401, "A valid sweep token is required.");
    res.status(200).json(await recordService.sweepPublished({ limit: req.body?.limit }));
  }),
);

/* ── the evidence ledger ─────────────────────────────────────────────────── */

/** The key anyone needs to verify what this deployment signed. */
router.get(
  "/public/evidence/key",
  asyncHandler(async (_req, res) => {
    res.status(200).json(evidence.publicKey());
  }),
);

/** Verify a manifest and signature. Anyone may; the key is public. */
router.post(
  "/public/evidence/verify",
  asyncHandler(async (req, res) => {
    res.status(200).json(evidence.verifyEvidence({ manifest: req.body?.manifest, signature: req.body?.signature }));
  }),
);

/** Public: everything a published story rests on, signed. */
router.get(
  "/public/slug/:slug/evidence",
  asyncHandler(async (req, res) => {
    res.status(200).json(await evidence.getPublicEvidence(await getDb(), req.params.slug));
  }),
);

/** The scholar's own story's ledger, built fresh; a preview until it is public. */
router.get(
  "/:storyId/evidence",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.status(200).json(await evidence.getOwnerEvidence(await getDb(), {
      storyId: req.params.storyId,
      scholarId: req.auth.user.scholar_id,
      profileId: req.auth.user.profile_id,
    }));
  }),
);

/* ── reading levels ──────────────────────────────────────────────────────── */

/** Write the story for other reading ages. A version of the story like any write. */
router.post(
  "/:storyId/levels",
  requireAuth,
  agentLimiter,
  asyncHandler(async (req, res) => {
    res.status(200).json(await generateLevels({
      storyId: req.params.storyId,
      scholarId: req.auth.user.scholar_id,
      profileId: req.auth.user.profile_id,
      user: req.auth.user,
      audiences: Array.isArray(req.body?.audiences) ? req.body.audiences.map(String) : null,
      baseVersion: req.body?.baseVersion ?? null,
    }));
  }),
);

/** Approve levels for readers. Nothing reaches the public without this. */
router.post(
  "/:storyId/levels/approve",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.status(200).json(await approveLevels({
      storyId: req.params.storyId,
      scholarId: req.auth.user.scholar_id,
      profileId: req.auth.user.profile_id,
      user: req.auth.user,
      audiences: Array.isArray(req.body?.audiences) ? req.body.audiences.map(String) : null,
      baseVersion: req.body?.baseVersion ?? null,
    }));
  }),
);

/**
 * Discard reading levels. Named bands, or every band the scholar has not
 * approved. A level that was live for readers stops being shown.
 */
router.post(
  "/:storyId/levels/discard",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.status(200).json(await discardLevels({
      storyId: req.params.storyId,
      scholarId: req.auth.user.scholar_id,
      profileId: req.auth.user.profile_id,
      user: req.auth.user,
      audiences: Array.isArray(req.body?.audiences) ? req.body.audiences.map(String) : null,
      baseVersion: req.body?.baseVersion ?? null,
    }));
  }),
);

/** The scholar asks now whether the record has moved against this story's source. */
router.post(
  "/:storyId/record/check",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!env.record.enabled) throw new ApiError(503, "Record checks are switched off on this deployment.");
    res.status(200).json(await recordService.checkStory({
      storyId: req.params.storyId, scholarId: req.auth.user.scholar_id, profileId: req.auth.user.profile_id,
    }));
  }),
);

/** The scholar rewrote a paragraph and wants the judge's verdict on what it says now. */
router.post(
  "/:storyId/blocks/:index/recheck",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.status(200).json(await recheckBlock({
      storyId: req.params.storyId,
      index: Number(req.params.index),
      scholarId: req.auth.user.scholar_id,
      profileId: req.auth.user.profile_id,
      user: req.auth.user,
      baseVersion: req.body?.baseVersion ?? null,
    }));
  }),
);

/** The scholar has seen the alert. */
router.post(
  "/:storyId/record/acknowledge",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.status(200).json(await recordService.acknowledge({
      storyId: req.params.storyId, scholarId: req.auth.user.scholar_id, profileId: req.auth.user.profile_id,
    }));
  }),
);

/* ── passages behind a story ─────────────────────────────────────────────── */

/**
 * Public: one read of a published story.
 *
 * Called by the reader itself once someone has stayed with the article, not
 * on page load. Always 204: it must not say whether the slug exists, whether
 * the caller was throttled, or whether anything was counted, because each of
 * those answers turns a counter into something to probe with.
 */
router.post(
  "/public/slug/:slug/read",
  /* A ceiling per caller across every story, above the service's own one-per-
     story-per-ten-minutes. Generous enough that a household or a lecture
     theatre behind one address is never turned away. */
  rateLimit({ name: "story-read", limit: 120, windowMs: 10 * 60 * 1000 }),
  asyncHandler(async (req, res) => {
    await recordStoryRead(await getDb(), { slug: req.params.slug, from: req.ip || "" });
    res.status(204).end();
  }),
);

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
