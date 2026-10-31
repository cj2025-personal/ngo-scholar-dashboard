"use strict";

/**
 * Who is calling, by address — decided here and nowhere else.
 *
 * ── Why not the first X-Forwarded-For entry ────────────────────────────────
 * X-Forwarded-For is a list that each proxy appends to. Whatever the caller
 * put in the header arrives at the front of that list untouched, so the first
 * entry is whatever the caller chose to write there. A rate limit keyed on it
 * gives anyone a fresh budget per request: send a different made-up address
 * each time. That is how the limits here could be walked around.
 *
 * ── The entry that can be believed ─────────────────────────────────────────
 * Only what our own proxies appended. On Cloud Run there is exactly one:
 * Google's front end appends the address it accepted the connection from, so
 * the LAST entry is the real client, whatever the caller wrote before it. With
 * N trusted proxies in front (an external load balancer ahead of Cloud Run is
 * two), the client is the Nth entry from the end — the same rule Express
 * applies for `trust proxy` = N, counting the socket's peer as the first hop.
 *
 * TRUST_PROXY_HOPS sets N; unset, it is 1. The app's `trust proxy` is set from
 * the same number (see index.js), so `req.ip` and this helper agree. 0 trusts
 * no proxy at all and answers with the socket's peer.
 */

const { env } = require("../config/env");
const { canonicalScholarId } = require("./identity");

/** The X-Forwarded-For entries, in the order the proxies appended them. */
function forwardedFor(headers) {
  const raw = headers?.["x-forwarded-for"];
  const joined = Array.isArray(raw) ? raw.join(",") : typeof raw === "string" ? raw : "";
  return joined.split(",").map((entry) => entry.trim()).filter(Boolean);
}

/**
 * The caller's address, taking the hop that exactly `hops` trusted proxies
 * vouch for.
 *
 * @param {object} req      an Express request (or anything with headers and a socket)
 * @param {number} [hops]   trusted proxies in front of this service; TRUST_PROXY_HOPS by default
 * @returns {string}        an address, or "unknown" when there is none to read
 */
function clientAddress(req, hops = env.trustProxyHops) {
  const peer = req?.socket?.remoteAddress || req?.connection?.remoteAddress || null;
  /* A request with no socket is a test's stand-in; what it calls `ip` is the
     answer it wants, already resolved. */
  if (!peer) return req?.ip || "unknown";
  /* Nearest first: the peer, then each X-Forwarded-For entry from the right.
     The first `hops` of those are our proxies; the next one is the client.
     When the list is shorter than that, the furthest address is all there is. */
  const chain = [peer, ...forwardedFor(req.headers).reverse()];
  const trusted = Number.isInteger(hops) && hops > 0 ? hops : 0;
  return chain[Math.min(trusted, chain.length - 1)];
}

/** The signed-in scholar, when the request carries a session; null otherwise. */
function accountKey(req) {
  return canonicalScholarId(req?.auth?.user);
}

module.exports = { clientAddress, accountKey, forwardedFor };
