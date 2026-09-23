"use strict";

/**
 * Legacy: a benchmark a scholar reaches, not a list they are put on.
 *
 * ── What changed, and why ──────────────────────────────────────────────────
 * Legacy was `status: "legacy"` on the curated record — 65 scholars, set by
 * the curation pipeline, checked in exactly one place (`legacyGate` in
 * draftEligibility.js) to decide who may draft from their own research. As a
 * membership flag it answered "are you on the list", which is a question a
 * scholar can neither see the answer to nor do anything about.
 *
 * It is meant to be a benchmark: a reading of the work a scholar has done.
 * That makes it computable, which makes it visible, which makes it
 * approachable — the three properties a membership flag cannot have.
 *
 * ── The two halves ─────────────────────────────────────────────────────────
 * The work that was already theirs when they arrived — papers, the areas they
 * span, the material we are licensed to hold — and the work they do here:
 * articles published for readers outside their field, reading levels approved
 * so a child can read them, corrections filed against their own record.
 *
 * The second half is the one this file exists to add. A scholar who arrives
 * with a thin public record and then writes six articles and levels all of
 * them has done the thing this product is for, and the old flag could not see
 * it.
 *
 * ── Two policy decisions, made explicit rather than buried ─────────────────
 * Both are stated as constants so they can be argued with.
 *
 * ARCHIVYN_WORK_ALONE_SUFFICES = false. A benchmark for scholarship cannot be
 * cleared purely by activity on one platform; the body of work gate has to
 * hold. Archivyn work is weighted heavily inside the benchmark, and it is what
 * most scholars will actually move, but it does not replace the scholarship.
 *
 * STANDING_IS_LOSABLE = false, with one exception. Work done is done, so
 * inactivity never demotes — this is the opposite of `voiceStanding`, and
 * deliberately: that file governs permission to impersonate a living person,
 * where a lapsed consent must revoke instantly. Here the only thing that
 * suspends Legacy is the scholar withdrawing, because that is a statement
 * about permission and not about achievement.
 */

const STANDING = {
  /** The default. Everything a scholar can see about themselves, and nothing generative. */
  CONTEMPORARY: "contemporary",
  /** Every gate but one, and that one is within reach. Shown so it can be finished. */
  APPROACHING: "approaching",
  /** The benchmark is met. */
  LEGACY: "legacy",
  /** Met, then withdrawn by the scholar. Recoverable by them, not by us. */
  WITHDRAWN: "withdrawn",
};

/** Archivyn work counts toward the benchmark; it does not replace scholarship. */
const ARCHIVYN_WORK_ALONE_SUFFICES = false;
/** Work already done is not taken back for inactivity. */
const STANDING_IS_LOSABLE = false;

/**
 * Thresholds, each with the measurement behind it.
 *
 * The scholarship numbers are deliberately the same shape as
 * `voiceStanding.THRESHOLDS` so the two benchmarks can be read side by side,
 * and deliberately lower: Legacy grants the right to draft from your own work,
 * not the right to be spoken as. The bar for putting words in a living
 * person's mouth is higher than the bar for that person writing about
 * themselves with help.
 *
 * The Archivyn numbers are set where a scholar has plainly used the product
 * for its purpose rather than tried it once. One published article is a trial;
 * three with levels approved is a practice.
 */
const THRESHOLDS = {
  /* Papers of theirs we hold, under any licence. Measured from the same
     classified source list the composer uses, so "on record" means here what
     it means everywhere else. Three, so the record is a body of work rather
     than a single result.

     This deliberately does not measure indexed evidence chunks or distinct
     sections of the corpus, which is how `voiceStanding` frames the same
     question. Those signals have no gatherer anywhere in this service, and a
     benchmark resting on a number nothing computes would read as zero for
     every scholar alive. */
  MIN_SOURCES_ON_RECORD: 3,
  /* One paper the scholar holds the rights to. The licence, not the count, is
     what decides whether we may build on it — see draftEligibility. */
  MIN_FULL_USE_SOURCES: 1,

  /* Archivyn. Published, not drafted: a draft is an intention. */
  MIN_PUBLISHED_STORIES: 3,
  /* Approved, not generated: generating is a machine act, approving is the
     scholar's. This is the number that carries the mission. */
  MIN_APPROVED_LEVELS: 3,
  /* One substantive response to their own record — a correction filed, or a
     paper contributed. The same act clears the sources gate, which is
     intended: one action, two gates, and it is the action we want. */
  MIN_SUBSTANTIVE_RESPONSES: 1,
};

function num(v) {
  return Number.isFinite(v) ? v : 0;
}

function verdict(failures, { met, remedy, measured }) {
  return failures.length === 0
    ? { met: true, summary: met, blockers: [], measured }
    : { met: false, summary: remedy, blockers: failures, measured };
}

/**
 * The three gates.
 *
 * Each is a pure function of an already-gathered `signals` object, so this
 * file is testable without a database and the same definitions can be
 * evaluated against a hypothetical scholar in an admin preview.
 *
 * Every gate returns whether it holds, a sentence the scholar can read, and
 * the measurements behind it. A gate that returns only `false` produces a
 * support ticket.
 */
const GATES = [
  {
    key: "work",
    title: "A body of work",
    /* The half that was theirs before they arrived. Not a judgement of
       quality — we are in no position to make one — but a measure of whether
       there is enough on the record to build on at all. */
    evaluate(s) {
      const onRecord = num(s.sourcesOnRecord);
      const failures = [];
      if (onRecord < THRESHOLDS.MIN_SOURCES_ON_RECORD) {
        failures.push(`${onRecord} of ${THRESHOLDS.MIN_SOURCES_ON_RECORD} of your papers on the record`);
      }
      return verdict(failures, {
        met: "Your published work is on the record in enough depth to build on.",
        remedy:
          "Most of what we hold about you is third-party coverage. Adding your own papers puts your work on the " +
          "record in your terms, and it is the fastest way to clear this.",
        measured: { onRecord },
      });
    },
  },
  {
    key: "sources",
    title: "Work we may build on",
    /* Licence, not volume. A scholar with 200 papers we may quote only in
       fragments cannot be drafted from, and telling them to "publish more"
       would be useless advice. */
    evaluate(s) {
      const fullUse = num(s.fullUseSources);
      const failures = [];
      if (fullUse < THRESHOLDS.MIN_FULL_USE_SOURCES) {
        failures.push(`no paper you hold the rights to; we look for ${THRESHOLDS.MIN_FULL_USE_SOURCES}`);
      }
      return verdict(failures, {
        met: "We hold at least one paper of yours under a licence that lets us draft from it in full.",
        remedy:
          "Everything we hold of yours is licensed for short quotes only. Add a preprint, an accepted manuscript " +
          "or lecture notes you hold the rights to, and it can be built on in full.",
        measured: { fullUse },
      });
    },
  },
  {
    key: "archivyn",
    title: "Work done here",
    /* The half the old flag could not see. Published articles and, above all,
       levels approved: the mission is that a fourteen-year-old can read the
       research, and approving a level is the act that makes that true. */
    evaluate(s) {
      const published = num(s.publishedStories);
      const levels = num(s.approvedLevels);
      const responses = num(s.substantiveResponses);
      const failures = [];
      if (published < THRESHOLDS.MIN_PUBLISHED_STORIES) {
        failures.push(`${published} of ${THRESHOLDS.MIN_PUBLISHED_STORIES} articles published`);
      }
      if (levels < THRESHOLDS.MIN_APPROVED_LEVELS) {
        failures.push(`${levels} of ${THRESHOLDS.MIN_APPROVED_LEVELS} reading levels approved for younger readers`);
      }
      if (responses < THRESHOLDS.MIN_SUBSTANTIVE_RESPONSES) {
        failures.push("no correction filed and no paper contributed");
      }
      return verdict(failures, {
        met: "You have written for readers outside your field and approved the versions younger readers see.",
        remedy:
          "This is the half of the benchmark you move directly: publish an article drawn from your work, and " +
          "approve the versions written for younger readers so they are actually shown.",
        measured: { published, levels, responses },
      });
    },
  },
];

/**
 * Where a scholar stands, and what would move them.
 *
 * Returns an assessment, never a decision: persisting it, and deciding what
 * it unlocks, belongs to the service. `eligible` means every gate holds.
 */
function assess(signals) {
  const s = { now: new Date(), ...signals };
  const gates = GATES.map((g) => ({ key: g.key, title: g.title, ...g.evaluate(s) }));
  const met = gates.filter((g) => g.met).length;
  const unmet = gates.filter((g) => !g.met);
  const eligible = unmet.length === 0;

  /* One gate short is a different thing from three, because it is the only
     state where telling a scholar what is left is an invitation rather than a
     wall. It is named so the dashboard can treat it differently. */
  /* `grandfathered` is the curated record's existing `status: "legacy"`. The
     65 scholars already named keep it whether or not the computed gates hold,
     so turning the benchmark on takes nothing away from anyone — the change is
     purely additive on day one. Their gates are still measured and returned,
     because a scholar who holds Legacy is owed the same account of why as one
     who does not. */
  const standing = s.withdrawn
    ? STANDING.WITHDRAWN
    : eligible || s.grandfathered
    ? STANDING.LEGACY
    : unmet.length === 1
    ? STANDING.APPROACHING
    : STANDING.CONTEMPORARY;

  return {
    standing,
    gates,
    met,
    total: gates.length,
    eligible,
    /* Held by the record rather than earned by the gates. Worth distinguishing:
       it is the difference between "you have met this" and "you were here
       before it was measured". */
    grandfathered: Boolean(s.grandfathered) && !eligible,
    /* The single next thing, when there is a single next thing. */
    nextStep: unmet.length === 1 ? { key: unmet[0].key, title: unmet[0].title, summary: unmet[0].summary, blockers: unmet[0].blockers } : null,
    blocking: unmet.flatMap((g) => g.blockers),
    policy: { archivynWorkAloneSuffices: ARCHIVYN_WORK_ALONE_SUFFICES, losable: STANDING_IS_LOSABLE },
  };
}

/**
 * What the stored standing should become, given an assessment and what is
 * already on file.
 *
 * Because standing is not losable, a scholar who has reached Legacy keeps it
 * even if a gate later reads false — a paper withdrawn from the archive, a
 * story deleted. The only downward move is one the scholar makes themselves.
 */
function reconcile({ current, assessment }) {
  if (assessment.standing === STANDING.WITHDRAWN) {
    return { standing: STANDING.WITHDRAWN, changed: current !== STANDING.WITHDRAWN, reason: "the scholar withdrew" };
  }
  if (current === STANDING.LEGACY && !STANDING_IS_LOSABLE) {
    return { standing: STANDING.LEGACY, changed: false, reason: "work already done is not taken back" };
  }
  return {
    standing: assessment.standing,
    changed: current !== assessment.standing,
    reason: assessment.eligible ? "every gate holds" : `${assessment.met} of ${assessment.total} gates hold`,
  };
}

/** Does this standing open the generative half of the portal? */
function mayDraft(standing) {
  return standing === STANDING.LEGACY;
}

module.exports = {
  STANDING,
  THRESHOLDS,
  GATES,
  ARCHIVYN_WORK_ALONE_SUFFICES,
  STANDING_IS_LOSABLE,
  assess,
  reconcile,
  mayDraft,
};
