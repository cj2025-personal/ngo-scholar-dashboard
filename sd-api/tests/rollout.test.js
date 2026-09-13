const test = require("node:test");
const assert = require("node:assert/strict");

const { MODE, parseProfileList, rolloutAllows } = require("../src/lib/rollout");

test("all mode admits everyone; pilot mode admits only the list", () => {
  assert.equal(rolloutAllows({ mode: "all", pilotProfiles: [], profileId: "p1" }).ok, true);
  assert.equal(rolloutAllows({ mode: undefined, pilotProfiles: [], profileId: "p1" }).ok, true, "unset means all");
  assert.equal(rolloutAllows({ mode: "PILOT", pilotProfiles: ["p1", "p2"], profileId: "p1" }).ok, true);
  const out = rolloutAllows({ mode: "pilot", pilotProfiles: ["p1", "p2"], profileId: "p3" });
  assert.equal(out.ok, false);
  assert.match(out.reason, /2 scholars are in the pilot/);
  assert.equal(out.mode, MODE.PILOT);
});

test("an empty pilot list admits nobody, and says so", () => {
  const out = rolloutAllows({ mode: "pilot", pilotProfiles: "", profileId: "p1" });
  assert.equal(out.ok, false);
  assert.match(out.reason, /pilot list is empty/);
  assert.equal(rolloutAllows({ mode: "pilot", pilotProfiles: ["p1"], profileId: null }).ok, false);
});

test("the list is parsed from the env shape: commas, spaces, newlines", () => {
  assert.deepEqual(parseProfileList("a, b\nc  d,,"), ["a", "b", "c", "d"]);
  assert.deepEqual(parseProfileList(undefined), []);
  assert.equal(rolloutAllows({ mode: "pilot", pilotProfiles: "a, b", profileId: "b" }).ok, true);
});
