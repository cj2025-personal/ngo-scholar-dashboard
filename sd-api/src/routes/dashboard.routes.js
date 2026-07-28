const express = require("express");

const { asyncHandler } = require("../lib/async-handler");
const { requireAuth } = require("../middleware/auth.middleware");
const { getDashboardData } = require("../services/dashboard.service");

const router = express.Router();

router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const dashboard = await getDashboardData({
      scholarId: req.auth.user.scholar_id,
      profileId: req.auth.user.profile_id,
      user: req.auth.user,
    });

    res.status(200).json(dashboard);
  }),
);

module.exports = router;
