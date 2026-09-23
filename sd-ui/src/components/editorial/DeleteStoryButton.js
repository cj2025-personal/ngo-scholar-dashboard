"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FaTrashCan } from "react-icons/fa6";

import ConfirmDialog from "@/components/editorial/ConfirmDialog";
import { deleteStory } from "@/lib/drafting";

/**
 * Delete a story, draft or published, with one confirmation.
 *
 * Deleting is the scholar's own act and cannot be undone, so the button asks
 * once, naming the story, before anything is sent. After the delete the page
 * refreshes, or goes where `redirectTo` says.
 */
export default function DeleteStoryButton({ storyId, title, redirectTo = null, compact = false }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function confirm() {
    setBusy(true);
    setError("");
    const r = await deleteStory(storyId);
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setAsking(false);
    if (redirectTo) router.push(redirectTo);
    else router.refresh();
  }

  function cancel() {
    setAsking(false);
    setError("");
  }

  return (
    <>
      <button type="button" className={compact ? "del-btn is-compact" : "del-btn"} onClick={() => setAsking(true)} aria-label={compact ? "Delete story" : undefined} title="Delete this story">
        <FaTrashCan size={11} aria-hidden /> {compact ? null : "Delete"}
      </button>
      {asking ? (
        <ConfirmDialog
          title="Delete this story?"
          confirmLabel="Delete"
          busyLabel="Deleting…"
          busy={busy}
          error={error}
          onConfirm={confirm}
          onCancel={cancel}
        >
          {title ? <b>“{String(title).slice(0, 80)}”</b> : "This story"} will be gone for good.
          {" "}Nothing here can bring it back.
        </ConfirmDialog>
      ) : null}
    </>
  );
}
