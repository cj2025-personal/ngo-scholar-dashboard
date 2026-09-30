/**
 * What a reader typed, made safe to keep.
 *
 * What must hold: an email, a link, a phone number and a long number are
 * replaced with a word saying what was there; a question about the paper
 * is untouched; a sentence about the reader is flagged, not rewritten.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { redactPersonal } = require("../src/lib/redact");

test("a question about the paper is untouched and not about the reader", () => {
  const r = redactPersonal("How much did the signal improve with 2 interferers in paragraph 3?");
  assert.equal(r.text, "How much did the signal improve with 2 interferers in paragraph 3?");
  assert.deepEqual(r.redacted, []);
  assert.equal(r.aboutReader, false);
});

test("addresses and numbers are replaced with what they were", () => {
  const r = redactPersonal("Email me at kid@example.com or call 020 7946 0958, my postcode is 90210, see https://example.com/x");
  assert.equal(r.text, "Email me at [email] or call [phone], my postcode is [number], see [link]");
  assert.deepEqual(r.redacted, ["email", "link", "phone", "number"]);
  assert.equal(r.aboutReader, true);
});

test("a sentence about the reader is flagged but kept in their words", () => {
  for (const q of ["My name is Sam, what is a null?", "I am 9 and I live in Leeds. What is the quiet room?", "I go to Park Road school, can you quiz me?", "my teacher is Mr Jones and he said this is wrong"]) {
    const r = redactPersonal(q);
    assert.equal(r.aboutReader, true, q);
    assert.equal(r.text, q.replace(/\s+/g, " ").trim());
  }
  assert.equal(redactPersonal("I am reading paragraph 2, what does it mean?").aboutReader, false);
  assert.equal(redactPersonal("What year was the array built?").aboutReader, false);
});
