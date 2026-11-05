"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import CircleForm from "@/components/circles/CircleForm";
import { Findings, STATUS_WORDS } from "@/components/circles/CirclesView";
import { archiveCircle, bandLabel, changeCircleCode, getCircle, updateCircle } from "@/lib/circles";

/*
 * One circle: who joined (schools and classes), how many read each story, and
 * its code. Counts under the circle's minimum are said as "fewer than N", so
 * no reader can be singled out; no reader is ever named.
 */
const count = (n, min) => (n === null || n === undefined ? `fewer than ${min}` : String(n));

export default function CircleDetail({ id }) {
  const [state, setState] = useState({ status: "loading", circle: null, error: null });
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    getCircle(id).then((result) => {
      if (!live) return;
      setState(result.ok ? { status: "ready", circle: result.data.circle, error: null } : { status: "error", circle: null, error: result.error });
    });
    return () => {
      live = false;
    };
  }, [id]);

  const apply = async (name, call) => {
    setBusy(name);
    setError(null);
    const result = await call();
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    /* What an action returns is the circle without its classes' report: read it again. */
    const fresh = await getCircle(id);
    if (fresh.ok) setState({ status: "ready", circle: fresh.data.circle, error: null });
    return true;
  };

  if (state.status === "loading") return <p className="st-muted">Reading the circle…</p>;
  if (state.status === "error") return <p className="auth-error">{state.error}</p>;
  const c = state.circle;
  const min = c.minReport;

  return (
    <div className="cc-page">
      <p>
        <Link className="ck-act" href="/circles">
          ← All circles
        </Link>
      </p>
      <section className="st-card dash-card cc-card">
        <div className="cc-card__head">
          <h1 className="dash-h2">{c.name}</h1>
          <span className={`ck-chip ${STATUS_WORDS[c.status]?.tone ?? ""}`}>{STATUS_WORDS[c.status]?.label ?? c.status}</span>
        </div>
        {c.status === "suspended" && c.suspendedReason ? <p className="auth-error">Proj Arch paused this circle: {c.suspendedReason}</p> : null}
        {editing ? (
          <CircleForm
            initial={c}
            busy={busy === "edit"}
            error={error}
            submitLabel="Save"
            onCancel={() => setEditing(false)}
            onSubmit={async (input) => {
              if (await apply("edit", () => updateCircle(id, input))) setEditing(false);
            }}
          />
        ) : (
          <>
            <p>{c.purpose}</p>
            <p className="dash-muted">{c.bands.map(bandLabel).join(" · ")}</p>
            <Findings circle={c} />
            <div className="cc-actions">
              {c.status !== "suspended" ? (
                <button type="button" className="ck-act" onClick={() => setEditing(true)}>
                  Change it
                </button>
              ) : null}
              {c.status !== "suspended" ? (
                <button type="button" className="ck-act" disabled={busy !== null} onClick={() => apply("archive", () => archiveCircle(id, c.status !== "archived"))}>
                  {c.status === "archived" ? "Open it again" : "Close the circle"}
                </button>
              ) : null}
            </div>
          </>
        )}
        {error && !editing ? <p className="auth-error" role="alert">{error}</p> : null}
      </section>

      {c.status === "open" ? (
        <section className="st-card dash-card cc-card" aria-labelledby="cc-code-title">
          <h2 className="dash-h2" id="cc-code-title">Class code</h2>
          <p className="cc-code-big">{c.classCode}</p>
          <p className="dash-muted">
            {c.classCodeActive
              ? "Give it to a teacher you know. They enter it on their class's page in Proj Arch; their school approves it."
              : "Switched off: no new class can join with it. Classes already in stay."}
          </p>
          <div className="cc-actions">
            <button type="button" className="ck-act" disabled={busy !== null} onClick={() => apply("code", () => changeCircleCode(id, { active: !c.classCodeActive }))}>
              {c.classCodeActive ? "Switch it off" : "Switch it on"}
            </button>
            <button type="button" className="ck-act" disabled={busy !== null} onClick={() => apply("rotate", () => changeCircleCode(id, { rotate: true }))}>
              Make a new code
            </button>
          </div>
        </section>
      ) : null}

      <section className="st-card dash-card cc-card" aria-labelledby="cc-classes-title">
        <h2 className="dash-h2" id="cc-classes-title">Who reads with you</h2>
        <p className="dash-muted">
          {count(c.members, min)} {c.members === 1 ? "reader" : "readers"} in {c.classes.active} {c.classes.active === 1 ? "class" : "classes"}. You see schools and classes, never a reader&rsquo;s name.
        </p>
        {c.connections.length ? (
          <ul className="cc-rows">
            {c.connections.map((k) => (
              <li key={k.id}>
                <span>
                  <b>{k.className}</b>
                  {k.grade ? ` · grade ${k.grade}` : ""} · {k.school ?? "A school"}
                </span>
                <span className="dash-muted">{k.status === "pending" ? "Waiting for their school" : `${count(k.members, min)} readers`}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="st-muted">No class has joined yet.</p>
        )}
      </section>

      <section className="st-card dash-card cc-card" aria-labelledby="cc-stories-title">
        <h2 className="dash-h2" id="cc-stories-title">The stories</h2>
        {c.stories.length ? (
          <ul className="cc-rows">
            {c.stories.map((s) => (
              <li key={s.editorialId}>
                <span>{s.title}</span>
                <span className="dash-muted">{s.readers === null ? `read by fewer than ${min}` : `read by ${s.readers}`}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="st-muted">No stories featured yet. Change the circle to choose some.</p>
        )}
      </section>
    </div>
  );
}
