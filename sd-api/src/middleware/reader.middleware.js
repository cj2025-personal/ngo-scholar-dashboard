"use strict";

/**
 * Put a reader on the request.
 *
 * Reads the device cookie; mints and sets one when it is missing or forged.
 * Afterwards `req.reader` is `{ key, fresh, rotate }`: the hashed key every
 * reader row is filed under, whether this request minted it, and a function
 * that mints a new identity for "forget me".
 *
 * The cookie carries the same site and domain attributes as the scholar
 * session, for the same reason: on Cloud Run the API and the reader are
 * different sites, and a cookie set under `lax` there is a cookie the
 * browser will not send back.
 */

const crypto = require("crypto");

const { env } = require("../config/env");
const identity = require("../lib/readerIdentity");

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

let processSecret = null;
function secret() {
  if (env.reader.cookieSecret) return env.reader.cookieSecret;
  if (!processSecret) {
    processSecret = crypto.randomBytes(32).toString("hex");
    if (env.isProduction) console.warn("[reader] READER_COOKIE_SECRET is unset; reader identities will not survive a restart.");
  }
  return processSecret;
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: env.authCookieSameSite,
    secure: env.isProduction || env.authCookieSameSite === "none",
    ...(env.authCookieDomain ? { domain: env.authCookieDomain } : {}),
    path: "/",
    maxAge: ONE_YEAR_MS,
  };
}

function issue(res) {
  const id = identity.mint();
  res.cookie(env.reader.cookieName, identity.sign(id, secret()), cookieOptions());
  return id;
}

function readerIdentity(req, res, next) {
  const s = secret();
  let id = identity.parse(req.cookies?.[env.reader.cookieName], s);
  const fresh = !id;
  if (!id) id = issue(res);
  req.reader = {
    key: identity.keyFor(id, s),
    fresh,
    rotate() {
      const next = issue(res);
      req.reader.key = identity.keyFor(next, s);
      return req.reader.key;
    },
  };
  next();
}

module.exports = { readerIdentity };
