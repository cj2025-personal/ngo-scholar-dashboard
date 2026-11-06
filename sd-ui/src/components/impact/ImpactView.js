"use client";

import { useCallback, useEffect, useState } from "react";

import ImpactRecordView from "@/components/impact/ImpactRecordView";
import { createShare, getImpact, listShares, revokeShare, shareUrl } from "@/lib/impact";

/*
 * The scholar's impact page: their record as it stands, signed now; the
 * share links they have made, with how often each was opened, and a new one.
 * Nobody else sees the record unless the scholar gives them a link, and a
 * link turned off shows nothing. The signed record can be downloaded to be
 * checked anywhere, offline.
 */

const day = (iso) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export default function ImpactView() {
  const [issued, setIssued] = useState(null);
  const [shares, setShares] = useState([]);
  const [error, setError] = useState(null);
  const [label, setLabel] = useState("");
  const [fresh, setFresh] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    let live = true;
    Promise.all([getImpact(), listShares()]).then(([record, links]) => {
      if (!live) return;
      if (!record.ok) setError(record.error);
      else setIssued(record.data);
      if (links.ok) setShares(links.data.shares || []);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => load(), [load]);

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
    setCopied(false);
    setLabel("");
    setShares((list) => [result.data.share, ...list]);
  };

  const turnOff = async (id) => {
    setBusy(true);
    const result = await revokeShare(id);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setShares((list) => list.map((s) => (s.id === id ? result.data.share : s)));
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(fresh.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const download = () => {
    const body = JSON.stringify({ record: issued.record, signature: issued.signature, key_id: issued.keyId, public_key: "/api/editorial-stories/public/evidence/key" }, null, 2);
    const url = URL.createObjectURL(new Blob([body], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `impact-record-${issued.record.issued_at.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (error && !issued) {
    return (
      <div className="dash-card imp-card">
        <p className="imp-quiet" role="alert">{error}</p>
        <button type="button" className="ck-act" onClick={() => { setError(null); load(); }}>Try again</button>
      </div>
    );
  }
  if (!issued) return <p className="imp-quiet">Counting what your work reached…</p>;

  const live = shares.filter((s) => !s.revokedAt);
  return (
    <div className="imp-page">
      <div className="dash-card imp-card">
        <ImpactRecordView record={issued.record} />
        <div className="imp-signed">
          <span>{issued.signed ? `Signed ${day(issued.record.issued_at)} · key ${issued.keyId}` : "Not signed: this deployment has no signing key."}</span>
          {issued.signed ? <button type="button" className="ck-act" onClick={download}>Download the signed record</button> : null}
        </div>
      </div>

      <section className="dash-card imp-card" aria-labelledby="imp-share">
        <h2 className="imp-h2" id="imp-share">Share it</h2>
        <p className="imp-quiet">Only you see this record. Make a link to show it to someone - a grant panel, your department - and turn it off when they no longer need it. Whoever opens it sees the record as it stands that day, signed, and can check the signature.</p>
        <div className="imp-share-new">
          <label className="imp-share-label">
            <span>Who it is for (only you see this)</span>
            <input type="text" value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. NSF review panel" />
          </label>
          <button type="button" className="ck-act is-ask" disabled={busy} onClick={make}>{busy ? "Making it…" : "Make a link"}</button>
        </div>
        {fresh ? (
          <div className="imp-fresh" role="status">
            <p>Your link{fresh.label ? ` for ${fresh.label}` : ""}. Copy it now: it is not shown again.</p>
            <code className="imp-fresh__url">{fresh.url}</code>
            <button type="button" className="ck-act" onClick={copy}>{copied ? "Copied" : "Copy link"}</button>
          </div>
        ) : null}
        {error ? <p className="rc-error" role="alert">{error}</p> : null}
        {shares.length ? (
          <ul className="imp-shares">
            {shares.map((s) => (
              <li key={s.id} className={s.revokedAt ? "is-off" : undefined}>
                <span className="imp-shares__label">{s.label || "A link"}</span>
                <span className="imp-quiet">
                  made {day(s.createdAt)} · opened {s.views} {s.views === 1 ? "time" : "times"}
                  {s.revokedAt ? ` · turned off ${day(s.revokedAt)}` : ""}
                </span>
                {s.revokedAt ? null : (
                  <button type="button" className="ck-act" disabled={busy} onClick={() => turnOff(s.id)}>Turn off</button>
                )}
              </li>
            ))}
          </ul>
        ) : null}
        {live.length === 0 && shares.length > 0 ? <p className="imp-quiet">No link is open: nobody else can see the record.</p> : null}
      </section>
    </div>
  );
}
