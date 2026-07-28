const express = require("express");

const { env } = require("../config/env");
const { asyncHandler } = require("../lib/async-handler");
const { clearAuthCookie, setAuthCookie } = require("../lib/cookies");
const { ApiError } = require("../lib/api-error");
const { getRequestMetadata, requireAuth } = require("../middleware/auth.middleware");
const {
  changePassword,
  loginScholar,
  logoutScholar,
} = require("../services/auth.service");

const router = express.Router();

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};

    const result = await loginScholar({
      email,
      password,
      ...getRequestMetadata(req),
    });

    setAuthCookie(res, result.sessionToken);

    res.status(200).json({
      user: result.user,
      session: result.session,
      related: result.related,
    });
  }),
);

router.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const sessionToken = req.cookies?.[env.authCookieName];

    if (sessionToken) {
      await logoutScholar(sessionToken);
    }

    clearAuthCookie(res);

    res.status(200).json({ success: true });
  }),
);

router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.status(200).json({
      authenticated: true,
      user: req.auth.user,
      session: req.auth.session,
      related: req.auth.related,
    });
  }),
);

router.get(
  "/me/linked/:collectionName",
  requireAuth,
  asyncHandler(async (req, res) => {
    const mode = req.query.mode === "one" ? "one" : "many";
    const limit = req.query.limit ? Number(req.query.limit) : undefined;

    if (limit !== undefined && Number.isNaN(limit)) {
      throw new ApiError(400, "limit must be a valid number.");
    }

    const records = await req.auth.loadLinkedRecords(req.params.collectionName, {
      mode,
      limit,
    });

    res.status(200).json({
      collection: req.params.collectionName,
      data: records,
    });
  }),
);

router.post(
  "/change-password",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword, confirmPassword } = req.body || {};

    if (confirmPassword !== undefined && newPassword !== confirmPassword) {
      throw new ApiError(400, "Password confirmation does not match.");
    }

    const result = await changePassword({
      scholarId: req.auth.user.scholar_id,
      profileId: req.auth.user.profile_id,
      currentPassword,
      newPassword,
      ...getRequestMetadata(req),
    });

    setAuthCookie(res, result.sessionToken);

    res.status(200).json({
      message: "Password updated successfully.",
      user: result.user,
      session: result.session,
      related: result.related,
    });
  }),
);

module.exports = router;
