/**
 * Provenance: the chip survives an edit that keeps the substance and drops on
 * one that replaces it; nothing is claimed for a block that was never drafted.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  TRACE_THRESHOLD, overlap, traceability, normalizeSourceRefs, normalizeBlockProvenance,
  presentBlockProvenance, storyProvenanceFromJob, provenanceLine, shortSourceLabel,
} = require("../src/lib/provenance");

const DRAFTED = "The array steers a null toward each interferer, which lowers the noise the receiver hears. In trials with one interferer the signal became fourteen decibels clearer.";

test("light edits keep the chip; a rewrite drops it", () => {
  const fixed = "The array steers a <b>null</b> toward each interferer, lowering the noise the receiver hears. In trials with one interferer, the signal became fourteen decibels clearer!";
  assert.ok(overlap(DRAFTED, fixed) >= 0.85);
  assert.equal(traceability({ draftedText: DRAFTED, currentText: fixed }).traceable, true);

  const reordered = "In trials with one interferer the signal became fourteen decibels clearer. The array steers a null toward each interferer, which lowers the noise the receiver hears.";
  assert.equal(overlap(DRAFTED, reordered), 1, "reordering keeps every token");

  const cut = "The array steers a null toward each interferer, which lowers the noise the receiver hears.";
  const t = traceability({ draftedText: DRAFTED, currentText: cut });
  assert.ok(t.overlap > 0.4 && t.overlap < TRACE_THRESHOLD, `cutting half measures ${t.overlap}`);
  assert.equal(t.traceable, false);
  assert.match(t.reason, /edited beyond its source/);

  const rewritten = "Everything in this paragraph is new prose that shares nothing with what was drafted before.";
  assert.equal(traceability({ draftedText: DRAFTED, currentText: rewritten }).traceable, false);
  assert.equal(overlap("", rewritten), 0);
});

test("refs are validated and deduplicated; a block without refs has no provenance", () => {
  assert.deepEqual(normalizeSourceRefs([{ passageId: "p3" }, { passageId: "p3" }, { passageId: " p4 " }, { passageId: "<x>" }, null, { passageId: "" }]), [{ passageId: "p3" }, { passageId: "p4" }]);
  assert.equal(normalizeBlockProvenance({ sourceRefs: [], draftedText: DRAFTED, currentHtml: DRAFTED }), null);
  assert.equal(normalizeBlockProvenance({ sourceRefs: "p3", draftedText: DRAFTED, currentHtml: DRAFTED }), null);
});

test("stored provenance carries refs, drafted text, verdict and a measured traceability", () => {
  const p = normalizeBlockProvenance({
    sourceRefs: [{ passageId: "p3" }],
    draftedText: DRAFTED,
    fidelity: { verdict: "partial", unsupportedClaims: ["fourteen decibels", 42, ""] },
    currentHtml: `${DRAFTED} <i>Slightly edited.</i>`,
  });
  assert.deepEqual(p.source_refs, [{ passageId: "p3" }]);
  assert.equal(p.traceable, true);
  assert.equal(p.fidelity.verdict, "partial");
  assert.deepEqual(p.fidelity.unsupportedClaims, ["fourteen decibels", "42"]);
  assert.equal(p.fidelity.claims, undefined, "no claims given, none invented");
  const withClaims = normalizeBlockProvenance({
    sourceRefs: [{ passageId: "p1" }], draftedText: DRAFTED, currentHtml: DRAFTED,
    fidelity: { verdict: "partial", unsupportedClaims: [], claims: [
      { text: "eleven decibels", verdict: "supported", passageIds: ["p1", "bogus id"], evidence: "by eleven decibels" },
      { text: "", verdict: "supported", passageIds: ["p1"], evidence: "dropped: no text" },
      { text: "fourteen", verdict: "nonsense", passageIds: [], evidence: "" },
    ] },
  });
  assert.equal(withClaims.fidelity.claims.length, 2);
  assert.deepEqual(withClaims.fidelity.claims[0].passageIds, ["p1"], "only well-formed passage ids are kept");
  assert.equal(withClaims.fidelity.claims[1].verdict, "unsupported", "an unknown verdict is unsupported");
  assert.equal(normalizeBlockProvenance({ sourceRefs: [{ passageId: "p1" }], draftedText: DRAFTED, fidelity: { verdict: "maybe" }, currentHtml: DRAFTED }).fidelity, null);

  const noDraft = normalizeBlockProvenance({ sourceRefs: [{ passageId: "p1" }], draftedText: "", currentHtml: DRAFTED });
  assert.equal(noDraft.traceable, false);
  assert.match(noDraft.trace_reason, /no drafted text/);

  const shown = presentBlockProvenance(p);
  assert.deepEqual(shown.sourceRefs, [{ passageId: "p3" }]);
  assert.equal(shown.traceable, true);
  assert.equal(shown.draftedText, DRAFTED);
  assert.deepEqual(presentBlockProvenance(null), {});
});

test("the story's provenance comes from the job, and the byline line from a read-time join", () => {
  const job = { _id: "j1", source: { origin: "harvested", id: "src-1", title: "Adaptive nulling", year: 2011 }, prompt_version: "v1", graph_version: "g1", finished_at: new Date(0) };
  const p = storyProvenanceFromJob(job);
  assert.equal(p.source_id, "src-1");
  assert.equal(p.origin, "harvested");
  assert.equal(p.source_year, 2011);
  assert.equal(storyProvenanceFromJob(null), null);

  assert.equal(provenanceLine({ title: "Adaptive nulling", year: 2011 }), "Drawn from the author's research: Adaptive nulling (2011)");
  assert.equal(provenanceLine({ title: "Adaptive nulling" }), "Drawn from the author's research: Adaptive nulling");
  assert.equal(provenanceLine(null), null, "an unresolved source claims nothing");
  assert.equal(provenanceLine({ title: "" }), null);

  assert.equal(shortSourceLabel({ title: "Adaptive nulling in small arrays", year: 2011, scholarSurname: "Gupta" }), "Gupta 2011");
  assert.equal(shortSourceLabel({ title: "Adaptive nulling in small arrays", year: null }), "Adaptive nulling in");
});

test("a paragraph that goes beyond the paper stores the reach verdict in place of fidelity, and comes back as it went in", () => {
  const p = normalizeBlockProvenance({
    sourceRefs: [{ passageId: "p3" }], draftedText: DRAFTED, currentHtml: DRAFTED,
    extension: true,
    fidelity: { verdict: "supported", unsupportedClaims: [] },
    reach: { verdict: "partial", overreachClaims: ["used in every phone", ""], claims: [
      { text: "which means a crowded band has the same limit", verdict: "follows", reason: "", anchorIds: ["p3", "<x>"] },
      { text: "used in every phone", verdict: "overreach", reason: "outside_fact", anchorIds: [] },
      { text: "no reason", verdict: "overreach", reason: "nonsense", anchorIds: [] },
      { text: "", verdict: "follows", anchorIds: ["p3"] },
    ] },
  });
  assert.equal(p.extension, true);
  assert.equal(p.fidelity, null, "never both verdicts");
  assert.equal(p.reach.verdict, "partial");
  assert.deepEqual(p.reach.overreachClaims, ["used in every phone"]);
  assert.equal(p.reach.claims.length, 3);
  assert.deepEqual(p.reach.claims[0], { text: "which means a crowded band has the same limit", verdict: "follows", reason: null, anchorIds: ["p3"] });
  assert.equal(p.reach.claims[1].reason, "outside_fact");
  assert.equal(p.reach.claims[2].reason, "does_not_follow", "an unknown reason is the plainest one");
  assert.equal(p.traceable, true);

  const back = presentBlockProvenance(p);
  assert.equal(back.extension, true);
  assert.equal(back.reach.verdict, "partial");
  assert.equal(back.fidelity, null);

  const plain = normalizeBlockProvenance({ sourceRefs: [{ passageId: "p3" }], draftedText: DRAFTED, currentHtml: DRAFTED, fidelity: { verdict: "supported", unsupportedClaims: [] } });
  assert.ok(!("extension" in plain) && !("reach" in plain), "a paper paragraph carries neither");
  assert.ok(!("extension" in presentBlockProvenance(plain)));
  assert.equal(normalizeBlockProvenance({ sourceRefs: [{ passageId: "p3" }], draftedText: DRAFTED, currentHtml: DRAFTED, extension: true, reach: { verdict: "nonsense" } }).reach, null);
});
