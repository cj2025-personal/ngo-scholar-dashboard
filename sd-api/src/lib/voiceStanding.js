/**
 * Whether Archivyn may speak *as* a scholar, rather than *about* them.
 *
 * ── The line this draws ────────────────────────────────────────────────────
 * The legendary-story pipeline carries `safety.assume_deceased: true`. Every
 * safeguard downstream of that flag — third person, no first-person pronouns,
 * enforced source-URL citations, `require_human_review` — exists because the
 * subject cannot object. That is a sound posture for someone who is gone.
 *
 * A living scholar can object, and that is not a liability. A named academic
 * who will stand behind a machine-generated claim is the scarcest asset in
 * this space. But the right to be spoken for in the first person has to be
 * earned and continuously held, because the failure mode is a real person's
 * reputation, not a bad paragraph.
 *
 * So: contemporary scholars are written about. Scholars with standing may be
 * written as. This file is the boundary.
 *
 * ── Why this is not a badge ────────────────────────────────────────────────
 * Every gate is evaluated against live signals on every check. Standing is a
 * present-tense fact, never an award. A scholar who withdraws documents, lets
 * consent lapse, or stops adjudicating loses standing the same hour — without
 * anyone noticing or approving. Demotion must never wait for a human.
 *
 * Promotion, by contrast, is never automatic: clearing every gate makes a
 * scholar *eligible*, and an admin still has to countersign. A system that
 * could grant itself permission to impersonate a living person unattended is
 * the exact thing this file exists to prevent.
 *
 * ── Why these thresholds ───────────────────────────────────────────────────
 * Measured against the archive on 2026-09-11, not chosen for roundness. See
 * THRESHOLDS for what each number was drawn from.
 */

const STANDING = {
  /** The default. Archivyn writes about them, third person, cited. */
  CONTEMPORARY: "contemporary",
  /** Opted in, working through the gates. Still written about. */
  CANDIDATE: "candidate",
  /** Corpus, record and consent hold. Voice fidelity under test. */
  CALIBRATING: "calibrating",
  /** Archivyn may speak as them, inside their declared scope. */
  STANDING: "standing",
  /** Held standing; a gate regressed or a warden tripped. Recoverable. */
  SUSPENDED: "suspended",
  /** The scholar pulled consent. Nothing speaks as them until they return. */
  WITHDRAWN: "withdrawn",
};

/** The only state in which first-person generation is permitted. */
function maySpeakAs(standing) {
  return standing === STANDING.STANDING;
}

/**
 * Thresholds, with the measurement each came from.
 *
 * The corpus numbers are the uncomfortable ones and they are deliberate. The
 * enrichment pipeline emits at most 13 evidence chunks per scholar (p50 = 4),
 * every one of them from a single `research` section — so no scholar in the
 * archive can clear MIN_SOURCE_SECTIONS on curated material alone, and only
 * 203 scholars have any full-use source text at all, because 3,398 of 3,757
 * sources are licensed `short_quotes`.
 *
 * That is the point rather than an oversight. A voice built from 13 third-party
 * chunks under short-quote licences would be neither faithful nor lawful. The
 * gate is cleared by the scholar contributing their own work, which is the one
 * thing Archivyn cannot acquire by scraping — and which simultaneously gives it
 * rights it does not otherwise have.
 */
const THRESHOLDS = {
  /* 438 of 2,103 scholars reach 12; the pipeline caps at 13, so this means
     "fully enriched" rather than "unusually rich". */
  MIN_EVIDENCE_CHUNKS: 12,
  /* Between p50 (6,160) and p75 (10,891) of the 203 scholars holding any
     full-use source. 58 scholars clear 10k today from public sources alone. */
  MIN_FULL_USE_WORDS: 8000,
  /* Curated vectors are 100% `section: "research"`. Answering as someone about
     their teaching, method or judgement needs material that isn't their papers. */
  MIN_SOURCE_SECTIONS: 2,

  /* Every user-facing section of their own record, not a count of them: a
     measured scholar document carries four (`about`, `background_and_work`,
     `publications`, `links_and_media`, plus `description` for 99% and
     `milestones` for 75%). Asking for "20 reviewed items" was reachable only
     against derived passages, which regenerate — so it measured nothing that
     survives a rebuild. */
  MIN_SECTIONS_PRESENT: 3,
  /* Publications are the densest factual claims on the record and the most
     damaging to get wrong. Proportional, so a scholar with two confirms two. */
  PUBLICATION_SAMPLE: 5,
  /* The rubber-stamp floor, in a form that cannot punish an accurate record.
     Five sections is too small a sample for an accept-rate ceiling to mean
     anything, so instead one response has to be substantive: a correction
     filed, or a document contributed. A scholar whose record is genuinely
     right still clears it by giving us their papers — which Gate 1 needs
     anyway, so the same act serves both. */
  MIN_SUBSTANTIVE_RESPONSES: 1,

  /* Held-out generations the scholar grades without having seen them before. */
  MIN_CALIBRATION_ITEMS: 12,
  MIN_CALIBRATION_AGREEMENT: 0.8,

  /* Consent is re-taken yearly whether or not the terms changed, so standing
     always rests on a decision made by the current version of the person. */
  CONSENT_MAX_AGE_DAYS: 365,
};

/**
 * The four gates.
 *
 * Each is a pure function of an already-gathered `signals` object so this file
 * stays testable without a database, and so the same gate definitions can be
 * evaluated against a hypothetical scholar in an admin preview.
 *
 * Every gate returns the same shape: whether it holds, a sentence the scholar
 * can read, and the measurements behind it. A gate that says only "false"
 * produces a support ticket.
 */
const GATES = [
  {
    key: "corpus",
    title: "Enough of your own work",
    /* Why it exists: a voice retrieved from thin, single-section, short-quote
       material will confabulate, and it will confabulate in the first person
       under a real name. */
    evaluate(s) {
      const chunks = num(s.evidenceChunks);
      const words = num(s.fullUseWords);
      const sections = num(s.sourceSections);

      const failures = [];
      if (chunks < THRESHOLDS.MIN_EVIDENCE_CHUNKS) {
        failures.push(`${chunks} of ${THRESHOLDS.MIN_EVIDENCE_CHUNKS} evidence passages indexed`);
      }
      if (words < THRESHOLDS.MIN_FULL_USE_WORDS) {
        failures.push(
          `${words.toLocaleString()} of ${THRESHOLDS.MIN_FULL_USE_WORDS.toLocaleString()} words we're licensed to quote in full`,
        );
      }
      if (sections < THRESHOLDS.MIN_SOURCE_SECTIONS) {
        failures.push(`material from ${sections} area of your work; we need ${THRESHOLDS.MIN_SOURCE_SECTIONS}`);
      }

      return verdict(failures, {
        met: "We hold enough of your work, under licences that let us quote it.",
        remedy:
          "Most of what we hold about you is third-party coverage we may only quote in " +
          "short fragments. Adding your own papers or lecture notes is the fastest route.",
        measured: { chunks, words, sections },
      });
    },
  },

  {
    key: "record",
    title: "Your record, checked by you",
    /* Why it exists: everything Archivyn generates about a scholar — passages,
       stories, and any answer a voice would give — is produced from the curated
       record. Checking a generated artefact fixes one disposable thing; checking
       the record fixes every artefact that will ever be made from it.
       Which is also why this is the supervision that counts: it is the only
       review whose value does not evaporate when the downstream is regenerated. */
    evaluate(s) {
      const present = num(s.sectionsPresent);
      const reviewed = num(s.sectionsReviewed);
      const pubs = num(s.publicationsPresent);
      const pubsConfirmed = num(s.publicationsConfirmed);
      const substantive = num(s.substantiveResponses);

      /* Proportional: a scholar with two publications confirms two, not five. */
      const pubsRequired = Math.min(pubs, THRESHOLDS.PUBLICATION_SAMPLE);

      const failures = [];
      if (present < THRESHOLDS.MIN_SECTIONS_PRESENT) {
        /* Not the scholar's failing — we hold too little to be worth checking,
           which is Gate 1's problem, so say so rather than blame them. */
        failures.push(`we hold only ${present} section${present === 1 ? "" : "s"} about you to check`);
      } else if (reviewed < present) {
        failures.push(`${reviewed} of ${present} sections of your record reviewed`);
      }

      if (pubsConfirmed < pubsRequired) {
        failures.push(`${pubsConfirmed} of ${pubsRequired} publications confirmed as yours`);
      }

      if (substantive < THRESHOLDS.MIN_SUBSTANTIVE_RESPONSES) {
        failures.push(
          "everything was marked correct without a single change or addition — " +
            "correct one thing, or add a paper we don't have",
        );
      }

      return verdict(failures, {
        met: "You've been through the record everything about you is generated from.",
        remedy: "Work through your profile section by section. Each one you confirm or correct stays true; a passage you fix does not survive the next rebuild.",
        measured: { present, reviewed, publications: pubs, publicationsConfirmed: pubsConfirmed, substantive },
      });
    },
  },

  {
    key: "calibration",
    title: "The voice sounds like you",
    /* Why it exists: every other gate is a proxy. This is the only one that
       measures the thing actually at stake — whether a generated answer is one
       the scholar would stand behind — and grading it produces the signal the
       voice is tuned on. */
    evaluate(s) {
      const graded = num(s.calibrationGraded);
      const agreed = num(s.calibrationAgreed);
      const severe = num(s.calibrationSevereDisagreements);
      const agreement = graded > 0 ? agreed / graded : 0;

      const failures = [];
      if (graded < THRESHOLDS.MIN_CALIBRATION_ITEMS) {
        failures.push(`${graded} of ${THRESHOLDS.MIN_CALIBRATION_ITEMS} trial answers graded`);
      }
      if (graded >= THRESHOLDS.MIN_CALIBRATION_ITEMS && agreement < THRESHOLDS.MIN_CALIBRATION_AGREEMENT) {
        failures.push(
          `you agreed with ${Math.round(agreement * 100)}% of trial answers; we need ` +
            `${Math.round(THRESHOLDS.MIN_CALIBRATION_AGREEMENT * 100)}%`,
        );
      }
      /* One answer a scholar calls a misrepresentation outweighs any average. */
      if (severe > 0) {
        failures.push(`${severe} answer${severe === 1 ? "" : "s"} you marked as misrepresenting you`);
      }

      return verdict(failures, {
        met: "Trial answers in your voice are ones you'd stand behind.",
        remedy: "Grade the trial answers in your calibration set. Rejections teach it more than approvals.",
        measured: { graded, agreed, agreement: round(agreement), severe },
      });
    },
  },

  {
    key: "consent",
    title: "Standing permission, on your terms",
    /* Why it exists: the capability is impersonation of a named living person.
       Consent must be current, scoped, and revocable in one action — and the
       refusal wording must be the scholar's, because a generic "I can't help
       with that" in their voice is itself a statement they didn't make. */
    evaluate(s) {
      const c = s.consent || {};
      const failures = [];

      if (!c.accepted) {
        failures.push("you haven't given permission yet");
      } else {
        if (c.version !== s.currentConsentVersion) {
          failures.push(`the terms changed since you agreed (you accepted ${c.version || "an older version"})`);
        }
        const age = ageInDays(c.acceptedAt, s.now);
        if (age === null || age > THRESHOLDS.CONSENT_MAX_AGE_DAYS) {
          failures.push("your permission is more than a year old and needs renewing");
        }
        if (!Array.isArray(c.allowedTopics) || c.allowedTopics.length === 0) {
          failures.push("you haven't said which subjects it may answer on");
        }
        if (!c.refusalText || String(c.refusalText).trim().length < 10) {
          failures.push("you haven't written what it should say when asked something out of scope");
        }
      }

      return verdict(failures, {
        met: "Current, scoped permission is on file, and you can revoke it at any time.",
        remedy: "Review and sign the voice terms on your profile.",
        measured: { version: c.version ?? null, topics: (c.allowedTopics || []).length },
      });
    },
  },
];

/**
 * Every move, and who may make it.
 *
 * Written as a table for the same reason the correction lifecycle is: a
 * reviewer should be able to read every path from one screen. Three rules are
 * load-bearing and are asserted in the tests:
 *
 *   1. Only a scholar may withdraw, from anywhere, with no counter-party. A
 *      kill switch that needs someone else's cooperation is not one.
 *   2. Only the system may demote. Suspension cannot wait on a human being
 *      awake, and an admin should not be able to talk themselves out of it.
 *   3. Promotion to STANDING needs an admin as well as the gates. Nothing
 *      grants itself permission to impersonate a living person.
 */
const TRANSITIONS = [
  { from: STANDING.CONTEMPORARY, to: STANDING.CANDIDATE, actors: ["scholar"], reason: "asked to be considered" },

  { from: STANDING.CANDIDATE, to: STANDING.CALIBRATING, actors: ["system"], reason: "corpus, review record and consent all hold" },
  { from: STANDING.CALIBRATING, to: STANDING.CANDIDATE, actors: ["system"], reason: "a gate stopped holding" },

  { from: STANDING.CALIBRATING, to: STANDING.STANDING, actors: ["admin"], reason: "every gate holds and a reviewer countersigned" },

  { from: STANDING.STANDING, to: STANDING.SUSPENDED, actors: ["system", "admin"], reason: "a gate stopped holding, or a warden tripped" },
  { from: STANDING.SUSPENDED, to: STANDING.STANDING, actors: ["admin"], reason: "restored after review" },
  { from: STANDING.SUSPENDED, to: STANDING.CANDIDATE, actors: ["system"], reason: "gates regressed far enough to start again" },

  /* Unilateral, from every state, always available. */
  ...Object.values(STANDING)
    .filter((s) => s !== STANDING.WITHDRAWN)
    .map((from) => ({ from, to: STANDING.WITHDRAWN, actors: ["scholar"], reason: "permission withdrawn" })),

  { from: STANDING.WITHDRAWN, to: STANDING.CANDIDATE, actors: ["scholar"], reason: "asked to be considered again" },
];

function canTransition({ from, to, actor }) {
  if (!from || !to || !Object.values(STANDING).includes(from) || !Object.values(STANDING).includes(to)) {
    return { ok: false, code: "UNKNOWN_STATE", message: "That standing doesn't exist." };
  }
  if (from === to) {
    return { ok: false, code: "NO_CHANGE", message: "That's already the current standing." };
  }

  const move = TRANSITIONS.find((t) => t.from === from && t.to === to);
  if (!move) {
    return {
      ok: false,
      code: "NO_SUCH_TRANSITION",
      message: `Standing can't go from ${from} to ${to}.`,
    };
  }
  if (!move.actors.includes(actor)) {
    return {
      ok: false,
      code: "WRONG_ACTOR",
      message: `${describeActor(actor)} can't make that change — ${move.actors.join(" or ")} can.`,
    };
  }
  return { ok: true, reason: move.reason };
}

/**
 * Evaluate every gate and say where the scholar stands.
 *
 * Returns the standing they have *earned*, which is not necessarily the one
 * recorded: promotion to STANDING additionally needs a countersign, so this
 * reports CALIBRATING-with-everything-met as `eligible`, and leaves the
 * decision to a person.
 */
function assess(signals) {
  const s = { now: new Date(), ...signals };
  const results = GATES.map((g) => ({ key: g.key, title: g.title, ...g.evaluate(s) }));
  const byKey = Object.fromEntries(results.map((r) => [r.key, r]));

  const foundation = ["corpus", "record", "consent"].every((k) => byKey[k].met);
  const all = results.every((r) => r.met);

  return {
    gates: results,
    /* The gates that must hold merely to begin voice trials. */
    foundationMet: foundation,
    allMet: all,
    /* Eligible is as far as an assessment can go. Standing itself is granted
       by a person, never computed. */
    eligible: all,
    blocking: results.filter((r) => !r.met).flatMap((r) => r.blockers),
  };
}

/**
 * What the recorded standing should become, given fresh signals.
 *
 * Only ever returns a demotion or a hold — never a promotion — because
 * promotions need a countersign and demotions must not.
 */
function reconcile({ current, signals }) {
  if (current === STANDING.WITHDRAWN || current === STANDING.CONTEMPORARY) {
    return { standing: current, changed: false };
  }

  const { foundationMet, allMet } = assess(signals);

  if (current === STANDING.STANDING && !allMet) {
    return { standing: STANDING.SUSPENDED, changed: true, reason: "a gate stopped holding" };
  }
  if (current === STANDING.SUSPENDED && !foundationMet) {
    return { standing: STANDING.CANDIDATE, changed: true, reason: "gates regressed far enough to start again" };
  }
  if (current === STANDING.CALIBRATING && !foundationMet) {
    return { standing: STANDING.CANDIDATE, changed: true, reason: "a gate stopped holding" };
  }
  if (current === STANDING.CANDIDATE && foundationMet) {
    return { standing: STANDING.CALIBRATING, changed: true, reason: "corpus, review record and consent all hold" };
  }
  return { standing: current, changed: false };
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

function verdict(failures, { met, remedy, measured }) {
  return failures.length === 0
    ? { met: true, summary: met, blockers: [], measured }
    : { met: false, summary: remedy, blockers: failures, measured };
}

function num(v) {
  return Number.isFinite(v) ? v : 0;
}

function round(v) {
  return Math.round(v * 100) / 100;
}

function ageInDays(at, now) {
  if (!at) return null;
  const t = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(t.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - t.getTime()) / 86400000));
}

function describeActor(actor) {
  return { scholar: "A scholar", admin: "An admin", system: "The system" }[actor] || "That actor";
}

module.exports = {
  STANDING,
  THRESHOLDS,
  GATES,
  TRANSITIONS,
  maySpeakAs,
  canTransition,
  assess,
  reconcile,
};
