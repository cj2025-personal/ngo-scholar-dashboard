const { env } = require("../config/env");
const { clearAuthCookie } = require("../lib/cookies");
const { ApiError } = require("../lib/api-error");
const { getAuthenticatedScholarBySessionToken } = require("../services/auth.service");
const { loadLinkedRecords } = require("../services/scholar-context.service");

function getRequestMetadata(req) {
  const forwardedFor = req.headers["x-forwarded-for"];
  const ipAddress = Array.isArray(forwardedFor)
    ? forwardedFor[0]
    : typeof forwardedFor === "string"
      ? forwardedFor.split(",")[0].trim()
      : req.ip;

  return {
    ipAddress,
    userAgent: req.get("user-agent") || "unknown",
  };
}

function attachAuth(req, authContext, sessionToken) {
  req.auth = {
    ...authContext,
    sessionToken,
    loadLinkedRecords: (collectionName, options = {}) =>
      loadLinkedRecords({
        collectionName,
        scholarId: authContext.user.scholar_id,
        profileId: authContext.user.profile_id,
        ...options,
      }),
  };
}

/**
 * Resolve the authenticated scholar from the session cookie.
 * @returns {null} no session cookie
 * @returns {{ sessionToken, authContext: null }} cookie present but session invalid
 * @returns {{ sessionToken, authContext }} authenticated
 */
async function resolveAuthFromRequest(req) {
  const sessionToken = req.cookies?.[env.authCookieName];

  if (!sessionToken) {
    return null;
  }

  const authContext = await getAuthenticatedScholarBySessionToken(
    sessionToken,
    getRequestMetadata(req),
  );

  return { sessionToken, authContext: authContext || null };
}

/** Hard gate — rejects the request unless a valid scholar session is present. */
async function requireAuth(req, res, next) {
  try {
    const resolved = await resolveAuthFromRequest(req);

    if (!resolved) {
      throw new ApiError(401, "Authentication is required.");
    }

    if (!resolved.authContext) {
      clearAuthCookie(res);
      throw new ApiError(401, "Session is invalid or has expired.");
    }

    attachAuth(req, resolved.authContext, resolved.sessionToken);
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Soft gate — attaches req.auth when a valid session exists, otherwise continues
 * anonymously. Use for public routes that personalize when signed in.
 */
async function optionalAuth(req, res, next) {
  try {
    const resolved = await resolveAuthFromRequest(req);
    if (resolved?.authContext) {
      attachAuth(req, resolved.authContext, resolved.sessionToken);
    }
    next();
  } catch (error) {
    next(error);
  }
}

/** The communities the authenticated scholar belongs to (future community layer). */
function communityScopeFromAuth(req) {
  const communities = req.auth?.user?.communities;
  return Array.isArray(communities)
    ? communities.map((value) => String(value).trim().toLowerCase()).filter(Boolean)
    : [];
}

/**
 * Guard a route to scholars in a given community. Foundation for the future
 * community-specific layer (mirrors the user dashboard's community separation).
 * Must run after requireAuth.
 */
function requireCommunity(community) {
  const target = String(community || "").trim().toLowerCase();

  return (req, res, next) => {
    if (!req.auth) {
      return next(new ApiError(401, "Authentication is required."));
    }

    if (target && !communityScopeFromAuth(req).includes(target)) {
      return next(new ApiError(403, "This area is limited to a specific community."));
    }

    return next();
  };
}

module.exports = {
  attachAuth,
  communityScopeFromAuth,
  getRequestMetadata,
  optionalAuth,
  requireAuth,
  requireCommunity,
};
