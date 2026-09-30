"use strict";

/**
 * Who a reader is, without knowing who they are.
 *
 * ── The shape ───────────────────────────────────────────────────────────────
 * A reader of a published story has no account here. The companion still
 * needs to tell one reader from the next: to cap how much each can ask in
 * a day, and to show each their own questions and nothing else's. So the
 * first question mints a random id, signs it, and hands it back as a cookie.
 * Every later request presents it; a bad signature is a stranger.
 *
 * ── What is stored ──────────────────────────────────────────────────────────
 * Not the id. A keyed hash of it. The database can list what one key asked,
 * and cannot be turned back into a cookie that impersonates that reader, and
 * neither the id nor the hash says anything about a person: no address, no
 * agent string, no name. "Forget me" deletes every row under the key and
 * rotates the cookie, so the same device is a new reader afterwards.
 *
 * Pure: the secret is passed in, the clock is not consulted.
 */

const crypto = require("crypto");

const ID_BYTES = 18;
const SIG_BYTES = 16;

function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

/** A fresh, unsigned reader id. */
function mint() {
  return b64url(crypto.randomBytes(ID_BYTES));
}

function signatureOf(id, secret) {
  return crypto.createHmac("sha256", String(secret)).update(`reader|${id}`).digest().subarray(0, SIG_BYTES);
}

/** The cookie value: id, a dot, and a truncated HMAC of the id. */
function sign(id, secret) {
  return `${id}.${b64url(signatureOf(id, secret))}`;
}

/**
 * The id inside a cookie value, or null when it is malformed or forged.
 * Constant-time on the signature, so a guess learns nothing from timing.
 */
function parse(value, secret) {
  if (typeof value !== "string") return null;
  const dot = value.indexOf(".");
  if (dot <= 0 || dot === value.length - 1) return null;
  const id = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(id) || !/^[A-Za-z0-9_-]{8,64}$/.test(sig)) return null;
  const expected = signatureOf(id, secret);
  let given;
  try {
    given = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  if (given.length !== expected.length) return null;
  return crypto.timingSafeEqual(given, expected) ? id : null;
}

/** The only form of the id that is ever written to the database. */
function keyFor(id, secret) {
  return crypto.createHmac("sha256", String(secret)).update(`reader-key|${id}`).digest("hex").slice(0, 40);
}

module.exports = { mint, sign, parse, keyFor };
