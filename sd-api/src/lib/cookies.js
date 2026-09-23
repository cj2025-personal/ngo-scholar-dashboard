const { env } = require("../config/env");

function getAuthCookieOptions() {
  return {
    httpOnly: true,
    /* `lax` where the portal and the API share a registrable domain, `none`
       where they do not.

       The note that used to sit here said a cross-domain split was "a
       deployment shape to avoid rather than a setting to change". Cloud Run is
       that shape: every service gets its own `*.run.app` hostname, and those
       are separate sites for cookie purposes — ngo-web-auth in this same
       estate runs COOKIE_SAMESITE=None for exactly this reason. Under `lax`
       the browser accepts the cookie at sign-in and then declines to send it
       with the portal's own fetches, so signing in appears to work and every
       request after it is anonymous.

       Still `lax` by default, so localhost and any same-domain deployment keep
       the stronger setting and nothing changes for them. `none` is opt-in per
       deployment, and it requires Secure — the browser refuses the pair
       otherwise, which would take the cookie away entirely. */
    sameSite: env.authCookieSameSite,
    secure: env.isProduction || env.authCookieSameSite === "none",
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
  /* The same attributes the cookie was set with. A browser matches a clear
     against name, domain and path, and a mismatched SameSite leaves the
     original in place — the scholar would press sign out and stay signed in. */
  res.clearCookie(env.authCookieName, {
    httpOnly: true,
    sameSite: env.authCookieSameSite,
    secure: env.isProduction || env.authCookieSameSite === "none",
    ...(env.authCookieDomain ? { domain: env.authCookieDomain } : {}),
    path: "/",
  });
}

module.exports = {
  clearAuthCookie,
  getAuthCookieOptions,
  setAuthCookie,
};
