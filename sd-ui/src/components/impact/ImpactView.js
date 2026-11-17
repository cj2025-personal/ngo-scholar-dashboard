"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { HiOutlineArrowDownTray, HiOutlineChartBar, HiOutlineCheck, HiOutlineClipboard, HiOutlineExclamationCircle } from "react-icons/hi2";

import ImpactRecordView from "@/components/impact/ImpactRecordView";
import { createShare, getImpact, listShares, revokeShare, shareUrl } from "@/lib/impact";

/*
 * The scholar's impact page: their record as it stands, signed now; the
 * share links they have made, with how often each was opened, and a new one.
 * Nobody else sees the record unless the scholar gives them a link, and a
 * link turned off shows nothing. The signed record can be downloaded to be
 * checked anywhere, offline.
 *
 * ── How the page is laid out (2026-11-16) ──────────────────────────────────
 * The same rules as Stories and Circles (empty- and degraded-state guidance
 * from NN/g, Polaris, Primer, GOV.UK):
 * - Nothing published yet: no wall of zeros and "fewer than 5"s, but the
 *   three steps a record takes and the one way to begin, to Stories.
 * - Counts that could not be read say so, with "Try again", never a record
 *   that looks empty. Links already made stay listed so the scholar can
 *   still turn one off; a new one waits until the record can be shown.
 * - A new link's Copy says "Copied" only once the copy worked.
 */

const day = (iso) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/** A link's text and its Copy button; "Copied" only once the copy worked, read out by screen readers. */
function CopyLink({ url }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      return;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="imp-fresh__row">
      <code className="imp-fresh__url">{url}</code>
      <button type="button" className={`dash-btn imp-copy${copied ? " is-done" : ""}`} onClick={copy}>
        {copied ? <HiOutlineCheck size={14} aria-hidden /> : <HiOutlineClipboard size={14} aria-hidden />}
        {copied ? "Copied" : "Copy link"}
      </button>
      <span className="sr-only" aria-live="polite">{copied ? "Link copied" : ""}</span>
    </div>
  );
}

/** Nothing published yet: what the record will hold, and the one way to begin. */
function EmptyRecord({ floor }) {
  const steps = [
    { title: "Publish a story", text: "Write it with Kivyn, then publish it from Stories.", current: true },
    { title: "Readers answer its questions", text: `Counts show once ${floor} readers stand behind them. No reader is ever named.` },
    { title: "Share a signed record", text: "Send a link to a grant panel or your department. They can check nothing was changed." },
  ];
  return (
    <section className="st-card dash-card es" aria-labelledby="imp-empty-title">
      <div className="es-intro">
        <span className="es-icon" aria-hidden>
          <HiOutlineChartBar size={24} />
        </span>
        <h2 id="imp-empty-title" className="dash-h2">Your record starts with your first published story</h2>
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
        <Link href="/editorial" className="dash-btn is-primary es-action">Go to my stories</Link>
      </div>
    </section>
  );
}

/** The counts could not be read: said plainly, with the one thing to do about it. */
function LoadFailed({ offline, onRetry }) {
  return (
    <section className="st-card dash-card es" role="alert" aria-labelledby="imp-failed-title">
      <div className="es-intro">
        <span className="es-icon is-muted" aria-hidden>
          <HiOutlineExclamationCircle size={24} />
        </span>
        <div>
          <h2 id="imp-failed-title" className="dash-h2">We couldn&rsquo;t count your readers just now</h2>
          <p className="es-lead">
            {offline
              ? "Check your connection, then try again."
              : "This is on our side. A record is only issued when every count can be read, so nothing out of date is shown. Try again in a moment."}
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
    <section className="st-card dash-card imp-card" aria-busy="true">
      <span className="sr-only">Counting what your work reached…</span>
      <div className="imp-totals" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="imp-total imp-total--skeleton">
            <span className="cc-skel is-value" />
            <span className="cc-skel is-meta" />
          </div>
        ))}
      </div>
    </section>
  );
}

function ShareCard({ shares, canMake, busy, error, fresh, label, setLabel, onMake, onTurnOff }) {
  const live = shares.filter((s) => !s.revokedAt);
  const ordered = [...live, ...shares.filter((s) => s.revokedAt)];
  return (
    <section className="st-card dash-card imp-card imp-share" aria-labelledby="imp-share">
      <div>
        <h2 className="imp-h2" id="imp-share">Share your record</h2>
        <p className="imp-lead">
          Only you can see this page. A link shows the record to whoever opens it, signed that day so they can check it, until you turn the link off.
        </p>
      </div>
      {canMake ? (
        <form
          className="imp-share-new"
          onSubmit={(event) => {
            event.preventDefault();
            onMake();
          }}
        >
          <label className="imp-share-label">
            <span>Who it is for (only you see this)</span>
            <input type="text" value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. NSF review panel" />
          </label>
          <button type="submit" className="dash-btn is-primary es-action" disabled={busy}>
            {busy ? "Making it…" : "Make a link"}
          </button>
        </form>
      ) : null}
      {fresh ? (
        <div className="imp-fresh" role="status">
          <p>
            Your link{fresh.label ? ` for ${fresh.label}` : ""}. <b>Copy it now:</b> it is not shown again.
          </p>
          <CopyLink url={fresh.url} />
        </div>
      ) : null}
      {error ? <p className="rc-error" role="alert">{error}</p> : null}
      {ordered.length ? (
        <ul className="imp-shares" aria-label="Your links">
          {ordered.map((s) => (
            <li key={s.id} className={s.revokedAt ? "is-off" : undefined}>
              <span className="imp-shares__label">{s.label || "A link"}</span>
              <span className="imp-quiet">
                made {day(s.createdAt)} · opened {s.views} {s.views === 1 ? "time" : "times"}
                {s.revokedAt ? ` · turned off ${day(s.revokedAt)}` : ""}
              </span>
              {s.revokedAt ? null : (
                <button type="button" className="dash-btn" disabled={busy} onClick={() => onTurnOff(s.id)}>
                  Turn off
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {live.length === 0 && shares.length > 0 ? <p className="imp-quiet">No link is open: nobody else can see the record.</p> : null}
    </section>
  );
}

export default function ImpactView() {
  const [state, setState] = useState({ status: "loading", issued: null, offline: false });
  const [shares, setShares] = useState([]);
  const [error, setError] = useState(null);
  const [label, setLabel] = useState("");
  const [fresh, setFresh] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    let live = true;
    Promise.all([getImpact(), listShares()]).then(([record, links]) => {
      if (!live) return;
      setState(record.ok ? { status: "ready", issued: record.data, offline: false } : { status: "error", issued: null, offline: record.status === 0 });
      if (links.ok) setShares(links.data.shares || []);
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

  const make = async () => {
    setBusy(true);
    setError(null);
    const result = await createShare(label);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setFresh({ url: shareUrl(result.data.token), label: result.data.share.label });
    setLabel("");
    setShares((list) => [result.data.share, ...list]);
  };

  const turnOff = async (id) => {
    setBusy(true);
    setError(null);
    const result = await revokeShare(id);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setShares((list) => list.map((s) => (s.id === id ? result.data.share : s)));
  };

  const { issued } = state;
  const download = () => {
    const body = JSON.stringify({ record: issued.record, signature: issued.signature, key_id: issued.keyId, public_key: "/api/editorial-stories/public/evidence/key" }, null, 2);
    const url = URL.createObjectURL(new Blob([body], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `impact-record-${issued.record.issued_at.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const shareProps = { shares, busy, error, fresh, label, setLabel, onMake: make, onTurnOff: turnOff };

  if (state.status === "loading") return <Loading />;
  if (state.status === "error") {
    return (
      <div className="imp-page">
        <LoadFailed offline={state.offline} onRetry={retry} />
        {/* Open links stay in reach, so one can still be turned off. */}
        {shares.some((s) => !s.revokedAt) ? <ShareCard {...shareProps} canMake={false} /> : null}
      </div>
    );
  }

  const t = issued.record.totals;
  if (t.stories_published === 0 && t.circles_led === 0) {
    return (
      <div className="imp-page">
        <EmptyRecord floor={issued.record.floor} />
        {shares.some((s) => !s.revokedAt) ? <ShareCard {...shareProps} canMake={false} /> : null}
      </div>
    );
  }

  return (
    <div className="imp-page">
      <section className="st-card dash-card imp-card" aria-label="Your record">
        <ImpactRecordView record={issued.record} />
        <div className="imp-signed">
          <span>{issued.signed ? `Signed ${day(issued.record.issued_at)} · key ${issued.keyId}` : "Not signed: this deployment has no signing key."}</span>
          {issued.signed ? (
            <button type="button" className="dash-btn" onClick={download}>
              <HiOutlineArrowDownTray size={14} aria-hidden /> Download the signed record
            </button>
          ) : null}
        </div>
      </section>
      <ShareCard {...shareProps} canMake />
    </div>
  );
}
