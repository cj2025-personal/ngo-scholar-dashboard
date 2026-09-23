/**
 * Legacy as a benchmark, tested for the properties that make it one.
 *
 * A benchmark has to be reachable, has to say what is left, and must not take
 * back work already done. A flag on a record has none of those properties,
 * which is what this replaces.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const standing = require("../src/lib/legacyStanding");

/** A scholar who clears everything. */
const FULL = {
  sourcesOnRecord: 6,
  fullUseSources: 2,
  publishedStories: 4,
  approvedLevels: 5,
  substantiveResponses: 2,
};

const at = (over) => standing.assess({ ...FULL, ...over });

test("every gate holding is Legacy, and is the only thing that is", () => {
  const a = at({});
  assert.equal(a.standing, standing.STANDING.LEGACY);
  assert.equal(a.eligible, true);
  assert.equal(a.met, 3);
  assert.equal(a.blocking.length, 0);
  assert.equal(a.nextStep, null);
});

test("one gate short is named, so the dashboard can invite rather than refuse", () => {
  const a = at({ approvedLevels: 0, publishedStories: 0, substantiveResponses: 0 });
  assert.equal(a.standing, standing.STANDING.APPROACHING);
  assert.equal(a.nextStep.key, "archivyn");
  /* The blockers are the sentence a scholar acts on. */
  assert.ok(a.nextStep.blockers.some((b) => /reading levels approved/.test(b)));
  assert.ok(a.nextStep.blockers.some((b) => /articles published/.test(b)));
});

test("two gates short is contemporary, with everything still measured", () => {
  const a = at({ sourcesOnRecord: 0, fullUseSources: 0 });
  assert.equal(a.standing, standing.STANDING.CONTEMPORARY);
  assert.equal(a.nextStep, null, "no single next step when two things are missing");
  assert.equal(a.met, 1);
  /* One blocker from each unmet gate: papers on record, and a licence. */
  assert.equal(a.blocking.length, 2);
});

/**
 * The half that did not exist before. A scholar whose public record is thin
 * but who has done the work here must be able to see that it counted.
 */
test("Archivyn work is measured on its own, and counts toward the benchmark", () => {
  const thin = at({ publishedStories: 0, approvedLevels: 0, substantiveResponses: 0 });
  const busy = at({});
  const gate = (a) => a.gates.find((g) => g.key === "archivyn");
  assert.equal(gate(thin).met, false);
  assert.equal(gate(busy).met, true);
  assert.deepEqual(gate(busy).measured, { published: 4, levels: 5, responses: 2 });
});

test("Archivyn work alone does not clear the benchmark", () => {
  /* Prolific here, nothing on the public record: the scholarship gates still
     hold it, which is the documented policy rather than an accident. */
  const a = at({ sourcesOnRecord: 0, fullUseSources: 0, publishedStories: 40, approvedLevels: 40 });
  assert.equal(a.eligible, false);
  assert.notEqual(a.standing, standing.STANDING.LEGACY);
  assert.equal(standing.ARCHIVYN_WORK_ALONE_SUFFICES, false);
  assert.equal(a.policy.archivynWorkAloneSuffices, false);
});

test("approving a level is what moves the mission gate, not generating one", () => {
  /* Levels written but never approved are invisible to readers, so they do
     not count. This is the distinction the whole product turns on. */
  const unapproved = at({ approvedLevels: 0 });
  assert.equal(unapproved.gates.find((g) => g.key === "archivyn").met, false);
  assert.equal(at({ approvedLevels: standing.THRESHOLDS.MIN_APPROVED_LEVELS }).eligible, true);
});

test("a licence, not a volume, decides whether work can be built on", () => {
  const quotesOnly = at({ fullUseSources: 0 });
  const gate = quotesOnly.gates.find((g) => g.key === "sources");
  assert.equal(gate.met, false);
  /* The remedy has to name the act, because "publish more" would be useless. */
  assert.match(gate.summary, /preprint|accepted manuscript|lecture notes/);
});

/* ── Reconciliation: what is written down, given what was there before ───── */

test("work already done is never taken back", () => {
  /* A paper withdrawn from the archive drops a gate. Legacy stays. */
  const dropped = at({ sourcesOnRecord: 0 });
  const r = standing.reconcile({ current: standing.STANDING.LEGACY, assessment: dropped });
  assert.equal(r.standing, standing.STANDING.LEGACY);
  assert.equal(r.changed, false);
  assert.match(r.reason, /not taken back/);
  assert.equal(standing.STANDING_IS_LOSABLE, false);
});

test("the scholar withdrawing is the one move downward", () => {
  const a = standing.assess({ ...FULL, withdrawn: true });
  assert.equal(a.standing, standing.STANDING.WITHDRAWN);
  const r = standing.reconcile({ current: standing.STANDING.LEGACY, assessment: a });
  assert.equal(r.standing, standing.STANDING.WITHDRAWN);
  assert.equal(r.changed, true);
});

test("rising is recorded as a change, so something can be said about it", () => {
  const r = standing.reconcile({ current: standing.STANDING.APPROACHING, assessment: at({}) });
  assert.equal(r.standing, standing.STANDING.LEGACY);
  assert.equal(r.changed, true);
  assert.match(r.reason, /every gate holds/);
});

test("only Legacy opens the generative half", () => {
  assert.equal(standing.mayDraft(standing.STANDING.LEGACY), true);
  assert.equal(standing.mayDraft(standing.STANDING.APPROACHING), false);
  assert.equal(standing.mayDraft(standing.STANDING.CONTEMPORARY), false);
  assert.equal(standing.mayDraft(standing.STANDING.WITHDRAWN), false);
});

test("missing signals read as zero, never as met", () => {
  /* A scholar the gatherer could not measure must not be promoted by the
     absence of evidence. */
  const a = standing.assess({});
  assert.equal(a.eligible, false);
  assert.equal(a.met, 0);
});

/**
 * Turning a benchmark on must not take anything away.
 *
 * Legacy was a flag on 65 curated records. Replacing it with gates that some
 * of those 65 would not clear would be a silent demotion of scholars who did
 * nothing wrong, so the flag seeds the benchmark rather than being replaced
 * by it.
 */
test("a scholar the record already names keeps Legacy, gates or no gates", () => {
  const bare = standing.assess({ grandfathered: true });
  assert.equal(bare.standing, standing.STANDING.LEGACY);
  assert.equal(bare.eligible, false, "eligibility still reports what the gates say");
  assert.equal(bare.grandfathered, true);
  /* And the measurements are still returned: holding Legacy is not a reason
     to be told less about your own record. */
  assert.equal(bare.gates.length, 3);
  assert.ok(bare.blocking.length > 0);
});

test("a scholar who earns it is not marked grandfathered", () => {
  const earned = at({ grandfathered: true });
  assert.equal(earned.standing, standing.STANDING.LEGACY);
  assert.equal(earned.eligible, true);
  assert.equal(earned.grandfathered, false, "earned outranks inherited");
});

test("withdrawing still outranks the record's flag", () => {
  const a = standing.assess({ ...FULL, grandfathered: true, withdrawn: true });
  assert.equal(a.standing, standing.STANDING.WITHDRAWN);
});
