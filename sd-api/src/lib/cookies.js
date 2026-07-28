const { env } = require("../config/env");

function getAuthCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProduction,
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
