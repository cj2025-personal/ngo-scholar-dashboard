/**
 * The correction lifecycle, tested for the ways a right of reply fails.
 *
 * The failure this file exists to prevent is not a crash. It is a request
 * disappearing: submitted, stored, and never answered. Before this, every
 * correction was written with `status: "open"` and nothing could move it.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  STATUS,
  TERMINAL,
  TRANSITIONS,
  STATUS_LABELS,
  isTerminal,
  canTransition,
  decisionRequiresNote,
  daysWaiting,
} = require("../src/lib/corrections");

test("an admin can accept or decline an open request", () => {
  assert.equal(canTransition({ from: STATUS.OPEN, to: STATUS.ACCEPTED, actor: "admin" }).ok, true);
  assert.equal(canTransition({ from: STATUS.OPEN, to: STATUS.REJECTED, actor: "admin" }).ok, true);
});

test("only the curation pipeline can say the record actually changed", () => {
  // An admin accepting is a decision. The scholars collection is curated and
  // owned by the pipeline — no application service writes it — so only the
  // pipeline is in a position to report that an edit happened.
  assert.equal(
    canTransition({ from: STATUS.ACCEPTED, to: STATUS.APPLIED, actor: "curation" }).ok,
    true,
  );

  const byAdmin = canTransition({ from: STATUS.ACCEPTED, to: STATUS.APPLIED, actor: "admin" });
  assert.equal(byAdmin.ok, false);
  assert.equal(byAdmin.code, "WRONG_ACTOR");

  const byScholar = canTransition({ from: STATUS.ACCEPTED, to: STATUS.APPLIED, actor: "scholar" });
  assert.equal(byScholar.ok, false);
});

test("a scholar can withdraw their own request but cannot decide it", () => {
  assert.equal(canTransition({ from: STATUS.OPEN, to: STATUS.WITHDRAWN, actor: "scholar" }).ok, true);

  // The thing that would make this a self-service edit rather than a request.
  const selfAccept = canTransition({ from: STATUS.OPEN, to: STATUS.ACCEPTED, actor: "scholar" });
  assert.equal(selfAccept.ok, false);
  assert.equal(selfAccept.code, "WRONG_ACTOR");
});

test("a decided request cannot be quietly re-decided", () => {
  for (const from of TERMINAL) {
    for (const to of Object.values(STATUS)) {
      const verdict = canTransition({ from, to, actor: "admin" });
      assert.equal(verdict.ok, false, `${from} → ${to} must be refused`);
      assert.equal(verdict.code, "TERMINAL");
    }
  }
});

test("an accepted correction can still be declined later", () => {
  // Curation may find the public sources do not support it. Reversing openly
  // beats leaving a scholar expecting a change that never arrives.
  assert.equal(
    canTransition({ from: STATUS.ACCEPTED, to: STATUS.REJECTED, actor: "curation" }).ok,
    true,
  );
  assert.equal(
    canTransition({ from: STATUS.ACCEPTED, to: STATUS.REJECTED, actor: "admin" }).ok,
    true,
  );
});

test("undeclared moves are refused with a reason, not a bare false", () => {
  const skipped = canTransition({ from: STATUS.OPEN, to: STATUS.APPLIED, actor: "curation" });
  assert.equal(skipped.ok, false);
  assert.equal(skipped.code, "NO_SUCH_TRANSITION");
  assert.match(skipped.message, /can't go from open to applied/);

  const unknown = canTransition({ from: "invented", to: STATUS.ACCEPTED, actor: "admin" });
  assert.equal(unknown.ok, false);

  for (const bad of [{ from: null, to: STATUS.ACCEPTED }, { from: STATUS.OPEN, to: null }]) {
    assert.equal(canTransition({ ...bad, actor: "admin" }).ok, false);
  }
});

test("declining requires a reason the scholar can read", () => {
  // A scholar reported that something about them is wrong. Silence reads as
  // "we didn't believe you", and requiring a note means nobody declines in one
  // click without thinking.
  assert.equal(decisionRequiresNote(STATUS.REJECTED), true);
  assert.equal(decisionRequiresNote(STATUS.ACCEPTED), false);
  assert.equal(decisionRequiresNote(STATUS.APPLIED), false);
});

test("every status is reachable and every request can reach an end", () => {
  // A status nobody can reach is dead code; one nobody can leave is a request
  // stuck forever, which is the failure this whole file is about.
  const reachable = new Set([STATUS.OPEN]);
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

  for (const status of Object.values(STATUS)) {
    assert.ok(reachable.has(status), `${status} is unreachable`);
  }

  for (const status of Object.values(STATUS)) {
    if (isTerminal(status)) continue;
    const escapes = TRANSITIONS.filter((t) => t.from === status);
    assert.ok(escapes.length > 0, `${status} is a dead end`);
  }
});

test("every status has wording a scholar can read, and none of it blames them", () => {
  for (const status of Object.values(STATUS)) {
    const label = STATUS_LABELS[status];
    assert.ok(label && label.length > 2, `no label for ${status}`);
    assert.ok(
      !/invalid|wrong|denied|refused|failed/i.test(label),
      `${status} label reads as blame: "${label}"`,
    );
  }
  // "Not changed" rather than "rejected" — the scholar did nothing wrong by asking.
  assert.equal(STATUS_LABELS[STATUS.REJECTED], "Not changed");
});

test("the wait is measurable", () => {
  // A right of reply with no clock is a suggestion box. "Waiting 34 days" is
  // something a scholar — or an auditor — can point at.
  const now = new Date("2026-09-11T12:00:00Z");
  assert.equal(daysWaiting(new Date("2026-09-11T11:00:00Z"), now), 0);
  assert.equal(daysWaiting(new Date("2026-09-10T11:00:00Z"), now), 1);
  assert.equal(daysWaiting(new Date("2026-08-08T12:00:00Z"), now), 34);
  assert.equal(daysWaiting("2026-08-08T12:00:00Z", now), 34, "an ISO string is still a date");

  // Never negative, never a crash on rubbish.
  assert.equal(daysWaiting(new Date("2026-09-12T12:00:00Z"), now), 0);
  assert.equal(daysWaiting(null, now), null);
  assert.equal(daysWaiting("not a date", now), null);
});

test("every declared transition names at least one actor", () => {
  // A transition with no actor can never fire, which is a silently dead path.
  for (const t of TRANSITIONS) {
    assert.ok(Array.isArray(t.actors) && t.actors.length > 0, `${t.from} → ${t.to} has no actor`);
    assert.ok(t.reason && t.reason.length > 4, `${t.from} → ${t.to} has no reason`);
  }
});
