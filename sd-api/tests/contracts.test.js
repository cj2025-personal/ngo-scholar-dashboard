/**
 * Every module loads, and the routes that must exist do.
 *
 * ── Why this test exists ────────────────────────────────────────────────────
 * On 2026-09-12 ninety-nine tests passed while /profile returned 500: a
 * missing import in a service no test ever required. Unit tests over pure
 * libraries cannot see that. This one requires every file the process would
 * load, under the same environment shape the process boots with, so an
 * unresolved import fails here rather than on the first request.
 *
 * It does not connect to anything. `MONGODB_URI` is set to a placeholder only
 * so `config/env.js` does not throw on load; no client is opened until a
 * route runs.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

process.env.MONGODB_URI ||= "mongodb://localhost:27017/contract-test";
process.env.MONGODB_DB ||= "contract-test";

const SRC = path.resolve(__dirname, "..", "src");
const DIRS = ["config", "db", "lib", "middleware", "services", "routes"];

const modulesIn = (dir) =>
  fs
    .readdirSync(path.join(SRC, dir))
    .filter((f) => f.endsWith(".js"))
    .map((f) => path.join(SRC, dir, f));

test("every service, route, lib, middleware, config and db module loads", () => {
  const failures = [];
  for (const dir of DIRS) {
    for (const file of modulesIn(dir)) {
      try {
        require(file);
      } catch (error) {
        failures.push(`${path.relative(SRC, file)}: ${error.message.split("\n")[0]}`);
      }
    }
  }
  assert.deepEqual(failures, [], `modules that failed to load:\n  ${failures.join("\n  ")}`);
});

const routePaths = (router) =>
  router.stack
    .filter((layer) => layer.route)
    .flatMap((layer) => Object.keys(layer.route.methods).map((m) => `${m.toUpperCase()} ${layer.route.path}`));

test("the drafting routes are mounted", () => {
  const paths = routePaths(require("../src/routes/drafting.routes"));
  assert.ok(paths.includes("GET /sources"), paths.join(", "));
  assert.ok(paths.includes("POST /from/:origin/:sourceId"), paths.join(", "));
});

test("the editorial routes still expose create, update and public read", () => {
  const paths = routePaths(require("../src/routes/editorial.routes"));
  for (const want of ["POST /", "PATCH /:storyId", "GET /public/slug/:slug"]) {
    assert.ok(paths.includes(want), `${want} missing from ${paths.join(", ")}`);
  }
});

test("the collection ownership manifest agrees with user-dashboard-api's copy when that repo is present", (t) => {
  const ours = require("../src/db/ownership");
  const theirs = path.resolve(__dirname, "..", "..", "..", "user-dashboard-api", "backend", "src", "db", "ownership.js");
  if (!fs.existsSync(theirs)) {
    t.skip("user-dashboard-api is not checked out beside this repo");
    return;
  }
  const text = fs.readFileSync(theirs, "utf8");
  const m = text.match(/MANIFEST_VERSION\s*=\s*"([^"]+)"/);
  assert.ok(m, "could not find MANIFEST_VERSION in the other repo");
  assert.equal(ours.MANIFEST_VERSION, m[1], "ownership manifest versions have drifted between repos");
});
