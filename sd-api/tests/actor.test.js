/**
 * No machine approves its own output.
 *
 * The specific failure: `approved_by: "system-legend-conversation-regeneration"`
 * on sixty-one stories. Every case here is a way a non-person could reach the
 * publish path, and each must be refused with a sentence.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { humanPublisher, makesPublic } = require("../src/lib/actor");

const PERSON = { login_email: "Ada.Lovelace@example.edu", profile_id: "3f1c-…-profile" };

test("a scholar with a login email on a profile-bound session may publish", () => {
  const r = humanPublisher(PERSON);
  assert.equal(r.ok, true);
  assert.equal(r.actor, "ada.lovelace@example.edu");
});

test("the legend pipeline's approver is refused by name", () => {
  for (const login_email of [
    "system-legend-conversation-regeneration",
    "system",
    "system@archivyn.com",
    "svc-drafter@archivyn.com",
    "pipeline.legend@archivyn.com",
    "noreply@archivyn.com",
    "Agent@archivyn.com",
  ]) {
    const r = humanPublisher({ ...PERSON, login_email });
    assert.equal(r.ok, false, `${login_email} must be refused`);
    assert.ok(r.reason.length > 10);
  }
});

test("no email, no profile, or a profile id posing as an email is refused", () => {
  assert.equal(humanPublisher(null).ok, false);
  assert.equal(humanPublisher({}).ok, false);
  assert.equal(humanPublisher({ login_email: "ada@example.edu" }).ok, false);
  assert.equal(humanPublisher({ profile_id: "p1", login_email: "" }).ok, false);
  assert.equal(humanPublisher({ profile_id: "p1", login_email: "not-an-email" }).ok, false);
  assert.equal(humanPublisher({ profile_id: "p1@x.y", login_email: "p1@x.y" }).ok, false);
});

test("a person whose name happens to start with a service word is not refused", () => {
  // "Agnes" is not "agent"; "Bothwell" is not "bot". The pattern requires a separator.
  assert.equal(humanPublisher({ ...PERSON, login_email: "agnes.systemic@example.edu" }).ok, true);
  assert.equal(humanPublisher({ ...PERSON, login_email: "bothwell@example.edu" }).ok, true);
});

test("only published and scheduled make a story public", () => {
  assert.equal(makesPublic("published"), true);
  assert.equal(makesPublic("scheduled"), true);
  assert.equal(makesPublic("draft"), false);
  assert.equal(makesPublic(undefined), false);
});
