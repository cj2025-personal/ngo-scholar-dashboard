/**
 * The guard, against scripted decisions.
 *
 * What must hold: the masking is exactly what the model decided — each span
 * it named, wherever it occurs, longest first — and a span the model named
 * that is not in the question is reported, not invented; route, intent and
 * about-reader are carried as given, with unknown values made safe; an
 * illegible decision is an error, because an unscreened question is not
 * answered.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const guard = require("../src/lib/agents/readerGuard");

const decide = (o) => async () => ({ text: JSON.stringify({ pii: [], about_reader: false, intent: "explain", route: "answer", decline_reason: "none", rationale: "r", ...o }), usage: { input: 2 }, model: "guard-m" });

test("masks exactly the spans the model named, wherever they occur", async () => {
  const r = await guard.screenQuestion({
    question: "My name is Sam and Sam lives at 4 Elm Road, email sam@x.org — what is a null?",
    audience: "ages_8_11",
    generate: decide({ pii: [{ text: "Sam", kind: "name" }, { text: "4 Elm Road", kind: "address" }, { text: "sam@x.org", kind: "email" }, { text: "Leeds", kind: "location" }], about_reader: true, intent: "personal" }),
  });
  assert.equal(r.masked, "My name is [name] and [name] lives at [address], email [email] — what is a null?");
  assert.deepEqual(r.applied.sort(), ["address", "email", "name"]);
  assert.equal(r.decision.aboutReader, true);
  assert.equal(r.decision.intent, "personal");
  assert.equal(r.model, "guard-m");
});

test("a question with nothing personal is untouched, and the route is the model's", async () => {
  const r = await guard.screenQuestion({ question: "How did they measure the signal?", audience: "adults", generate: decide({}) });
  assert.equal(r.masked, "How did they measure the signal?");
  assert.equal(r.decision.route, "answer");
  const d = await guard.screenQuestion({ question: "x", audience: "adults", generate: decide({ route: "decline", decline_reason: "unsafe", intent: "unsafe" }) });
  assert.equal(d.decision.route, "decline");
  assert.equal(d.decision.declineReason, "unsafe");
});

test("values outside the vocabulary are made safe; an illegible decision is an error", async () => {
  const r = await guard.screenQuestion({ question: "q", audience: "adults", generate: decide({ intent: "gossip", route: "maybe", pii: [{ text: "q", kind: "weird" }] }) });
  assert.equal(r.decision.intent, "other");
  assert.equal(r.decision.route, "answer");
  assert.deepEqual(r.applied, ["other"]);
  await assert.rejects(guard.screenQuestion({ question: "q", audience: "adults", generate: async () => ({ text: "no" }) }), (e) => e.code === "GUARD_UNREADABLE");
});

test("the prompt carries the reader, the article and the question", () => {
  const p = guard.buildPrompt({ question: "Why?", audience: "ages_12_14", storyTitle: "Arrays", headings: ["How", "Limits"] });
  assert.match(p, /THE READER: readers aged 12 to 14\./);
  assert.match(p, /THE ARTICLE: Arrays — sections: How · Limits/);
  assert.match(p, /QUESTION TO SCREEN: Why\?$/);
});
