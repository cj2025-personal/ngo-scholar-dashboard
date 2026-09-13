const { env } = require("../config/env");

function getAuthCookieOptions() {
  return {
    httpOnly: true,
    /* `lax` is correct in both environments. Dev is same-site (every localhost
       port shares one site), and production subdomains are same-site under one
       registrable domain. Only genuinely different domains would need `none`,
       which is a deployment shape to avoid rather than a setting to change. */
    sameSite: "lax",
    secure: env.isProduction,
    /* Unset in development, where the cookie is host-only on `localhost` and is
       therefore already shared across ports — cookies are not isolated by port.
       Set at deploy (`.archivyn.example`) so the scholar portal and the student
       dashboard on sibling subdomains see the same session.

       Config, not a code path: development and production authenticate through
       exactly the same branch, so this is not first exercised in production. */
    ...(env.authCookieDomain ? { domain: env.authCookieDomain } : {}),
    path: "/",
    maxAge: env.authSessionTtlMs,
  };
}

function setAuthCookie(res, token) {
  res.cookie(env.authCookieName, token, getAuthCookieOptions());
}

function clearAuthCookie(res) {
  res.clearCookie(env.authCookieName, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProduction,
    path: "/",
  });
}

module.exports = {
  clearAuthCookie,
  getAuthCookieOptions,
  setAuthCookie,
};
