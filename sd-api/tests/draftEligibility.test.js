/**
 * The legal boundary of "Draft from my research", tested for the ways it fails.
 *
 * The failure this file exists to prevent is a five-paragraph article, under a
 * named scholar's byline, built from text we were licensed to quote in six
 * sentences — or from a PDF a scholar uploaded but never consented to our use of.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { USE, ORIGIN, STAGE, THRESHOLDS, classifySource, legacyGate, summarise } =
  require("../src/lib/draftEligibility");

/** Shaped like a real `source_texts` row. */
const FULL = {
  source_id: "src-1", title: "Adaptive antenna arrays", source_year: 2011,
  allowed_use: "full", license_type: "cc_by", word_count: 6160,
};
const QUOTES = { ...FULL, source_id: "src-2", allowed_use: "short_quotes", license_type: "proprietary" };

/** A portal upload as the drafting service presents it: the document's own
 *  fields, plus the latest extraction row's state and transcription words. */
const UPLOAD = {
  origin: ORIGIN.CONTRIBUTED, document_id: "doc-1", title: "Adaptive arrays, lecture notes",
  document_type: "research_artifact", status: "available",
  consent: { version: "2026-08-31.v1", accepted_at: "2026-09-02T18:38:24Z" },
  extraction: { status: "extracted", reviewStatus: "accepted", words: 8400 },
};

test("full-use text of real length is draftable", () => {
  const r = classifySource(FULL);
  assert.equal(r.use, USE.DRAFTABLE);
  assert.match(r.reason, /licensed in full/);
  assert.equal(r.words, 6160);
});

test("short-quotes licence is citable, never draftable, however long", () => {
  const r = classifySource({ ...QUOTES, word_count: 50000 });
  assert.equal(r.use, USE.CITABLE);
  assert.match(r.reason, /short quotes only/);
});

test("metadata-only and unknown licences are unusable, not citable", () => {
  // Unknown provenance is worse than restricted: you cannot defend what you
  // cannot characterise, so the default is refusal.
  for (const allowed_use of ["metadata_only", "unknown", "", null, undefined]) {
    const r = classifySource({ ...FULL, allowed_use });
    assert.equal(r.use, USE.UNUSABLE, `allowed_use=${JSON.stringify(allowed_use)} must be unusable`);
  }
  assert.match(classifySource({ ...FULL, allowed_use: null }).reason, /won't guess/);
});

test("a licence value this file has never seen is refused, not mapped to the nearest bucket", () => {
  const r = classifySource({ ...FULL, allowed_use: "full_ish" });
  assert.equal(r.use, USE.UNUSABLE);
  assert.match(r.reason, /unrecognised licence "full_ish"/);
});

test("an abstract is never draft material, whatever its licence says", () => {
  // 8,539 harvested passages are abstracts. Five paragraphs from 200 words
  // means inventing everything past the abstract.
  const r = classifySource({ ...FULL, kind: "abstract", word_count: 220 });
  assert.equal(r.use, USE.CITABLE);
  assert.match(r.reason, /abstract/);

  // Even an implausibly long one labelled full-use.
  assert.equal(classifySource({ ...FULL, kind: "abstract", word_count: 9000 }).use, USE.CITABLE);
});

test("length gates draftability: full-use but short is citable", () => {
  const short = classifySource({ ...FULL, word_count: THRESHOLDS.MIN_DRAFT_WORDS - 1 });
  assert.equal(short.use, USE.CITABLE);
  assert.match(short.reason, /too short to draft from/);

  const exact = classifySource({ ...FULL, word_count: THRESHOLDS.MIN_DRAFT_WORDS });
  assert.equal(exact.use, USE.DRAFTABLE);

  const nothing = classifySource({ ...FULL, word_count: 40 });
  assert.equal(nothing.use, USE.UNUSABLE);
});

test("a scholar's own upload is draftable only with consent on record", () => {
  assert.equal(classifySource(UPLOAD).use, USE.DRAFTABLE);
  assert.match(classifySource(UPLOAD).reason, /your own upload, extracted and accepted/);

  const noConsent = classifySource({ ...UPLOAD, consent: {} });
  assert.equal(noConsent.use, USE.UNUSABLE);
  assert.match(noConsent.reason, /without recorded consent/);

  assert.equal(classifySource({ ...UPLOAD, consent: undefined }).use, USE.UNUSABLE);
});

test("each stop in the portal's pipeline gets its own sentence", () => {
  // "Not draftable" is true at every stop and useless at each one.
  const at = (extraction) => classifySource({ ...UPLOAD, extraction });

  const none = at(null);
  assert.equal(none.use, USE.UNUSABLE);
  assert.match(none.reason, /extraction hasn't run yet/);

  const failed = at({ status: "failed" });
  assert.equal(failed.use, USE.UNUSABLE);
  assert.match(failed.reason, /extraction failed/);

  const review = at({ status: "needs_review", reviewStatus: "unreviewed", words: 9000 });
  assert.equal(review.use, USE.UNUSABLE);
  assert.match(review.reason, /awaiting a reviewer/);

  // Extracted but not yet accepted by a person is still not draftable, whatever
  // the word count — the human gate is the whole point.
  const unreviewed = at({ status: "extracted", reviewStatus: "unreviewed", words: 9000 });
  assert.equal(unreviewed.use, USE.UNUSABLE);
  assert.match(unreviewed.reason, /awaiting a reviewer/);

  const rejected = at({ status: "extracted", reviewStatus: "rejected", words: 9000 });
  assert.equal(rejected.use, USE.UNUSABLE);
  assert.match(rejected.reason, /reviewer declined/);

  const thin = at({ status: "extracted", reviewStatus: "accepted", words: 40 });
  assert.equal(thin.use, USE.UNUSABLE);
  assert.match(thin.reason, /almost no readable text/);

  const short = at({ status: "extracted", reviewStatus: "accepted", words: 1200 });
  assert.equal(short.use, USE.CITABLE);
  assert.match(short.reason, /too short to draft from/);
});

test("a CV or identity document is evidence for the record, not draft material", () => {
  for (const document_type of ["cv", "identity", "credential", "correspondence"]) {
    const r = classifySource({ ...UPLOAD, document_type });
    assert.equal(r.use, USE.UNUSABLE, document_type);
    assert.match(r.reason, /not a paper/);
  }
  for (const document_type of ["publication", "research_artifact", "other"]) {
    assert.equal(classifySource({ ...UPLOAD, document_type }).use, USE.DRAFTABLE, document_type);
  }
});

test("a contributed document's words come only from its extraction row", () => {
  // A word_count on the document itself must be ignored: nothing but the
  // portal's transcription may be counted, because only it is purged with
  // the bytes on erasure.
  const r = classifySource({ ...UPLOAD, word_count: 50000, extraction: null });
  assert.equal(r.use, USE.UNUSABLE);
  assert.equal(r.words, 0);
});

test("an upload that is not yet available is not draftable", () => {
  // The portal's own statuses, spelled the way a scholar would read them.
  for (const [status, shown] of [["deleted", "deleted"], ["pending_upload", "pending upload"], ["scanning", "scanning"], ["quarantined", "quarantined"]]) {
    const r = classifySource({ ...UPLOAD, status });
    assert.equal(r.use, USE.UNUSABLE, `status=${status}`);
    assert.match(r.reason, new RegExp(`upload is ${shown}`));
  }
});

test("missing fields never become permissive defaults", () => {
  // The dangerous bug shape: undefined word_count treated as "enough",
  // undefined allowed_use treated as "fine".
  for (const src of [{}, { title: "x" }, { allowed_use: "full" }, { word_count: 9000 }, null, undefined, "string"]) {
    const r = classifySource(src);
    assert.notEqual(r.use, USE.DRAFTABLE, `${JSON.stringify(src)} must not be draftable`);
  }
});

test("only Legacy Archive members pass the gate", () => {
  assert.equal(legacyGate({ status: "legacy" }).eligible, true);
  for (const status of ["contemporary", null, undefined, "", "Legacy", "LEGACY"]) {
    const g = legacyGate({ status });
    assert.equal(g.eligible, false, `status=${JSON.stringify(status)}`);
    assert.match(g.reason, /Legacy Archive/);
  }
  assert.equal(legacyGate(null).eligible, false);
});

test("the summary orders draftable sources richest-first", () => {
  const s = summarise({
    scholar: { status: "legacy" },
    sources: [
      { ...FULL, source_id: "a", word_count: 2500 },
      { ...FULL, source_id: "b", word_count: 17165 },
      { ...FULL, source_id: "c", word_count: 5243 },
    ],
  });
  assert.deepEqual(s.draftable.map((x) => x.id), ["b", "c", "a"]);
  assert.equal(s.nudge, null, "no nudge when something is draftable");
  assert.deepEqual(s.counts, { draftable: 3, citable: 0, unusable: 0, pending: 0 });
});

test("the nudge names the one thing that would change the answer", () => {
  // Nothing draftable, something citable: say why, and what to add.
  const quotesOnly = summarise({ scholar: { status: "legacy" }, sources: [QUOTES] });
  assert.equal(quotesOnly.draftable.length, 0);
  assert.match(quotesOnly.nudge, /short quotes only/);
  assert.match(quotesOnly.nudge, /Add a paper you hold the rights to/);

  // Nothing at all: still says what to add, without the licence explanation.
  const empty = summarise({ scholar: { status: "legacy" }, sources: [] });
  assert.match(empty.nudge, /don't yet hold any/);
  assert.doesNotMatch(empty.nudge, /short quotes/);
});

test("a paper at the review gate is pending, and the panel is not asked for another", () => {
  // The first real pending document produced "add a paper you hold the rights
  // to" for a scholar who just had. Pending suppresses that and says where the
  // paper is instead.
  const pendingReview = { ...UPLOAD, extraction: { status: "needs_review", reviewStatus: "unreviewed", words: 2240 } };
  const r = classifySource(pendingReview);
  assert.equal(r.stage, STAGE.AWAITING_REVIEW);
  assert.equal(r.pending, true);

  const s = summarise({ scholar: { status: "legacy" }, sources: [pendingReview] });
  assert.equal(s.counts.draftable, 0);
  assert.equal(s.counts.pending, 1);
  assert.match(s.nudge, /Your paper is being checked/);
  assert.doesNotMatch(s.nudge, /Add a paper/);

  // Two in flight, plural and counted.
  const two = summarise({ scholar: { status: "legacy" }, sources: [pendingReview, { ...UPLOAD, document_id: "doc-2", extraction: null }] });
  assert.equal(two.counts.pending, 2);
  assert.match(two.nudge, /2 of your papers are being checked/);

  // Only the two in-flight stages are pending; a refusal is not "wait".
  assert.equal(classifySource({ ...UPLOAD, extraction: { status: "failed" } }).pending, false);
  assert.equal(classifySource({ ...UPLOAD, extraction: { status: "extracted", reviewStatus: "rejected", words: 9000 } }).pending, false);
  assert.equal(classifySource({ ...UPLOAD, document_type: "cv" }).pending, false);
  assert.equal(classifySource(UPLOAD).stage, STAGE.READY);
  assert.equal(classifySource(UPLOAD).pending, false);

  // Harvested sources have no stage: there is no pipeline for them to be in.
  assert.equal(classifySource(FULL).stage, undefined);
  assert.equal(classifySource(FULL).pending, undefined);
});

test("a rejected extraction says so rather than 'awaiting'", () => {
  const r = classifySource({ ...UPLOAD, extraction: { status: "extracted", reviewStatus: "rejected", words: 9000 } });
  assert.equal(r.use, USE.UNUSABLE);
  assert.equal(r.stage, STAGE.REJECTED);
  assert.match(r.reason, /reviewer declined/);
});

test("ineligible scholars still get an honest inventory, not an empty one", () => {
  // A contemporary scholar sees what we hold and what the perk would unlock.
  const s = summarise({ scholar: { status: "contemporary" }, sources: [FULL, QUOTES] });
  assert.equal(s.eligible, false);
  assert.equal(s.counts.draftable, 1);
  assert.equal(s.counts.citable, 1);
});

test("every classification carries a reason a scholar can read", () => {
  const cases = [FULL, QUOTES, UPLOAD, { ...FULL, allowed_use: "metadata_only" }, { ...FULL, kind: "abstract" }, {}];
  for (const src of cases) {
    const r = classifySource(src);
    assert.ok(r.reason && r.reason.length > 8, `no reason for ${JSON.stringify(src).slice(0, 40)}`);
    assert.ok(!/error|invalid|denied|forbidden/i.test(r.reason), `reads as blame: "${r.reason}"`);
  }
});
