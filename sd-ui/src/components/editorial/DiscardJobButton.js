"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FaTrashCan } from "react-icons/fa6";

import ConfirmDialog from "@/components/editorial/ConfirmDialog";
import { discardDraftJob } from "@/lib/drafting";

/** Discard a draft job that is waiting on the scholar. Asks once first. */
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

  function cancel() {
    setAsking(false);
    setError("");
  }

  /* The same mark as the other two ways out, so one queue does not show
     three different-looking ways to be rid of a row. */
  return (
    <>
      <button type="button" className="del-btn" onClick={() => setAsking(true)} title="Discard this draft">
        <FaTrashCan size={11} aria-hidden /> {label}
      </button>
      {asking ? (
        <ConfirmDialog
          title="Discard this draft?"
          confirmLabel="Discard"
          busyLabel="Discarding…"
          busy={busy}
          error={error}
          onConfirm={confirm}
          onCancel={cancel}
        >
          The draft and the work the agent did on it are thrown away. The paper
          it was written from is untouched, and you can draft from it again.
        </ConfirmDialog>
      ) : null}
    </>
  );
}
