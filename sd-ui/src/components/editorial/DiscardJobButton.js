"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { discardDraftJob } from "@/lib/drafting";

/** Discard a draft job that is waiting on the scholar. Asks once, in place. */
export default function DiscardJobButton({ jobId, label = "Discard" }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function confirm() {
    setBusy(true);
    setError("");
    const r = await discardDraftJob(jobId);
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setAsking(false);
    router.refresh();
  }

  if (asking) {
    return (
      <span className="del-confirm" role="alertdialog" aria-label="Confirm discard">
        <span>Discard this draft?</span>
        <button type="button" className="del-yes" disabled={busy} onClick={confirm}>{busy ? "Discarding…" : "Discard"}</button>
        <button type="button" className="st-link" disabled={busy} onClick={() => setAsking(false)}>Keep</button>
        {error ? <span className="del-error">{error}</span> : null}
      </span>
    );
  }
  return <button type="button" className="del-btn" onClick={() => setAsking(true)}>{label}</button>;
}
