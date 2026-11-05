"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import CircleForm from "@/components/circles/CircleForm";
import { FINDING_WORDS, bandLabel, createCircle, listCircles } from "@/lib/circles";

/*
 * The scholar's learning circles: groups of classes that read the stories
 * they choose. A teacher connects a class with the circle's code, and the
 * school approves it; the scholar never adds a child and never sees one's
 * name, only how many read.
 */

export const STATUS_WORDS = {
  open: { label: "Open", tone: "is-ok" },
  draft: { label: "Draft: change the name or purpose", tone: "is-warn" },
  archived: { label: "Closed", tone: "" },
  suspended: { label: "Paused by Proj Arch", tone: "is-warn" },
};

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

export default function CirclesView() {
  const [state, setState] = useState({ status: "loading", circles: [], error: null });
  const [making, setMaking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState(null);

  useEffect(() => {
    let live = true;
    listCircles().then((result) => {
      if (!live) return;
      setState(result.ok ? { status: "ready", circles: result.data.circles ?? [], error: null } : { status: "error", circles: [], error: result.error });
    });
    return () => {
      live = false;
    };
  }, []);

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

  return (
    <div className="cc-page">
      <div className="cc-bar">
        <p className="dash-muted">
          A circle is a group of classes reading the stories you choose. Share its code with a teacher; their school approves it. You see which schools joined and how many read, never who.
        </p>
        {!making ? (
          <button type="button" className="auth-submit" onClick={() => setMaking(true)}>
            Start a circle
          </button>
        ) : null}
      </div>

      {making ? (
        <section className="st-card dash-card cc-card" aria-label="A new circle">
          <h2 className="dash-h2">A new circle</h2>
          <CircleForm busy={busy} error={formError} submitLabel="Start the circle" onSubmit={make} onCancel={() => setMaking(false)} />
        </section>
      ) : null}

      {state.status === "loading" ? <p className="st-muted">Reading your circles…</p> : null}
      {state.status === "error" ? <p className="auth-error">{state.error}</p> : null}
      {state.status === "ready" && state.circles.length === 0 && !making ? (
        <section className="st-card dash-card cc-card">
          <h2 className="dash-h2">No circles yet</h2>
          <p className="dash-muted">Start one around a few of your published stories, then share its code with a teacher you know.</p>
        </section>
      ) : null}

      <div className="cc-list">
        {state.circles.map((circle) => (
          <article key={circle.id} className="st-card dash-card cc-card">
            <div className="cc-card__head">
              <h2 className="dash-h2">
                <Link href={`/circles/${circle.id}`}>{circle.name}</Link>
              </h2>
              <span className={`ck-chip ${STATUS_WORDS[circle.status]?.tone ?? ""}`}>{STATUS_WORDS[circle.status]?.label ?? circle.status}</span>
            </div>
            <p>{circle.purpose}</p>
            <p className="dash-muted">
              {circle.bands.map(bandLabel).join(" · ")} · {circle.featuredEditorialIds.length} {circle.featuredEditorialIds.length === 1 ? "story" : "stories"} ·{" "}
              {circle.classes.active} {circle.classes.active === 1 ? "class" : "classes"}
              {circle.classes.pending ? `, ${circle.classes.pending} waiting for their school` : ""}
            </p>
            <Findings circle={circle} />
            {circle.status === "open" ? (
              <p className="cc-code">
                Class code <b>{circle.classCode}</b>
                {circle.classCodeActive ? "" : " (switched off)"}
              </p>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}
