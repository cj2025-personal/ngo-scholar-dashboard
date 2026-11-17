"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { HiOutlineCheck, HiOutlineClipboard, HiOutlineExclamationCircle, HiOutlineUserGroup } from "react-icons/hi2";

import CircleForm from "@/components/circles/CircleForm";
import { FINDING_WORDS, bandLabel, createCircle, listCircles } from "@/lib/circles";

/*
 * The scholar's learning circles: classes and groups that read the stories
 * they choose. A teacher connects a class with the circle's code, and the
 * school approves it - or a program's, library's or college's staff connect
 * a group, adults among them, and its admin approves; the scholar never adds
 * a reader and never sees one's name, only how many read.
 *
 * ── How the page is laid out (2026-11-16) ──────────────────────────────────
 * From empty-state and degraded-state guidance (NN/g, Polaris, Primer,
 * Carbon, GOV.UK) and how class codes are shared in practice:
 * - One primary action at a time. With no circles, "Start a circle" lives in
 *   the empty state; once there is one, it moves to the header.
 * - A scholar with nothing published is sent to publish first: a circle
 *   shares published stories, so an empty circle would give classes nothing.
 * - A list that failed to load says so, never "no circles": that would read
 *   as lost work. Starting a circle needs the same service, so it is hidden.
 * - Rows, not cards: the circles look alike and a list compares them. What
 *   needs the scholar (a draft to reword) comes first; closed ones last.
 * - An open circle's code sits beside a Copy button that says "Copied" only
 *   once the copy worked. A pending class is the school's to approve, so it
 *   is plain text, not a call to act.
 */

export const STATUS_WORDS = {
  open: { label: "Open", short: "Open", tone: "is-ok" },
  draft: { label: "Draft: change the name or purpose", short: "Draft", tone: "is-warn" },
  archived: { label: "Closed", short: "Closed", tone: "" },
  suspended: { label: "Paused by Proj Arch", short: "Paused", tone: "is-warn" },
};

/* The order a scholar deals with them in: what needs a change, what is paused, what is open, what is closed. */
const ORDER = { draft: 0, suspended: 1, open: 2, archived: 3 };
const byNeed = (a, b) => (ORDER[a.status] ?? 2) - (ORDER[b.status] ?? 2);

const count = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export function Findings({ circle }) {
  if (circle.status !== "draft") return null;
  if (circle.review?.unreachable) return <p className="st-muted">The name and purpose could not be checked just now. Save again in a moment.</p>;
  if (!circle.review?.findings?.length) return null;
  return (
    <ul className="cc-findings">
      {circle.review.findings.map((f, i) => (
        <li key={`${f.kind}-${i}`}>
          <b>&ldquo;{f.quote}&rdquo;</b> {FINDING_WORDS[f.kind] ?? f.kind}. {f.explanation}
        </li>
      ))}
    </ul>
  );
}

/** The code and a button that copies it; "Copied" only once the copy worked, read out by screen readers. */
function CopyCode({ code, name }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      return;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <b className="cc-row__code-value">{code}</b>
      <button type="button" className={`dash-btn cc-copy${copied ? " is-done" : ""}`} onClick={copy} aria-label={`Copy the class code for ${name}`}>
        {copied ? <HiOutlineCheck size={14} aria-hidden /> : <HiOutlineClipboard size={14} aria-hidden />}
        {copied ? "Copied" : "Copy"}
      </button>
      <span className="sr-only" aria-live="polite">{copied ? "Class code copied" : ""}</span>
    </>
  );
}

function CircleRow({ circle }) {
  const words = STATUS_WORDS[circle.status] ?? { short: circle.status, tone: "" };
  const stories = circle.featuredEditorialIds.length;
  const { active, pending } = circle.classes;
  const href = `/circles/${circle.id}`;
  const unchecked = circle.status === "draft" && circle.review?.unreachable;
  /* How many read it (the learner app's count, 2026-11-17): only once a class is in, a number from
     the floor up, "under N" below it, and nothing at all from a learner app that does not send it yet. */
  const readers =
    active > 0 && circle.readers !== undefined
      ? typeof circle.readers === "number"
        ? <><b>{circle.readers.toLocaleString()}</b> {circle.readers === 1 ? "reader" : "readers"}</>
        : `Under ${circle.minReport ?? 5} readers so far`
      : null;

  return (
    <li className={`cc-row is-${circle.status}`}>
      <div className="cc-row__main">
        <div className="cc-row__title">
          <h2 className="cc-row__name">
            <Link href={href}>{circle.name}</Link>
          </h2>
          <span className={`ck-chip ${words.tone}`}>{words.short}</span>
        </div>
        <p className="cc-row__purpose">{circle.purpose}</p>
        <p className="cc-row__meta">
          <span>{circle.bands.map(bandLabel).join(", ")}</span>
          <span>{stories ? count(stories, "story", "stories") : "No stories yet"}</span>
          <span>
            {count(active, "class or group", "classes and groups")}
            {pending ? `, ${pending.toLocaleString()} waiting for approval` : ""}
          </span>
          {readers ? <span className="cc-row__readers">{readers}</span> : null}
        </p>
      </div>

      {circle.status === "open" ? (
        <div className="cc-row__code">
          <span className="cc-row__code-label">Class code</span>
          {circle.classCodeActive ? <CopyCode code={circle.classCode} name={circle.name} /> : <span className="cc-row__code-off">Switched off</span>}
        </div>
      ) : null}

      {circle.status === "draft" ? (
        <div className="cc-row__fix">
          {unchecked ? null : <p className="cc-row__fix-lead">Needs a change before classes can join</p>}
          <Findings circle={circle} />
          <Link href={href} className="cc-row__fix-link">
            {unchecked ? "Open it to save again" : "Change the wording"}
          </Link>
        </div>
      ) : null}

      {circle.status === "suspended" ? (
        <p className="cc-row__note">
          Proj Arch paused it{circle.suspendedReason ? `: ${circle.suspendedReason.trim().replace(/[.!?]+$/, "")}.` : "."} No class can join while it is paused.
        </p>
      ) : null}
    </li>
  );
}

/** No circles yet: the three steps a circle takes, and the one way to begin. */
function EmptyCircles({ hasPublished, onStart }) {
  const needsStory = hasPublished === false;
  const share = { title: "Share its code", text: "Give it to a teacher, or to staff at a program, library or college. Their school or organization says yes." };
  const see = { title: "See how many read", text: "Which classes joined and how many read each story. Never who." };
  const steps = needsStory
    ? [{ title: "Publish a story", text: "Write it with Kivyn, then publish it from Stories.", current: true }, share, see]
    : [{ title: "Choose a few stories", text: "Name the circle, then pick its reading ages and stories you have published." }, share, see];

  return (
    <section className="st-card dash-card es" aria-labelledby="cc-empty-title">
      <div className="es-intro">
        <span className="es-icon" aria-hidden>
          <HiOutlineUserGroup size={24} />
        </span>
        <div>
          <h2 id="cc-empty-title" className="dash-h2">{needsStory ? "First, publish a story" : "Start your first circle"}</h2>
          {/* The header already says what a circle is; this says only what is new. */}
          {needsStory ? <p className="es-lead">A circle can only share stories you have published, so that comes first.</p> : null}
        </div>
      </div>
      <ol className="es-steps">
        {steps.map((s, i) => (
          <li key={s.title} className={s.current ? "is-current" : undefined} aria-current={s.current ? "step" : undefined}>
            <span className="es-n" aria-hidden>{i + 1}</span>
            <div>
              <h3 className="es-h3">{s.title}</h3>
              <p>{s.text}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="es-foot">
        {needsStory ? (
          <Link href="/editorial" className="dash-btn is-primary es-action">Go to my stories</Link>
        ) : (
          <button type="button" className="dash-btn is-primary es-action" onClick={onStart}>Start a circle</button>
        )}
      </div>
    </section>
  );
}

/** The list could not be read: said plainly, with the one thing to do about it. */
function LoadFailed({ offline, onRetry }) {
  return (
    <section className="st-card dash-card es" role="alert" aria-labelledby="cc-failed-title">
      <div className="es-intro">
        <span className="es-icon is-muted" aria-hidden>
          <HiOutlineExclamationCircle size={24} />
        </span>
        <div>
          <h2 id="cc-failed-title" className="dash-h2">We couldn&rsquo;t load your circles</h2>
          <p className="es-lead">
            {offline ? "Check your connection, then try again. Your circles are safe." : "This is on our side, and your circles are safe. Try again in a moment."}
          </p>
        </div>
      </div>
      <div className="es-foot">
        <button type="button" className="dash-btn" onClick={onRetry}>Try again</button>
      </div>
    </section>
  );
}

function Loading() {
  return (
    <section className="st-card dash-card cc-list" aria-busy="true">
      <span className="sr-only">Loading your circles…</span>
      {[0, 1].map((i) => (
        <div key={i} className="cc-row cc-row--skeleton" aria-hidden>
          <div className="cc-row__main">
            <span className="cc-skel is-title" />
            <span className="cc-skel is-line" />
            <span className="cc-skel is-meta" />
          </div>
        </div>
      ))}
    </section>
  );
}

export default function CirclesView({ hasPublished = null }) {
  const [state, setState] = useState({ status: "loading", circles: [], error: null, offline: false });
  const [making, setMaking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState(null);

  const load = useCallback(() => {
    let live = true;
    listCircles().then((result) => {
      if (!live) return;
      setState(
        result.ok
          ? { status: "ready", circles: result.data.circles ?? [], error: null, offline: false }
          : { status: "error", circles: [], error: result.error, offline: result.status === 0 }
      );
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => load(), [load]);

  const retry = () => {
    setState((s) => ({ ...s, status: "loading" }));
    load();
  };

  const make = async (input) => {
    setBusy(true);
    setFormError(null);
    const result = await createCircle(input);
    setBusy(false);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    setMaking(false);
    setState((s) => ({ ...s, circles: [result.data.circle, ...s.circles] }));
  };

  const ready = state.status === "ready";
  const circles = ready ? [...state.circles].sort(byNeed) : [];
  const empty = ready && circles.length === 0;

  return (
    <>
      <header className="dash-head">
        <div>
          <p className="dash-date">Circles</p>
          <h1 className="dash-greet">Your circles</h1>
          <p className="pods-intro">A circle is a small shelf of your stories that classes and groups join with a code.</p>
        </div>
        {/* The header's button only once there is a list: an empty page has its own, in the empty state. */}
        {circles.length > 0 && !making ? (
          <button type="button" className="dash-btn is-primary es-action cc-start" onClick={() => setMaking(true)}>
            Start a circle
          </button>
        ) : null}
      </header>

      <div className="cc-index">
        {making ? (
          <section className="st-card dash-card cc-card" aria-label="A new circle">
            <h2 className="dash-h2">A new circle</h2>
            <CircleForm busy={busy} error={formError} submitLabel="Start the circle" onSubmit={make} onCancel={() => setMaking(false)} />
          </section>
        ) : null}

        {state.status === "loading" ? <Loading /> : null}
        {state.status === "error" ? <LoadFailed offline={state.offline} onRetry={retry} /> : null}
        {empty && !making ? <EmptyCircles hasPublished={hasPublished} onStart={() => setMaking(true)} /> : null}

        {circles.length > 0 ? (
          <section className="st-card dash-card cc-list" aria-label="Your circles">
            <ul className="cc-rows-list">
              {circles.map((circle) => (
                <CircleRow key={circle.id} circle={circle} />
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </>
  );
}
