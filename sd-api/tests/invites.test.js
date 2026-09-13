/**
 * Invitation rules, tested for the ways they could wrongly let someone in.
 *
 * An invite decides that a particular human being is a particular one of 9,925
 * named researchers. Once redeemed the holder sees unpublished drafts about
 * that scholar and can submit corrections to their public record, so every
 * assertion here is a way a looser rule would hand one person authority over
 * another person's public identity.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const {
  INVITE_STATUS,
  INVITE_TTL_DAYS,
  REJECTION_MESSAGES,
  generateInviteToken,
  hashInviteToken,
  buildInviteExpiry,
  inviteRejection,
  isWellFormedToken,
} = require("../src/lib/invites");

const NOW = new Date("2026-09-11T12:00:00Z");
const PROFILE = "0001d6a6-974f-43df-b097-fe20f6aa7239";

const invite = (over = {}) => ({
  profile_id: PROFILE,
  status: INVITE_STATUS.ISSUED,
  expires_at: new Date(NOW.getTime() + 86_400_000),
  ...over,
});

test("tokens are high-entropy and unguessable", () => {
  const a = generateInviteToken();
  const b = generateInviteToken();
  assert.notEqual(a, b);
  // 48 bytes base64url — the same generator sessions use.
  assert.ok(a.length >= 60, `token too short: ${a.length}`);
  assert.match(a, /^[A-Za-z0-9_-]+$/);
});

test("the token is hashed the way sessions are", () => {
  // A raw token at rest would mean any database read — a backup, an analytics
  // replica, a support query — yields live invitations for any scholar.
  const token = "some-invite-token";
  assert.equal(
    hashInviteToken(token),
    crypto.createHash("sha256").update(token).digest("hex"),
  );
  assert.equal(hashInviteToken(token).length, 64);
});

test("an invitation expires", () => {
  const expiry = buildInviteExpiry(NOW);
  const days = (expiry.getTime() - NOW.getTime()) / 86_400_000;
  assert.equal(days, INVITE_TTL_DAYS);
  assert.ok(days <= 14, "a link forwarded months later must be inert");
});

test("a good invitation is accepted", () => {
  assert.equal(inviteRejection(invite(), NOW), null);
});

test("every way an invitation can be refused", () => {
  const cases = [
    ["no such invite", null, "unknown"],
    ["already redeemed", invite({ status: INVITE_STATUS.REDEEMED }), "already_redeemed"],
    ["revoked", invite({ status: INVITE_STATUS.REVOKED }), "revoked"],
    ["expired", invite({ expires_at: new Date(NOW.getTime() - 1) }), "expired"],
    ["unknown status", invite({ status: "something_else" }), "unknown"],
    // An invite with no expiry is malformed, not expired — it refuses either
    // way, but the reason is what an operator reads when debugging.
    ["no expiry", invite({ expires_at: null }), "malformed"],
    ["missing expiry field", invite({ expires_at: undefined }), "malformed"],
    ["unparseable expiry", invite({ expires_at: "not a date" }), "malformed"],
  ];

  for (const [label, doc, expected] of cases) {
    assert.equal(inviteRejection(doc, NOW), expected, label);
  }
});

test("an invitation with no subject is never redeemable", () => {
  // It asserts nothing about anyone, so it cannot authorise an account.
  for (const bad of [null, "", 123, {}]) {
    assert.equal(
      inviteRejection(invite({ profile_id: bad }), NOW),
      "malformed",
      `profile_id ${JSON.stringify(bad)} must not be redeemable`,
    );
  }
});

test("expiry at the exact boundary is expired", () => {
  // An invitation that has used its whole window has used it.
  assert.equal(inviteRejection(invite({ expires_at: NOW }), NOW), "expired");
});

test("an expiry stored as a string is still enforced", () => {
  // Mongo returns Dates, but a fixture or a migration may not. Enforcing only
  // on Date instances would silently accept a string as never-expiring.
  assert.equal(
    inviteRejection(invite({ expires_at: new Date(NOW.getTime() - 1).toISOString() }), NOW),
    "expired",
  );
  assert.equal(
    inviteRejection(invite({ expires_at: new Date(NOW.getTime() + 86_400_000).toISOString() }), NOW),
    null,
  );
});

test("every refusal has a message a scholar can act on", () => {
  for (const reason of ["unknown", "expired", "already_redeemed", "revoked", "malformed"]) {
    const message = REJECTION_MESSAGES[reason];
    assert.ok(message && message.length > 10, `no usable message for ${reason}`);
    // "expired" must say so rather than hiding behind "invalid" — the token is
    // 48 random bytes, so there is no enumeration risk to protect against, and a
    // scholar told "invalid link" will open a support ticket instead of asking
    // for a new invitation.
  }
  assert.match(REJECTION_MESSAGES.expired, /expired/i);
  assert.match(REJECTION_MESSAGES.already_redeemed, /already been used/i);
});

test("malformed tokens cost no database round trip", () => {
  assert.equal(isWellFormedToken(generateInviteToken()), true);
  for (const bad of [
    null,
    undefined,
    "",
    "short",
    12345,
    ["a"],
    {},
    "has spaces in it and is long enough to pass length",
    `${generateInviteToken()}<script>`,
    "x".repeat(500),
  ]) {
    assert.equal(isWellFormedToken(bad), false, `should refuse: ${JSON.stringify(bad)}`);
  }
});

test("status vocabulary is closed", () => {
  // A typo'd status must not read as issued.
  assert.deepEqual(
    Object.values(INVITE_STATUS).sort(),
    ["issued", "redeemed", "revoked"],
  );
});
