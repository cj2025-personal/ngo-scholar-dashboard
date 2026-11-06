"use strict";

/**
 * Learning circles, for the signed-in scholar: a group of readers around the
 * stories they choose to share. The circles live in the learner app
 * (user-dashboard-api, its services/circles), which holds the classes and
 * learners; this service passes the scholar's own requests on, naming them
 * (lib/learnerApi), and holds nothing about any reader.
 *
 *   GET   /api/circles                       the scholar's circles
 *   POST  /api/circles                       { name, purpose, bands, featuredEditorialIds }
 *   GET   /api/circles/:circleId             its classes and how many read each story, never who
 *   PATCH /api/circles/:circleId             { name?, purpose?, bands?, featuredEditorialIds? }
 *   POST  /api/circles/:circleId/archive     { archived }
 *   POST  /api/circles/:circleId/code        { active?, rotate? }
 *   POST  /api/circles/:circleId/placement   { community }: show it in that community's portal
 *   DELETE /api/circles/:circleId/placement  take it out of the portal
 *
 * The learner app checks the scholar owns each circle and each story it
 * features; a circle's name and purpose are read by a model there before any
 * learner sees them, and a model judges whether it belongs in a community's
 * portal from what it is about, never who leads it. Calls that wait on a
 * judge pass JUDGED_CALL_MS.
 */
const express = require("express");

const { asyncHandler } = require("../lib/async-handler");
const { ApiError } = require("../lib/api-error");
const { JUDGED_CALL_MS, callLearnerApi } = require("../lib/learnerApi");
const { requireAuth } = require("../middleware/auth.middleware");

const router = express.Router();
router.use(requireAuth);

const ID = /^[a-f0-9]{24}$/i;
const circlePath = (req) => {
  const id = String(req.params.circleId || "");
  if (!ID.test(id)) throw new ApiError(404, "Not found.");
  return `/circles/${id}`;
};
const profileOf = (req) => req.auth.user.profile_id;

router.get("/", asyncHandler(async (req, res) => {
  res.json(await callLearnerApi("GET", "/circles", { profileId: profileOf(req) }));
}));

router.post("/", asyncHandler(async (req, res) => {
  const { name, purpose, bands, featuredEditorialIds } = req.body || {};
  res.status(201).json(await callLearnerApi("POST", "/circles", { profileId: profileOf(req), body: { name, purpose, bands, featuredEditorialIds }, timeoutMs: JUDGED_CALL_MS }));
}));

router.get("/:circleId", asyncHandler(async (req, res) => {
  res.json(await callLearnerApi("GET", circlePath(req), { profileId: profileOf(req) }));
}));

router.patch("/:circleId", asyncHandler(async (req, res) => {
  const { name, purpose, bands, featuredEditorialIds } = req.body || {};
  res.json(await callLearnerApi("PATCH", circlePath(req), { profileId: profileOf(req), body: { name, purpose, bands, featuredEditorialIds }, timeoutMs: JUDGED_CALL_MS }));
}));

router.post("/:circleId/archive", asyncHandler(async (req, res) => {
  res.json(await callLearnerApi("POST", `${circlePath(req)}/archive`, { profileId: profileOf(req), body: { archived: req.body?.archived } }));
}));

router.post("/:circleId/code", asyncHandler(async (req, res) => {
  res.json(await callLearnerApi("POST", `${circlePath(req)}/code`, { profileId: profileOf(req), body: { active: req.body?.active, rotate: req.body?.rotate } }));
}));

router.post("/:circleId/placement", asyncHandler(async (req, res) => {
  res.json(await callLearnerApi("POST", `${circlePath(req)}/placement`, { profileId: profileOf(req), body: { community: req.body?.community }, timeoutMs: JUDGED_CALL_MS }));
}));

router.delete("/:circleId/placement", asyncHandler(async (req, res) => {
  res.json(await callLearnerApi("DELETE", `${circlePath(req)}/placement`, { profileId: profileOf(req) }));
}));

module.exports = router;
