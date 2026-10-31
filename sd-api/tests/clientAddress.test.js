/**
 * Who is calling, by address.
 *
 * What must hold: the address is the X-Forwarded-For entry our own proxies
 * appended — the last one behind Cloud Run's single front end — so nothing a
 * caller writes at the front of the header changes it, and so nothing a caller
 * writes there buys a fresh rate-limit budget or lands in a session record.
 * The hop count is the deployment's to set, and Express's own `req.ip`, set
 * from the same number, gives the same answer on a real request.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

/* Nothing here connects; the service's settings need the setting to load. */
process.env.MONGODB_URI ||= "mongodb://localhost:27017/client-address-test";
process.env.MONGODB_DB ||= "client-address-test";

const express = require("express");

const { env } = require("../src/config/env");
const { clientAddress, accountKey } = require("../src/lib/clientAddress");
const { callerKey } = require("../src/middleware/rate-limit.middleware");
const { getRequestMetadata } = require("../src/middleware/auth.middleware");

const GFE = "169.254.1.1";
const req = (forwarded, extra = {}) => ({
  socket: { remoteAddress: GFE },
  headers: forwarded === undefined ? {} : { "x-forwarded-for": forwarded },
  get: () => undefined,
  ...extra,
});

test("one trusted proxy is the default", () => {
  assert.equal(env.trustProxyHops, 1);
});

test("behind one proxy, the last forwarded entry is the client", () => {
  assert.equal(clientAddress(req("203.0.113.9")), "203.0.113.9");
  assert.equal(clientAddress(req("203.0.113.9"), 1), "203.0.113.9");
});

test("a spoofed leading entry does not change the address", () => {
  for (const spoofed of [
    "1.1.1.1, 203.0.113.9",
    "10.0.0.1,203.0.113.9",
    "  127.0.0.1 ,  8.8.8.8 , 203.0.113.9 ",
    "not-an-address, 203.0.113.9",
    ", , 203.0.113.9",
  ]) {
    assert.equal(clientAddress(req(spoofed)), "203.0.113.9", spoofed);
  }
});

test("the header as an array of lines reads as one list", () => {
  assert.equal(clientAddress(req(["1.1.1.1", "203.0.113.9"])), "203.0.113.9");
});

test("with no forwarded header the socket's peer is the client", () => {
  assert.equal(clientAddress(req(undefined)), GFE);
  assert.equal(clientAddress(req("")), GFE);
});

test("the hop count is the deployment's: two proxies take the second entry from the end", () => {
  // An external load balancer ahead of Cloud Run appends the client, then the
  // front end appends the load balancer.
  assert.equal(clientAddress(req("1.1.1.1, 203.0.113.9, 35.191.0.1"), 2), "203.0.113.9");
  assert.equal(clientAddress(req("203.0.113.9, 35.191.0.1"), 2), "203.0.113.9");
});

test("zero trusted proxies believes no header at all", () => {
  assert.equal(clientAddress(req("1.1.1.1, 203.0.113.9"), 0), GFE);
});

test("a chain shorter than the hop count gives the furthest address there is", () => {
  assert.equal(clientAddress(req("203.0.113.9"), 3), "203.0.113.9");
  assert.equal(clientAddress(req(undefined), 2), GFE);
});

test("a stand-in request with no socket answers with its own ip", () => {
  assert.equal(clientAddress({ ip: "10.0.0.7", headers: { "x-forwarded-for": "1.1.1.1" } }), "10.0.0.7");
  assert.equal(clientAddress({ headers: {} }), "unknown");
});

test("the limiter's key ignores a spoofed entry, and a session outranks the address", () => {
  const keys = ["203.0.113.9", "1.1.1.1, 203.0.113.9", "9.9.9.9, 8.8.8.8, 203.0.113.9"].map((f) => callerKey(req(f)));
  assert.deepEqual(new Set(keys), new Set(["203.0.113.9"]));
  const signedIn = req("1.1.1.1, 203.0.113.9", { auth: { user: { profile_id: "scholar-a" } } });
  assert.equal(accountKey(signedIn), "scholar-a");
  assert.equal(callerKey(signedIn), "account:scholar-a");
  assert.equal(callerKey(signedIn, () => "custom"), "account:custom", "a route's own key still wins");
  assert.equal(callerKey(signedIn, () => null), "203.0.113.9", "a key the route cannot give falls back to the address");
});

test("the address recorded on a session is the same one", () => {
  assert.equal(getRequestMetadata(req("1.1.1.1, 203.0.113.9")).ipAddress, "203.0.113.9");
});

test("on a real request, Express's req.ip under the same hop count agrees", async () => {
  for (const hops of [0, 1, 2]) {
    const app = express();
    app.set("trust proxy", hops);
    app.get("/", (r, res) => res.json({ ip: r.ip, ours: clientAddress(r, hops), key: hops === env.trustProxyHops ? callerKey(r) : null }));
    const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
    try {
      const base = `http://127.0.0.1:${server.address().port}/`;
      for (const forwarded of [null, "203.0.113.9", "1.1.1.1, 203.0.113.9", "1.1.1.1, 203.0.113.9, 35.191.0.1"]) {
        const res = await fetch(base, { headers: forwarded ? { "x-forwarded-for": forwarded } : {} });
        const body = await res.json();
        assert.equal(body.ours, body.ip, `hops ${hops}, forwarded ${forwarded}`);
        if (hops === 1 && forwarded) assert.equal(body.ours, forwarded.split(",").pop().trim(), "one proxy: the last entry");
        if (hops === 0) assert.match(body.ours, /127\.0\.0\.1/, "no proxy: the socket");
      }
      if (hops === env.trustProxyHops) {
        const keys = [];
        for (const spoofed of ["203.0.113.9", "1.1.1.1, 203.0.113.9", "5.5.5.5, 203.0.113.9"]) {
          keys.push((await (await fetch(base, { headers: { "x-forwarded-for": spoofed } })).json()).key);
        }
        assert.deepEqual(keys, ["203.0.113.9", "203.0.113.9", "203.0.113.9"], "one caller, one key, whatever it writes first");
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
});
