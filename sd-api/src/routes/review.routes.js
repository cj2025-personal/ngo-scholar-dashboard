const express = require("express");

const { asyncHandler } = require("../lib/async-handler");
const { ApiError } = require("../lib/api-error");
const { env } = require("../config/env");
const { secretsMatch, readServiceToken, SERVICE_NAME_HEADER } = require("../lib/service-auth");
const { STATUS } = require("../lib/corrections");
const {
  listSuggestionsForReview,
  decideSuggestion,
} = require("../services/suggestion.service");

const router = express.Router();

/**
 * The correction review queue, for the admin portal.
 *
 * ── Service-to-service, because the admins live elsewhere ──────────────────
 * This service has no admin accounts — approvals happen in the separate admin
 * portal, which holds the shared secret. `decidedBy` is passed through from the
 * admin's own session there and recorded without being verified, for the same
 * reason invitations work that way: anyone able to forge it already holds the
 * secret. What it buys is the answer to "who declined this?" when a scholar
 * asks, which is an operational question nobody can answer if the field reads
 * only "the admin service".
 */
const requireServiceToken = (req, _res, next) => {
  if (!env.serviceToken) {
    return next(new ApiError(503, "Review is not configured on this deployment (SERVICE_TOKEN unset)."));
  }
  const presented = readServiceToken(req.headers);
  if (!presented || !secretsMatch(presented, env.serviceToken)) {
    return next(new ApiError(401, "Service authentication failed."));
  }
  req.callingService = String(req.headers[SERVICE_NAME_HEADER] || "unknown-service");
  return next();
};

/**
 * Requests awaiting an answer, oldest first.
 *
 * Oldest first is the whole point. A newest-first queue lets the hardest
 * requests — the ones nobody wants to answer — sink out of sight, which turns a
 * right of reply back into a suggestion box.
 */
router.get(
  "/internal/corrections",
  requireServiceToken,
  asyncHandler(async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : STATUS.OPEN;
    const items = await listSuggestionsForReview({ status, limit: req.query.limit });

    res.status(200).json({
      status,
      count: items.length,
      /* The longest anyone has been waiting for an answer about their own
         public record. One number, so it can be alarmed on. */
      longestWaitDays: items.reduce((max, item) => Math.max(max, item.waitingDays ?? 0), 0),
      items,
    });
  }),
);

router.post(
  "/internal/corrections/:suggestionId/decide",
  requireServiceToken,
  asyncHandler(async (req, res) => {
    const to = String(req.body?.status || "").trim();
    const decidedBy = String(req.body?.decidedBy || "").trim();
    /* `admin` decides; `curation` is the only actor allowed to report that the
       curated record actually changed — see lib/corrections.js. */
    const actor = req.body?.actor === "curation" ? "curation" : "admin";

    if (!decidedBy) {
      throw new ApiError(400, "decidedBy is required — a decision must record who made it.");
    }

    const result = await decideSuggestion({
      suggestionId: req.params.suggestionId,
      to,
      actor,
      decidedBy,
      note: req.body?.note ?? null,
    });

    res.status(200).json(result);
  }),
);

module.exports = router;
