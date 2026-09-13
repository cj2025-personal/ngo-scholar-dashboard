const express = require("express");

const { asyncHandler } = require("../lib/async-handler");
const { ApiError } = require("../lib/api-error");
const { env } = require("../config/env");
const {
  SERVICE_TOKEN_HEADER,
  SERVICE_NAME_HEADER,
  secretsMatch,
  readServiceToken,
} = require("../lib/service-auth");
const { rateLimit } = require("../middleware/rate-limit.middleware");
const {
  issueInvite,
  describeInvite,
  redeemInvite,
  revokeInvite,
} = require("../services/invite.service");

const router = express.Router();

/**
 * Invitations: how a person becomes the scholar we curated.
 *
 * ── Two audiences, two auth models ─────────────────────────────────────────
 * Issuing is service-to-service — the admin portal, holding a shared secret.
 * Redeeming is by definition unauthenticated: the whole point is that the
 * caller does not have an account yet. That asymmetry is why the public routes
 * carry rate limits and the internal one does not.
 */

/**
 * Only our own services may issue invitations.
 *
 * Fails closed when unconfigured. An absent secret must not mean "allow" — that
 * is how a staging misconfiguration becomes an open endpoint for minting
 * credentials against any scholar on the platform.
 */
const requireServiceToken = (req, _res, next) => {
  if (!env.serviceToken) {
    return next(
      new ApiError(
        503,
        "Invitation issuing is not configured on this deployment (SERVICE_TOKEN unset).",
      ),
    );
  }

  const presented = readServiceToken(req.headers);
  if (!presented || !secretsMatch(presented, env.serviceToken)) {
    /* Deliberately vague. Unlike an invitation token, this secret is long-lived
       and shared, so there is no operator benefit in distinguishing "absent"
       from "wrong" that outweighs telling a prober which they got. */
    return next(new ApiError(401, "Service authentication failed."));
  }

  req.callingService = String(req.headers[SERVICE_NAME_HEADER] || "unknown-service");
  return next();
};

/**
 * Issue an invitation. Admin portal only.
 *
 * The raw token comes back exactly once and is never stored. Delivery is the
 * caller's problem — today an admin copies the link and sends it themselves,
 * because no service on this platform can send email yet. That is a deliberate
 * first step rather than an oversight: the model does not change when an email
 * adapter is added, only who does the sending.
 */
router.post(
  "/internal/invites",
  requireServiceToken,
  asyncHandler(async (req, res) => {
    const profileId = String(req.body?.profileId || "").trim();
    const email = req.body?.email ? String(req.body.email).trim() : null;
    /* The human who approved this, passed through from the admin portal's own
       session. Recorded, not verified — see lib/service-auth.js. */
    const issuedBy = String(req.body?.issuedBy || "").trim();

    if (!issuedBy) {
      throw new ApiError(
        400,
        "issuedBy is required — an invitation must record which admin approved it.",
      );
    }

    const invite = await issueInvite({ profileId, email, issuedBy });

    res.status(201).json({
      inviteId: invite.inviteId,
      profileId: invite.profileId,
      scholarName: invite.scholarName,
      expiresAt: invite.expiresAt,
      /* Shown once. Not recoverable — a system that could re-display this would
         be one where database access yields live invitations. */
      token: invite.token,
      claimPath: `/claim/${invite.token}`,
      issuedBy,
      issuedVia: req.callingService,
    });
  }),
);

router.post(
  "/internal/invites/:inviteId/revoke",
  requireServiceToken,
  asyncHandler(async (req, res) => {
    const result = await revokeInvite({
      inviteId: req.params.inviteId,
      revokedBy: String(req.body?.revokedBy || req.callingService),
      reason: req.body?.reason || "revoked",
    });
    res.status(200).json(result);
  }),
);

/**
 * "Is this you?" — what an invitation is for, without spending it.
 *
 * A person should see whose record they are about to take control of before
 * they set a password, not after. Returns the scholar's public display name
 * only: an unredeemed invitation must never be a way to read private data about
 * a scholar.
 */
router.get(
  "/invites/:token",
  rateLimit({ name: "invite-describe", limit: 30, windowMs: 60_000 }),
  asyncHandler(async (req, res) => {
    const result = await describeInvite({ token: req.params.token });

    if (!result.ok) {
      return res.status(result.reason === "already_redeemed" ? 409 : 400).json({
        ok: false,
        reason: result.reason,
        message: result.message,
      });
    }

    return res.status(200).json(result);
  }),
);

/**
 * Redeem an invitation and create the scholar's credentials.
 *
 * Limited tightly. Argon2 is deliberately expensive, so an unauthenticated
 * endpoint that runs it on demand is a denial-of-service lever regardless of
 * how unguessable the token is.
 */
router.post(
  "/invites/:token/redeem",
  rateLimit({ name: "invite-redeem", limit: 10, windowMs: 60_000 }),
  asyncHandler(async (req, res) => {
    const password = req.body?.password;
    if (typeof password !== "string" || !password) {
      throw new ApiError(400, "Choose a password to finish setting up your account.");
    }

    const result = await redeemInvite({
      token: req.params.token,
      password,
      email: req.body?.email ? String(req.body.email).trim() : null,
      metadata: {
        ipAddress: req.ip,
        userAgent: req.get("user-agent") || "unknown",
      },
    });

    /* No session is created here. Redemption and sign-in stay separate so that
       the first thing a scholar does with their new password is use it — which
       is also what proves it was stored as they typed it. */
    res.status(201).json({
      ...result,
      message: "Your account is ready. Sign in with the password you just chose.",
    });
  }),
);

module.exports = router;
