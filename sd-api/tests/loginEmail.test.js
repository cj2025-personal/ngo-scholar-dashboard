/**
 * One login-address rule, shared with the documents portal.
 *
 * The failure this file exists to prevent is the one that already happened:
 * the same credentials table, two issuers, two conventions — so which
 * invitation a scholar received decided which portal they could enter.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const { CANONICAL_DOMAIN, canonicalLoginEmail, loginEmailCandidates, isCanonicalLoginEmail } =
  require("../src/lib/loginEmail");

/* The exact inputs the two conventions disagreed on, plus the awkward ones a
   normaliser has to get right. Shared with the contract test below. */
const FIXTURE = [
  "inder.gupta.461a3ea7@scholars.archivyn.com",
  "shelly.anderson.0001d6a6@scholars.archivyn.com",
  "craig.johnson@archivyn.com",
  "  Craig.Johnson@ARCHIVYN.COM  ",
  "craig.johnson",
  "José Ñúñez",
  "a__b--c..d",
  "..leading.and.trailing..",
  "@archivyn.com",
  "",
  "   ",
  "名前@example.com",
  "first last@anything.example",
];

test("the two existing sd-api addresses map onto the portal's convention", () => {
  assert.equal(canonicalLoginEmail("inder.gupta.461a3ea7@scholars.archivyn.com"), "inder.gupta.461a3ea7@archivyn.com");
  assert.equal(canonicalLoginEmail("shelly.anderson.0001d6a6@scholars.archivyn.com"), "shelly.anderson.0001d6a6@archivyn.com");
  // And an address already on the convention is a fixed point.
  assert.equal(canonicalLoginEmail("craig.johnson@archivyn.com"), "craig.johnson@archivyn.com");
  assert.equal(isCanonicalLoginEmail("craig.johnson@archivyn.com"), true);
  assert.equal(isCanonicalLoginEmail("inder.gupta.461a3ea7@scholars.archivyn.com"), false);
});

test("the domain is not configurable", () => {
  // Configurability is how it diverged the first time.
  assert.equal(CANONICAL_DOMAIN, "archivyn.com");
  assert.equal(canonicalLoginEmail("x@anything.example"), "x@archivyn.com");
});

test("case, whitespace and non-ASCII are folded the way the portal folds them", () => {
  assert.equal(canonicalLoginEmail("  Craig.Johnson@ARCHIVYN.COM  "), "craig.johnson@archivyn.com");
  assert.equal(canonicalLoginEmail("José Ñúñez"), "jose.nunez@archivyn.com");
  assert.equal(canonicalLoginEmail("a__b--c..d"), "a__b--c.d@archivyn.com");
  assert.equal(canonicalLoginEmail("..leading.and.trailing.."), "leading.and.trailing@archivyn.com");
  assert.equal(canonicalLoginEmail("first last@anything.example"), "first.last@archivyn.com");
});

test("nothing survives, nothing is issued", () => {
  // Never a bare "@archivyn.com": that would be a valid-looking login for nobody.
  for (const v of ["", "   ", "@archivyn.com", "名前@example.com", null, undefined]) {
    assert.equal(canonicalLoginEmail(v), "", JSON.stringify(v));
  }
});

test("lookups try the canonical form first, then the address as typed", () => {
  // During migration a stored row may still carry the old convention, and after
  // it a scholar may still type the old address. Both must resolve.
  assert.deepEqual(loginEmailCandidates("inder.gupta.461a3ea7@scholars.archivyn.com"), [
    "inder.gupta.461a3ea7@archivyn.com",
    "inder.gupta.461a3ea7@scholars.archivyn.com",
  ]);
  // Already canonical: one candidate, not a duplicate.
  assert.deepEqual(loginEmailCandidates("craig.johnson@archivyn.com"), ["craig.johnson@archivyn.com"]);
  assert.deepEqual(loginEmailCandidates(""), []);
});

/**
 * The contract: this rule and the portal's must agree on every fixture input.
 *
 * Runs only when the sibling checkout is present, so CI for this service does
 * not require another repository — the same posture as the ownership manifest
 * check. When it does run, a change to either function that the other did not
 * follow fails here, before a scholar finds out at a login screen.
 */
test("matches ngo-admin-backend's normalizeArchivynEmail on every fixture", async (t) => {
  const sibling = path.resolve(__dirname, "../../../ngo-admin-app/ngo-admin-backend/utils/passwordPolicy.js");
  if (!fs.existsSync(sibling)) {
    t.skip("portal checkout not present beside this one");
    return;
  }

  const portal = await import(pathToFileURL(sibling).href);
  assert.equal(typeof portal.normalizeArchivynEmail, "function", "portal export moved or renamed");

  for (const input of FIXTURE) {
    assert.equal(
      canonicalLoginEmail(input),
      portal.normalizeArchivynEmail(input),
      `diverged on ${JSON.stringify(input)}`,
    );
  }
});
