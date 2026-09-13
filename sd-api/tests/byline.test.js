/**
 * The byline on a published article.
 *
 * The failure this file exists to prevent is not a missing string. It is one
 * real person's writing appearing under another real person's name, or a piece
 * of scholarship going out with "Unknown Author" on it.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildByline, bylineStructuredData, initialsFrom } = require("../src/lib/byline");

/** Shaped like a real `scholars` document. */
const INDER = {
  profile_id: "461a3ea7-10d5-428c-9674-9b699e559a58",
  name: { display: "Inder Gupta", full: "Inder Jeet Gupta" },
  about: {
    current_position: "Emeritus Professor",
    institution: "The Ohio State University",
    avatar_initial: "IG",
  },
};

test("a curated record yields a byline a reader can read", () => {
  const b = buildByline(INDER);
  assert.equal(b.name, "Inder Gupta");
  assert.equal(b.position, "Emeritus Professor");
  assert.equal(b.institution, "The Ohio State University");
  assert.equal(b.affiliation, "Emeritus Professor · The Ohio State University");
  assert.equal(b.profileId, INDER.profile_id);
});

test("no name means no byline, never a placeholder", () => {
  // "By Unknown Author" on a piece of scholarship reads as our error.
  for (const scholar of [
    null,
    undefined,
    {},
    { about: { institution: "MIT" } },
    { name: {} },
    { name: { display: "   " } },
  ]) {
    assert.equal(buildByline(scholar), null, `${JSON.stringify(scholar)} must not produce a byline`);
  }
});

test("an affiliation that repeats the institution is not printed twice", () => {
  const b = buildByline({
    name: { display: "Ada Okafor" },
    about: { current_position: "Professor of Physics at MIT", institution: "MIT" },
  });
  assert.equal(b.affiliation, "Professor of Physics at MIT");
  assert.doesNotMatch(b.affiliation, /MIT · MIT/);
});

test("a partial record still produces what it has", () => {
  const noInstitution = buildByline({ name: { display: "Ada Okafor" }, about: { current_position: "Reader" } });
  assert.equal(noInstitution.affiliation, "Reader");
  assert.equal(noInstitution.institution, null);

  const nameOnly = buildByline({ name: { full: "Ada Okafor" } });
  assert.equal(nameOnly.name, "Ada Okafor");
  assert.equal(nameOnly.affiliation, null);
});

test("display name wins over full name", () => {
  // The curated record carries both; `display` is the one a person chose.
  assert.equal(buildByline(INDER).name, "Inder Gupta");
  assert.equal(buildByline({ name: { full: "Inder Jeet Gupta" } }).name, "Inder Jeet Gupta");
});

test("initials drop the middle name", () => {
  assert.equal(initialsFrom("Inder Jeet Gupta"), "IG");
  assert.equal(initialsFrom("Ada Okafor"), "AO");
  assert.equal(initialsFrom("Prince"), "P");
  assert.equal(initialsFrom("  "), null);
  assert.equal(initialsFrom(null), null);
  // A curated initial beats a derived one.
  assert.equal(buildByline(INDER).initials, "IG");
});

test("structured data is omitted rather than asserting an unknown author", () => {
  assert.equal(bylineStructuredData(null), undefined);
  assert.equal(bylineStructuredData({}), undefined);
  assert.equal(bylineStructuredData({ institution: "MIT" }), undefined);
});

test("structured data names the person and their affiliation", () => {
  const sd = bylineStructuredData(buildByline(INDER));
  assert.equal(sd["@type"], "Person");
  assert.equal(sd.name, "Inder Gupta");
  assert.equal(sd.jobTitle, "Emeritus Professor");
  assert.deepEqual(sd.affiliation, { "@type": "Organization", name: "The Ohio State University" });
});

test("structured data omits fields it does not have, rather than emitting empty ones", () => {
  const sd = bylineStructuredData(buildByline({ name: { display: "Ada Okafor" } }));
  assert.equal(sd.name, "Ada Okafor");
  assert.ok(!("jobTitle" in sd));
  assert.ok(!("affiliation" in sd));
});

test("nothing in the byline exposes the account behind it", () => {
  // The story document carries `login_email`. A public byline must never.
  const withEmail = { ...INDER, login_email: "inder.gupta.461a3ea7@scholars.archivyn.com" };
  const b = buildByline(withEmail);
  assert.equal(JSON.stringify(b).includes("@"), false, "no address may reach a reader");
  assert.ok(!("login_email" in b));
  assert.ok(!("email" in b));
});
