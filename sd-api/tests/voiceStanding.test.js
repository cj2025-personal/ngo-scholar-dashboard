/**
 * The boundary between being written about and being written as.
 *
 * The failure this file exists to prevent is not a crash. It is a living,
 * named academic discovering that something answered a student in their voice
 * on a subject they never agreed to, or after they told us to stop.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  STANDING,
  THRESHOLDS,
  GATES,
  TRANSITIONS,
  maySpeakAs,
  canTransition,
  assess,
  reconcile,
} = require("../src/lib/voiceStanding");

const CONSENT_VERSION = "2026-09-11.v1";

/** A scholar who clears everything, so each test can break one thing. */
function fullySignals(over = {}) {
  return {
    now: new Date("2026-09-11T12:00:00Z"),
    currentConsentVersion: CONSENT_VERSION,
    evidenceChunks: 13,
    fullUseWords: 12000,
    sourceSections: 3,
    sectionsPresent: 4,
    sectionsReviewed: 4,
    publicationsPresent: 9,
    publicationsConfirmed: 5,
    substantiveResponses: 2,
    calibrationGraded: 14,
    calibrationAgreed: 13,
    calibrationSevereDisagreements: 0,
    consent: {
      accepted: true,
      version: CONSENT_VERSION,
      acceptedAt: new Date("2026-06-01T00:00:00Z"),
      allowedTopics: ["antenna measurement", "adaptive arrays"],
      refusalText: "That's outside what I work on — I'd rather not guess.",
    },
    ...over,
  };
}

test("only standing permits first-person generation", () => {
  for (const s of Object.values(STANDING)) {
    assert.equal(maySpeakAs(s), s === STANDING.STANDING, `${s} must not permit speaking as`);
  }
  // The states most likely to be confused for permission.
  assert.equal(maySpeakAs(STANDING.CALIBRATING), false);
  assert.equal(maySpeakAs(STANDING.SUSPENDED), false);
  assert.equal(maySpeakAs(undefined), false);
});

test("a scholar can withdraw from any state, alone", () => {
  // A kill switch that needs someone else's cooperation is not a kill switch.
  for (const from of Object.values(STANDING)) {
    if (from === STANDING.WITHDRAWN) continue;
    const v = canTransition({ from, to: STANDING.WITHDRAWN, actor: "scholar" });
    assert.equal(v.ok, true, `a scholar must be able to withdraw from ${from}`);
  }
});

test("nobody but the scholar can withdraw them", () => {
  for (const actor of ["admin", "system", "curation"]) {
    const v = canTransition({ from: STANDING.STANDING, to: STANDING.WITHDRAWN, actor });
    assert.equal(v.ok, false, `${actor} must not withdraw on a scholar's behalf`);
    assert.equal(v.code, "WRONG_ACTOR");
  }
});

test("the system can demote without a human, and cannot promote to standing", () => {
  // Suspension must not wait for anyone to be awake.
  assert.equal(canTransition({ from: STANDING.STANDING, to: STANDING.SUSPENDED, actor: "system" }).ok, true);

  // Nothing grants itself permission to impersonate a living person.
  const selfPromote = canTransition({ from: STANDING.CALIBRATING, to: STANDING.STANDING, actor: "system" });
  assert.equal(selfPromote.ok, false);
  assert.equal(selfPromote.code, "WRONG_ACTOR");

  const scholarSelfPromote = canTransition({ from: STANDING.CALIBRATING, to: STANDING.STANDING, actor: "scholar" });
  assert.equal(scholarSelfPromote.ok, false);

  assert.equal(canTransition({ from: STANDING.CALIBRATING, to: STANDING.STANDING, actor: "admin" }).ok, true);
});

test("standing cannot be reached without passing through calibration", () => {
  for (const from of [STANDING.CONTEMPORARY, STANDING.CANDIDATE, STANDING.WITHDRAWN]) {
    const v = canTransition({ from, to: STANDING.STANDING, actor: "admin" });
    assert.equal(v.ok, false, `${from} → standing must not be a single step`);
    assert.equal(v.code, "NO_SUCH_TRANSITION");
  }
});

test("every state is reachable and none is a dead end", () => {
  const reachable = new Set([STANDING.CONTEMPORARY]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const t of TRANSITIONS) {
      if (reachable.has(t.from) && !reachable.has(t.to)) {
        reachable.add(t.to);
        grew = true;
      }
    }
  }
  for (const s of Object.values(STANDING)) {
    assert.ok(reachable.has(s), `${s} is unreachable`);
    assert.ok(TRANSITIONS.some((t) => t.from === s), `${s} is a dead end`);
  }
});

test("every transition names an actor and a reason", () => {
  for (const t of TRANSITIONS) {
    assert.ok(t.actors?.length > 0, `${t.from} → ${t.to} has no actor`);
    assert.ok(t.reason?.length > 4, `${t.from} → ${t.to} has no reason`);
  }
});

/* ── the gates ───────────────────────────────────────────────────────────── */

test("a fully-qualified scholar clears every gate", () => {
  const a = assess(fullySignals());
  assert.equal(a.allMet, true, JSON.stringify(a.blocking));
  assert.equal(a.eligible, true);
  assert.deepEqual(a.blocking, []);
});

const recordGate = (over) => assess(fullySignals(over)).gates.find((g) => g.key === "record");

test("the whole record has to be gone through, not a quota of it", () => {
  // Scholar records carry four sections, not twenty. The bar is "all of them",
  // because a count would be arbitrary against a fixed, small structure.
  assert.equal(recordGate({ sectionsPresent: 4, sectionsReviewed: 3 }).met, false);
  assert.match(recordGate({ sectionsPresent: 4, sectionsReviewed: 3 }).blockers.join(" "), /3 of 4 sections/);
  assert.equal(recordGate({ sectionsPresent: 4, sectionsReviewed: 4 }).met, true);

  // More sections reviewed than exist is not a failure, just odd bookkeeping.
  assert.equal(recordGate({ sectionsPresent: 4, sectionsReviewed: 6 }).met, true);
});

test("a thin record blames us, not the scholar", () => {
  // Holding too little to be worth checking is Gate 1's problem. The wording
  // has to say so, or a scholar reads it as their own failing.
  const gate = recordGate({ sectionsPresent: 1, sectionsReviewed: 1 });
  assert.equal(gate.met, false);
  assert.match(gate.blockers.join(" "), /we hold only 1 section about you/);
  assert.doesNotMatch(gate.blockers.join(" "), /you have not|you failed/i);
});

test("publication confirmation is proportional to what they have", () => {
  // A scholar with two publications confirms two, not five.
  assert.equal(recordGate({ publicationsPresent: 2, publicationsConfirmed: 2 }).met, true);
  assert.equal(recordGate({ publicationsPresent: 0, publicationsConfirmed: 0 }).met, true);

  const short = recordGate({ publicationsPresent: 9, publicationsConfirmed: 3 });
  assert.equal(short.met, false);
  assert.match(short.blockers.join(" "), /3 of 5 publications/);

  // The sample caps: 40 publications still only needs five confirmed.
  assert.equal(recordGate({ publicationsPresent: 40, publicationsConfirmed: 5 }).met, true);
});

test("marking everything correct without one change is not supervision", () => {
  const gate = recordGate({ substantiveResponses: 0 });
  assert.equal(gate.met, false);
  assert.match(gate.blockers.join(" "), /without a single change or addition/);
});

test("an accurate record is not a trap — contributing a paper clears the floor", () => {
  // The rubber-stamp guard must not punish a scholar whose record is right.
  // A contributed document counts, and Gate 1 needs one anyway.
  assert.equal(recordGate({ substantiveResponses: 1 }).met, true);
});

test("the record gate is part of the foundation, and passages are not", () => {
  // The gate this replaced counted adjudications of derived reading passages.
  // 23,141 of those were deleted; they regenerate. Nothing durable can depend
  // on them, so no threshold may mention them.
  assert.ok(assess(fullySignals()).gates.some((g) => g.key === "record"));
  assert.ok(!assess(fullySignals()).gates.some((g) => g.key === "adjudication"));
  for (const key of Object.keys(THRESHOLDS)) {
    assert.doesNotMatch(key, /ADJUDICAT|PASSAGE/i, `${key} still measures regenerable output`);
  }

  // And losing it must drop a scholar out of the foundation.
  const a = assess(fullySignals({ sectionsReviewed: 0 }));
  assert.equal(a.foundationMet, false);
});

test("one answer the scholar calls a misrepresentation blocks standing outright", () => {
  // No average can outweigh it: the whole point is that they would not stand
  // behind it, and standing is the claim that they would.
  const a = assess(fullySignals({ calibrationGraded: 40, calibrationAgreed: 39, calibrationSevereDisagreements: 1 }));
  const gate = a.gates.find((g) => g.key === "calibration");
  assert.equal(gate.met, false);
  assert.match(gate.blockers.join(" "), /misrepresenting you/);
  assert.equal(a.allMet, false);
});

test("consent must be current, scoped, and carry the scholar's own refusal", () => {
  const cases = [
    [{ accepted: false }, /haven't given permission/],
    [{ version: "2025-01-01.v0" }, /terms changed/],
    [{ acceptedAt: new Date("2024-01-01T00:00:00Z") }, /more than a year old/],
    [{ allowedTopics: [] }, /which subjects/],
    [{ refusalText: "" }, /out of scope/],
  ];
  for (const [over, expected] of cases) {
    const base = fullySignals().consent;
    const a = assess(fullySignals({ consent: { ...base, ...over } }));
    const gate = a.gates.find((g) => g.key === "consent");
    assert.equal(gate.met, false, `consent should fail for ${JSON.stringify(over)}`);
    assert.match(gate.blockers.join(" "), expected);
  }
});

test("a thin corpus blocks the foundation, whatever else is true", () => {
  // The archive's own ceiling: the enrichment pipeline emits at most 13 chunks
  // from a single section, so this gate is cleared by the scholar contributing
  // work, not by waiting.
  const a = assess(fullySignals({ evidenceChunks: 4, fullUseWords: 900, sourceSections: 1 }));
  const gate = a.gates.find((g) => g.key === "corpus");
  assert.equal(gate.met, false);
  assert.equal(gate.blockers.length, 3, "each shortfall is named separately");
  assert.equal(a.foundationMet, false);
});

test("every gate failure tells the scholar what to do about it", () => {
  // A gate that returns only "false" produces a support ticket.
  const a = assess({ now: new Date(), currentConsentVersion: CONSENT_VERSION });
  for (const gate of a.gates) {
    assert.equal(gate.met, false);
    assert.ok(gate.summary && gate.summary.length > 20, `${gate.key} has no remedy`);
    assert.ok(gate.blockers.length > 0, `${gate.key} failed without saying why`);
    assert.ok(gate.measured && typeof gate.measured === "object", `${gate.key} shows no measurement`);
    assert.ok(
      !/invalid|denied|refused|failed|error/i.test(gate.summary),
      `${gate.key} remedy reads as blame: "${gate.summary}"`,
    );
  }
});

test("missing signals are treated as zero, never as passing", () => {
  // The dangerous shape of a bug here is a gate that passes on undefined.
  const a = assess({ currentConsentVersion: CONSENT_VERSION });
  assert.equal(a.allMet, false);
  assert.equal(a.foundationMet, false);
  for (const gate of a.gates) assert.equal(gate.met, false, `${gate.key} passed on empty signals`);
});

test("every gate has a key, a title and an evaluator", () => {
  const keys = new Set();
  for (const g of GATES) {
    assert.ok(g.key && !keys.has(g.key), `duplicate or missing gate key: ${g.key}`);
    keys.add(g.key);
    assert.ok(g.title?.length > 4, `${g.key} has no title`);
    assert.equal(typeof g.evaluate, "function");
  }
  assert.deepEqual([...keys], ["corpus", "record", "calibration", "consent"]);
});

/* ── reconciliation ──────────────────────────────────────────────────────── */

test("standing is lost the moment a gate stops holding", () => {
  const r = reconcile({
    current: STANDING.STANDING,
    signals: fullySignals({ consent: { accepted: false } }),
  });
  assert.equal(r.standing, STANDING.SUSPENDED);
  assert.equal(r.changed, true);
});

test("standing is never granted by reconciliation", () => {
  // Clearing every gate makes a scholar eligible. A person still signs.
  const r = reconcile({ current: STANDING.CALIBRATING, signals: fullySignals() });
  assert.notEqual(r.standing, STANDING.STANDING);
  assert.equal(r.changed, false);

  assert.equal(assess(fullySignals()).eligible, true);
});

test("a candidate who clears the foundation moves into calibration on its own", () => {
  const r = reconcile({
    current: STANDING.CANDIDATE,
    signals: fullySignals({ calibrationGraded: 0, calibrationAgreed: 0 }),
  });
  assert.equal(r.standing, STANDING.CALIBRATING);
  assert.equal(r.changed, true);
});

test("withdrawal is never undone by the system", () => {
  // Fresh, perfect signals must not quietly reinstate someone who said stop.
  const r = reconcile({ current: STANDING.WITHDRAWN, signals: fullySignals() });
  assert.equal(r.standing, STANDING.WITHDRAWN);
  assert.equal(r.changed, false);

  // And a contemporary scholar is never opted in for them.
  const c = reconcile({ current: STANDING.CONTEMPORARY, signals: fullySignals() });
  assert.equal(c.standing, STANDING.CONTEMPORARY);
  assert.equal(c.changed, false);
});

test("thresholds are documented numbers, not accidents", () => {
  for (const [key, value] of Object.entries(THRESHOLDS)) {
    assert.ok(Number.isFinite(value) && value > 0, `${key} is not a usable threshold`);
  }
  assert.ok(THRESHOLDS.MIN_SUBSTANTIVE_RESPONSES >= 1, "a floor of 0 disables the rubber-stamp guard");
  assert.ok(THRESHOLDS.PUBLICATION_SAMPLE >= 1);
  assert.ok(THRESHOLDS.MIN_CALIBRATION_AGREEMENT <= 1);
});
