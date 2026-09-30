/**
 * The reader's device identity: a signed id that says nothing about anyone.
 *
 * What must hold: a minted id round-trips through sign and parse; a forged
 * or altered value parses to nothing; a different secret is a stranger; the
 * stored key cannot be turned back into the cookie; two ids never share a
 * key.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const identity = require("../src/lib/readerIdentity");

const SECRET = "test-secret";

test("a minted id signs and parses back", () => {
  const id = identity.mint();
  assert.match(id, /^[A-Za-z0-9_-]{20,}$/);
  const cookie = identity.sign(id, SECRET);
  assert.equal(identity.parse(cookie, SECRET), id);
});

test("a forged, altered or malformed value is nobody", () => {
  const id = identity.mint();
  const cookie = identity.sign(id, SECRET);
  assert.equal(identity.parse(cookie, "other-secret"), null);
  assert.equal(identity.parse(`${id}.AAAAAAAAAAAAAAAAAAAAAA`, SECRET), null);
  assert.equal(identity.parse(`${id}x.${cookie.split(".")[1]}`, SECRET), null);
  assert.equal(identity.parse(id, SECRET), null);
  assert.equal(identity.parse("", SECRET), null);
  assert.equal(identity.parse(null, SECRET), null);
  assert.equal(identity.parse(".", SECRET), null);
  assert.equal(identity.parse("a.b", SECRET), null);
});

test("the stored key is not the cookie, is stable, and differs per id and per secret", () => {
  const id = identity.mint();
  const key = identity.keyFor(id, SECRET);
  assert.match(key, /^[0-9a-f]{40}$/);
  assert.equal(identity.keyFor(id, SECRET), key);
  assert.notEqual(identity.keyFor(identity.mint(), SECRET), key);
  assert.notEqual(identity.keyFor(id, "other"), key);
  assert.ok(!identity.sign(id, SECRET).includes(key));
});
