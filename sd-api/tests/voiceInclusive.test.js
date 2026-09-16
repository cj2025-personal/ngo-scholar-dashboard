/**
 * "We" has two meanings, and only one of them is the author.
 *
 * Every `we`, `us` and `our` used to count as the scholar speaking as
 * themselves, so an article written for a child — where "things we use every
 * day" is ordinary English for everyone — tripped the guard in its first
 * section and the whole run refused. These are the sentences the real model
 * produced when that happened, and the ones the guard must still catch.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { firstPersonSentences } = require("../src/lib/draftComposer");

const flags = (t) => firstPersonSentences(t).length > 0;

test("the inclusive we — the reader included — is not the author, and cost six sections when it was", () => {
  /* Verbatim from the run that failed: gemini-2.5-flash, ages 8-11. */
  for (const sentence of [
    "It helps us find where sounds or radio signals come from.",
    "This is very useful for many things we use every day.",
    "This helps weather forecasters tell us about the weather.",
    "DOA is important for many technologies we use every day.",
    "It tells us the exact direction of a signal source.",
    "DOA helps us find where sounds or radio signals come from.",
  ]) {
    assert.equal(flags(sentence), false, sentence);
  }
});

test("the singular first person is the author, with no second reading", () => {
  for (const sentence of [
    "I found that the array improved the ratio.",
    "My method updates the weights every two milliseconds.",
    "The idea came to me in the field.",
    "I'm reporting the trials that failed as well.",
    "The design is mine.",
  ]) {
    assert.equal(flags(sentence), true, sentence);
  }
});

test("the authorial we — attached to the work — is still caught", () => {
  for (const sentence of [
    "We found that performance degrades with four interferers.",
    "We measured power consumption at 1.8 watts.",
    "In this paper we present a mixed-window method.",
    "We also compared the two approaches under multipath.",
    "We have shown that the weaker signal can be recovered.",
    "Our method builds a dictionary of possible signals.",
    "Our results show fewer failed trials.",
    "We carried out forty trials in an anechoic chamber.",
    /* What the work did to a quantity is the work's own claim. */
    "We cut interference by eleven decibels.",
    "We improved the signal-to-noise ratio.",
    "We reduced the number of failed trials.",
  ]) {
    assert.equal(flags(sentence), true, sentence);
  }
});

test("everyday verbs stay everyday: explaining something to a reader is not authorship", () => {
  for (const sentence of [
    "We use radios every day without thinking about them.",
    "We can see the signal on the screen.",
    "We all know how hard it is to hear in a crowd.",
    "Think about the phone in our pockets.",
    "This is the sort of thing we notice only when it fails.",
  ]) {
    assert.equal(flags(sentence), false, sentence);
  }
});

test("only the offending sentence is named, so the caller can drop that paragraph and keep the rest", () => {
  const paragraph = "Imagine a noisy room. It helps us find where a voice comes from. We measured the improvement at eleven decibels. Everyone has been in that room.";
  assert.deepEqual(firstPersonSentences(paragraph), ["We measured the improvement at eleven decibels."]);
});

test("a quotation mark around the sentence does not hide the author", () => {
  assert.equal(flags('“We found that the array improved the ratio.”'), true);
});
