"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FaTrashCan } from "react-icons/fa6";

import { deleteStory } from "@/lib/drafting";

/**
 * Delete a story, draft or published, with one confirmation in place.
 *
 * Deleting is the scholar's own act and cannot be undone, so the button
 * asks once, right where it was clicked, with the title in the question.
 * After the delete the page refreshes, or goes where `redirectTo` says.
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

  if (asking) {
    return (
      <span className="del-confirm" role="alertdialog" aria-label="Confirm delete">
        <span>Delete {title ? `“${String(title).slice(0, 60)}”` : "this story"}? This cannot be undone.</span>
        <button type="button" className="del-yes" disabled={busy} onClick={confirm}>{busy ? "Deleting…" : "Delete"}</button>
        <button type="button" className="st-link" disabled={busy} onClick={() => setAsking(false)}>Keep</button>
        {error ? <span className="del-error">{error}</span> : null}
      </span>
    );
  }
  return (
    <button type="button" className={compact ? "del-btn is-compact" : "del-btn"} onClick={() => setAsking(true)} aria-label={compact ? "Delete story" : undefined} title="Delete this story">
      <FaTrashCan size={11} aria-hidden /> {compact ? null : "Delete"}
    </button>
  );
}
