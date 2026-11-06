/**
 * A scholar's signed impact record (services/impact.service).
 *
 *   GET    /api/impact                    the scholar's own record, signed now
 *   GET    /api/impact/shares             their share links (never the tokens)
 *   POST   /api/impact/shares             { label? } a new link; its token is returned once
 *   DELETE /api/impact/shares/:shareId    turn a link off
 *   GET    /api/impact/shared/:token      public: the record behind a live link
 *   POST   /api/impact/verify             public: { record, signature } checked against this deployment's key
 */
const express = require("express");

const { asyncHandler } = require("../lib/async-handler");
const { requireAuth } = require("../middleware/auth.middleware");
const { rateLimit } = require("../middleware/rate-limit.middleware");
const { getDb } = require("../db/mongo");
const impact = require("../services/impact.service");

const router = express.Router();

/* Public, so bounded: a link is opened by people, not crawled. */
const publicLimiter = rateLimit({ name: "impact-public", limit: 60, windowMs: 10 * 60 * 1000 });

router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.status(200).json(await impact.buildImpactRecord(await getDb(), req.auth.user.profile_id));
  }),
);

router.get(
  "/shares",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.status(200).json({ shares: await impact.listShares(await getDb(), req.auth.user.profile_id) });
  }),
);

router.post(
  "/shares",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.status(201).json(await impact.createShare(await getDb(), req.auth.user.profile_id, req.body?.label));
  }),
);

router.delete(
  "/shares/:shareId",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.status(200).json({ share: await impact.revokeShare(await getDb(), req.auth.user.profile_id, String(req.params.shareId || "")) });
  }),
);

router.get(
  "/shared/:token",
  publicLimiter,
  asyncHandler(async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.status(200).json(await impact.sharedRecord(await getDb(), String(req.params.token || "")));
  }),
);

router.post(
  "/verify",
  publicLimiter,
  asyncHandler(async (req, res) => {
    res.status(200).json(impact.verifyRecord({ record: req.body?.record, signature: req.body?.signature }));
  }),
);

module.exports = router;
