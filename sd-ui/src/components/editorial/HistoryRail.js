"use client";

import { useCallback, useEffect, useState } from "react";
import { FaClockRotateLeft } from "react-icons/fa6";

import { listStoryRevisions, restoreStoryRevision } from "@/lib/drafting";

/**
 * Every version of this story, newest first.
 *
 * The question it answers is "what did that change actually do, and can I have
 * the old one back". Putting a version back is itself a new version, so the
 * restore can be undone too, which is why this rail never warns about losing
 * anything: nothing is lost.
 *
 * Consecutive saves by one person collapse into one save point on the server,
 * so this reads as a handful of moments rather than a keystroke log.
 */

const SOURCE_LABEL = {
  scholar: "You",
  agent: "The agent",
  drafter: "The drafter",
  restore: "Restored",
};

function when(value) {
  if (!value) return "";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 36) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(then);
}

export default function HistoryRail({ storyId, version, dirty, onRestored }) {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    listStoryRevisions(storyId).then((r) => {
      if (!r.ok) { setError(r.error); return; }
      setError("");
      setRows(r.data.revisions);
    });
  }, [storyId]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load, version]);

  async function restore(v) {
    setBusy(v);
    setError("");
    const r = await restoreStoryRevision(storyId, v, version);
    setBusy(0);
    if (!r.ok) { setError(r.error); return; }
    onRestored?.(r.data);
  }

  if (error && !rows) return <p className="sc-write-msg is-error">{error}</p>;
  if (!rows) return <p className="st-muted">Reading the history…</p>;

  return (
    <div className="hist-wrap">
      <div className="sr-head">
        <span className="sc-kicker">Versions</span>
        <span className="st-todo-detail">now at {version}</span>
      </div>
      {dirty ? <p className="st-muted">You have unsaved edits. They become a version when you save.</p> : null}
      {error ? <p className="sc-write-msg is-error">{error}</p> : null}
      <ol className="hist-list">
        {rows.map((r) => (
          <li key={r.version} className={r.version === version ? "hist-item is-current" : "hist-item"}>
            <div className="hist-head">
              <span className={`hist-badge is-${r.source}`}>{SOURCE_LABEL[r.source] || r.source}</span>
              <span className="st-todo-detail">v{r.version} · {when(r.createdAt)}</span>
            </div>
            <div className="hist-title">{r.title || "Untitled"}</div>
            {r.note ? <div className="hist-note">“{r.note}”</div> : null}
            <div className="st-todo-detail">{r.words} words · {r.blocks} blocks</div>
            {r.version === version ? (
              <div className="ag-resolved">Showing now</div>
            ) : (
              <button type="button" className="sc-write-secondary st-btn" disabled={busy !== 0 || dirty} onClick={() => restore(r.version)}>
                <FaClockRotateLeft size={10} aria-hidden /> {busy === r.version ? "Putting it back…" : "Put this back"}
              </button>
            )}
          </li>
        ))}
      </ol>
      <p className="st-muted">Putting a version back makes it the newest version. Nothing is deleted, so you can undo it the same way.</p>
    </div>
  );
}
