"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import CircleForm from "@/components/circles/CircleForm";
import { Findings, STATUS_WORDS } from "@/components/circles/CirclesView";
import { CONCERN_WORDS, archiveCircle, bandLabel, changeCircleCode, getCircle, requestPlacement, updateCircle, withdrawPlacement } from "@/lib/circles";

/*
 * One circle: who joined (schools and classes), how many read each story, and
 * its code. Counts under the circle's minimum are said as "fewer than N", so
 * no reader can be singled out; no reader is ever named.
 */
const count = (n, min) => (n === null || n === undefined ? `fewer than ${min}` : String(n));

/* A class's grade, or a college's year; nothing for a group of mixed ages or of adults. */
const gradeLine = (grade) => (!grade ? "" : grade === 13 ? " · college year 1" : grade === 14 ? " · college year 2" : ` · grade ${grade}`);

/*
 * Its place in a community's portal. A model reads what the circle is about,
 * never who leads it, and places it, says why not, or asks Proj Arch to look
 * (the learner app's services/circles/communityFit). The scholar may take it
 * out; asking again with nothing changed gets the same answer.
 */
function PortalPlacement({ circle, busy, apply }) {
  const p = circle.placement;
  const portals = circle.portals || [];
  if (!p && portals.length === 0) return null;
  const asking = busy === "placement";
  const ask = (community) => apply("placement", () => requestPlacement(circle.id, community));
  const takeOut = () => apply("placement", () => withdrawPlacement(circle.id));
  const askLabel = (name) => (asking ? "Reading the circle…" : `Show it in the ${name} portal`);

  let state = null;
  if (!p) {
    state =
      circle.status === "open" ? (
        <div className="cc-actions">
          {portals.map((portal) => (
            <button key={portal.community} type="button" className="ck-act" disabled={busy !== null} onClick={() => ask(portal.community)}>
              {askLabel(portal.name)}
            </button>
          ))}
        </div>
      ) : (
        <p className="st-muted">Once the circle is open, you can show it in a community&rsquo;s portal.</p>
      );
  } else if (p.withdrawn) {
    state = (
      <>
        <p>You took it out of the {p.communityName} portal.</p>
        {circle.status === "open" ? (
          <div className="cc-actions">
            <button type="button" className="ck-act" disabled={busy !== null} onClick={() => ask(p.community)}>
              {askLabel(p.communityName)}
            </button>
          </div>
        ) : null}
      </>
    );
  } else {
    const concerns = p.concerns.map((k) => CONCERN_WORDS[k] ?? k);
    const words =
      p.status === "placed"
        ? p.shown
          ? `Shown in the ${p.communityName} portal.`
          : `Placed in the ${p.communityName} portal, and hidden while the circle isn't open.`
        : p.status === "declined"
          ? p.byArchivyn
            ? `Not shown in the ${p.communityName} portal. Proj Arch decided:`
            : `Not shown in the ${p.communityName} portal.`
          : p.unjudged
            ? "The check couldn't be reached after your last change, so it's out of the portal for now. Ask again, or Proj Arch will look."
            : `Proj Arch is looking at it before it's shown in the ${p.communityName} portal.`;
    state = (
      <>
        <p>
          <span className={`ck-chip ${p.shown ? "is-ok" : p.status === "declined" ? "" : "is-warn"}`}>
            {p.shown ? "In the portal" : p.status === "declined" ? "Not shown" : p.status === "review" ? "Waiting for Proj Arch" : "Hidden"}
          </span>
        </p>
        <p>{words}</p>
        {p.reason ? <p className="dash-muted">{p.reason}</p> : null}
        {concerns.length ? <p className="dash-muted">What it noticed: it {concerns.join("; it ")}.</p> : null}
        {p.status === "declined" ? <p className="st-muted">Change the circle&rsquo;s purpose or stories, then ask again: the same circle gets the same answer.</p> : null}
        <div className="cc-actions">
          {circle.status === "open" && (p.status === "declined" || p.unjudged) ? (
            <button type="button" className="ck-act" disabled={busy !== null} onClick={() => ask(p.community)}>
              {asking ? "Reading the circle…" : "Ask again"}
            </button>
          ) : null}
          {p.status !== "declined" ? (
            <button type="button" className="ck-act" disabled={busy !== null} onClick={takeOut}>
              Take it out
            </button>
          ) : null}
        </div>
      </>
    );
  }

  return (
    <section className="st-card dash-card cc-card" aria-labelledby="cc-portal-title">
      <h2 className="dash-h2" id="cc-portal-title">Community portal</h2>
      <p className="dash-muted">
        A community&rsquo;s portal is where its learners find reading about its people, history and culture. Whether a circle belongs there is judged on what it is
        about, never on who leads it.
      </p>
      {state}
    </section>
  );
}

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

      <PortalPlacement circle={c} busy={busy} apply={apply} />

      {c.status === "open" ? (
        <section className="st-card dash-card cc-card" aria-labelledby="cc-code-title">
          <h2 className="dash-h2" id="cc-code-title">Class code</h2>
          <p className="cc-code-big">{c.classCode}</p>
          <p className="dash-muted">
            {c.classCodeActive
              ? "Give it to a teacher you know, or to the staff of a program, library or college. They enter it on their class's or group's page in Proj Arch; their school or organization approves it."
              : "Switched off: no new class or group can join with it. Those already in stay."}
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
          {count(c.members, min)} {c.members === 1 ? "reader" : "readers"} in {c.classes.active} {c.classes.active === 1 ? "class or group" : "classes and groups"}. You see schools, organizations and their groups, never a reader&rsquo;s name.
        </p>
        {c.connections.length ? (
          <ul className="cc-rows">
            {c.connections.map((k) => (
              <li key={k.id}>
                <span>
                  <b>{k.className}</b>
                  {gradeLine(k.grade)} · {k.school ?? "A school or organization"}
                </span>
                <span className="dash-muted">{k.status === "pending" ? "Waiting for their school or organization" : `${count(k.members, min)} readers`}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="st-muted">No class or group has joined yet.</p>
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
          <p className="st-muted">No stories featured yet. Change the circle to choose some, or write one for it.</p>
        )}
        {/* Kivyn, writing for this circle: its readers' ages, and the story joins it when published. */}
        {c.status === "open" || c.status === "draft" ? (
          <div className="cc-actions">
            <Link className="ck-act" href={`/editorial/new?circle=${encodeURIComponent(c.id)}`}>
              Write a story for this circle
            </Link>
          </div>
        ) : null}
      </section>
    </div>
  );
}
