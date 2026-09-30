"use strict";

/**
 * What a reader typed, made safe to keep.
 *
 * A child asking about a story will sometimes type things about themselves:
 * an email so the answer can be sent on, a phone number, where they live.
 * The question is kept for the reader's own audit trail and is shown to the
 * model, so both see this version: addresses and numbers replaced with a
 * word that says what was there, and a flag when the sentence is about the
 * reader rather than the story, so later turns do not repeat it back.
 *
 * Patterns, not understanding: this catches the shapes a machine can see and
 * leaves the rest to the Sentinel, which reads every answer for personal
 * data before a reader does. Pure.
 */

const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;
const URL_RE = /(?:https?:\/\/|www\.)\S+/gi;
const PHONE_RE = /(?:\+?\d[\d\s().-]{8,}\d)/g;
/** Five or more digits in a row: a postcode, an id, a card. Never part of a question about a paper. */
const LONG_NUMBER_RE = /\b\d{5,}\b/g;
/** The sentence is about the reader. Kept as a flag, not rewritten: the words are theirs. */
const ABOUT_READER_RE = /\b(my name is|my name's|i am \d{1,2}\b|i'm \d{1,2}\b|i live (?:in|at|on)|where i live|my (?:home |school )?address|my (?:phone|mobile|number|email|teacher|school|mum|mom|dad|parents?) (?:is|are|number)|i go to [\w' ]+ school|call me|text me|email me)\b/i;

/**
 * @param {string} text
 * @returns {{text: string, redacted: string[], aboutReader: boolean}}  the safe text, what
 *   kinds were replaced, and whether the reader wrote about themselves
 */
function redactPersonal(text) {
  let out = String(text || "");
  const redacted = [];
  const swap = (re, label) => {
    let hit = false;
    out = out.replace(re, () => { hit = true; return `[${label}]`; });
    if (hit) redacted.push(label);
  };
  swap(EMAIL_RE, "email");
  swap(URL_RE, "link");
  swap(PHONE_RE, "phone");
  swap(LONG_NUMBER_RE, "number");
  out = out.replace(/\s+/g, " ").trim();
  return { text: out, redacted, aboutReader: ABOUT_READER_RE.test(out) || redacted.length > 0 };
}

module.exports = { redactPersonal, ABOUT_READER_RE };
