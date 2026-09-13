/**
 * The lifecycle of a scholar's correction request.
 *
 * ── What this is for ───────────────────────────────────────────────────────
 * Archivyn publishes claims about 9,925 named individuals, curated from public
 * sources. Those people have no other way to correct the record. That is a
 * right of reply, and a right of reply that goes into a box nobody empties is
 * not one — which is what existed before this file: requests were stored with
 * `status: "open"` and nothing ever moved them.
 *
 * ── A correction is never a direct edit ────────────────────────────────────
 * The `scholars` collection is curated and is owned by the curation pipeline;
 * neither application service may write it (see `db/ownership.js`). So
 * accepting a correction does NOT change the scholar record here. It records a
 * decision, and the curation pipeline applies it.
 *
 * That separation is deliberate rather than incidental. A curated record that
 * any authenticated request could rewrite would make the platform's central
 * claim — that this is researched, sourced material — untrue the first time
 * someone edited themselves a better biography.
 */

const STATUS = {
  /** Submitted by the scholar. Nobody has looked yet. */
  OPEN: "open",
  /** An admin has read it and accepted it as a real correction. */
  ACCEPTED: "accepted",
  /** An admin has read it and declined, with a reason the scholar sees. */
  REJECTED: "rejected",
  /** The curation pipeline has changed the record. Terminal. */
  APPLIED: "applied",
  /** Withdrawn by the scholar before anyone acted. Terminal. */
  WITHDRAWN: "withdrawn",
};

const TERMINAL = [STATUS.REJECTED, STATUS.APPLIED, STATUS.WITHDRAWN];

/**
 * Every move a correction can make, and who may make it.
 *
 * Written as a table for the same reason the mission state machine is: a
 * reviewer can read this and know every path a request can take, which is not
 * true of transitions scattered across handlers.
 */
const TRANSITIONS = [
  { from: STATUS.OPEN, to: STATUS.ACCEPTED, actors: ["admin"], reason: "accepted for correction" },
  { from: STATUS.OPEN, to: STATUS.REJECTED, actors: ["admin"], reason: "declined, with a reason" },
  { from: STATUS.OPEN, to: STATUS.WITHDRAWN, actors: ["scholar"], reason: "withdrawn by the scholar" },
  /* Only the curation pipeline can say a record actually changed, because only
     it writes the record. An admin accepting is a decision, not an edit. */
  { from: STATUS.ACCEPTED, to: STATUS.APPLIED, actors: ["curation"], reason: "the record was updated" },
  /* An accepted correction can still be declined later — curation may find the
     public sources do not support it. Better to reverse openly than to leave a
     scholar believing a change is coming that never arrives. */
  { from: STATUS.ACCEPTED, to: STATUS.REJECTED, actors: ["admin", "curation"], reason: "could not be substantiated" },
  { from: STATUS.ACCEPTED, to: STATUS.WITHDRAWN, actors: ["scholar"], reason: "withdrawn by the scholar" },
];

function isTerminal(status) {
  return TERMINAL.includes(status);
}

/**
 * May this actor move this correction to this status?
 *
 * Returns a verdict rather than a boolean so a refusal can say why — a scholar
 * told only "no" will email support, and an admin told only "no" will assume a
 * bug.
 */
function canTransition({ from, to, actor }) {
  if (!from || !to) {
    return { ok: false, code: "UNKNOWN_STATUS", message: "That status doesn't exist." };
  }

  if (isTerminal(from)) {
    return {
      ok: false,
      code: "TERMINAL",
      message: `This request is already ${from} and can't change again.`,
    };
  }

  const match = TRANSITIONS.find((t) => t.from === from && t.to === to);
  if (!match) {
    return {
      ok: false,
      code: "NO_SUCH_TRANSITION",
      message: `A request can't go from ${from} to ${to}.`,
    };
  }

  if (!match.actors.includes(actor)) {
    return {
      ok: false,
      code: "WRONG_ACTOR",
      message: `Only ${match.actors.join(" or ")} can do that.`,
    };
  }

  return { ok: true, reason: match.reason };
}

/**
 * A decision must carry a reason the scholar can read.
 *
 * ── Why rejection requires one and acceptance does not ─────────────────────
 * An accepted correction explains itself: the record changes. A rejected one
 * does not — the scholar reported that something about them is wrong, and
 * silence reads as "we did not believe you". They are entitled to know why, and
 * requiring it here means no admin can decline in one click without thinking.
 */
function decisionRequiresNote(to) {
  return to === STATUS.REJECTED;
}

/** What the scholar sees for each status. Plain, and never blaming. */
const STATUS_LABELS = {
  [STATUS.OPEN]: "Waiting for review",
  [STATUS.ACCEPTED]: "Accepted — the record will be updated",
  [STATUS.REJECTED]: "Not changed",
  [STATUS.APPLIED]: "Updated",
  [STATUS.WITHDRAWN]: "Withdrawn",
};

/**
 * How long a request has been waiting, in whole days.
 *
 * Surfaced because a right of reply with no clock is a suggestion box. A
 * scholar who can see "waiting 34 days" has something to point at; so does
 * anyone auditing whether this platform answers the people it publishes about.
 */
function daysWaiting(createdAt, now = new Date()) {
  if (!createdAt) return null;
  const created = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (Number.isNaN(created.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - created.getTime()) / 86_400_000));
}

module.exports = {
  STATUS,
  TERMINAL,
  TRANSITIONS,
  STATUS_LABELS,
  isTerminal,
  canTransition,
  decisionRequiresNote,
  daysWaiting,
};
