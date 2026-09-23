"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FaTrashCan } from "react-icons/fa6";

import ConfirmDialog from "@/components/editorial/ConfirmDialog";
import { discardStoryLevels } from "@/lib/drafting";

/**
 * Throw away reading levels the scholar does not want.
 *
 * Until this existed a level could be written, rewritten and approved but
 * never removed, so a scholar who did not want the ages 8–11 version was
 * asked to approve it for as long as the story lived. With no band named it
 * discards the ones waiting — exactly what the Studio queue is nagging
 * about. Named bands may include one that is live, and then readers stop
 * seeing it, so the question says so before it happens.
 *
 * @param {string} storyId
 * @param {string[]|null} audiences  bands to discard, or null for every one waiting
 * @param {number} count             how many the question should name
 * @param {boolean} live             whether what goes is currently shown to readers
 */
export default function DiscardLevelsButton({ storyId, audiences = null, count = 0, live = false, label = "Discard", onDone = null, compact = false }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function confirm() {
    setBusy(true);
    setError("");
    const r = await discardStoryLevels(storyId, { audiences });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setAsking(false);
    if (onDone) onDone(r.data);
    else router.refresh();
  }

  function cancel() {
    setAsking(false);
    setError("");
  }

  /* Named bands are counted; the general discard takes every level the
     scholar has not approved, which is not the same as the "waiting" count on
     the queue — that one leaves out the levels gone stale. So it says what it
     does rather than a number that could be wrong. */
  const named = Array.isArray(audiences) && audiences.length > 0;
  const what = named
    ? (count === 1 ? "this reading level" : `these ${count} reading levels`)
    : "every reading level you have not approved";
  const them = named && count === 1 ? "it" : "them";

  return (
    <>
      <button type="button" className={compact ? "del-btn is-compact" : "del-btn"} onClick={() => setAsking(true)} title="Discard these reading levels">
        <FaTrashCan size={11} aria-hidden /> {compact ? null : label}
      </button>
      {asking ? (
        <ConfirmDialog
          title={named && count === 1 ? "Discard this reading level?" : "Discard these reading levels?"}
          confirmLabel="Discard"
          busyLabel="Discarding…"
          busy={busy}
          error={error}
          onConfirm={confirm}
          onCancel={cancel}
        >
          This throws away {what}.{" "}
          {live ? `Readers will stop seeing ${them}.` : "The article itself is not touched."}{" "}
          You can write {them} again later.
        </ConfirmDialog>
      ) : null}
    </>
  );
}
