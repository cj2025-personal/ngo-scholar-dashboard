"use client";

import { useState } from "react";
import { FaTriangleExclamation } from "react-icons/fa6";

import { acknowledgeStoryRecord } from "@/lib/drafting";

/**
 * The scientific record has moved against this article's source.
 *
 * A retraction or a correction of the paper is the one thing that must not
 * sit quietly in a side rail. This is a banner across the top, naming what
 * happened, when, and which paragraphs rest on the paper, with the three
 * things a scholar can do about it: have the agent draft a notice, take the
 * article down, or say they have seen it.
 */
export default function RecordBanner({ storyId, record, status, onAskAgent, onUnpublish, onAcknowledged }) {
  const [busy, setBusy] = useState(false);
  if (!record?.alerts?.length) return null;
  const worst = record.alerts[0];
  const grave = record.alerts.some((a) => a.kind === "retracted" || a.kind === "withdrawn");
  const affected = [...new Set(record.alerts.flatMap((a) => a.affectedBlocks || []))];

  const instruction = grave
    ? `The paper this article is drawn from was ${worst.kind} (${worst.noticeUrl || "see the notice"}). Add a clearly worded notice at the top saying so, and remove or qualify every claim that rests on it. Do not invent a reason.`
    : `The paper this article is drawn from was corrected (${worst.noticeUrl || "see the notice"}). Add a short note saying so, and check whether any claim here needs to change.`;

  async function acknowledge() {
    setBusy(true);
    const r = await acknowledgeStoryRecord(storyId);
    setBusy(false);
    if (r.ok) onAcknowledged?.(r.data.story);
  }

  return (
    <div className={grave ? "rec-banner is-grave" : "rec-banner"} role="alert">
      <span className="rec-ic" aria-hidden><FaTriangleExclamation size={13} /></span>
      <div className="rec-body">
        <b>{record.headline}</b>
        <div className="st-todo-detail">
          {affected.length ? `Paragraph${affected.length === 1 ? "" : "s"} ${affected.join(", ")} rest${affected.length === 1 ? "s" : ""} on it. ` : ""}
          {worst.noticeUrl ? <a href={worst.noticeUrl} target="_blank" rel="noreferrer">Read the notice</a> : null}
          {record.checkedAt ? ` · checked ${new Date(record.checkedAt).toLocaleDateString()}` : ""}
          {record.acknowledgedAt ? " · seen" : ""}
        </div>
        <div className="rec-actions">
          <button type="button" className="sc-write-secondary st-btn" onClick={() => onAskAgent?.(instruction)}>Have the agent draft a notice</button>
          {status !== "draft" ? <button type="button" className="sc-write-secondary st-btn" onClick={onUnpublish}>Take it down</button> : null}
          {!record.acknowledgedAt ? <button type="button" className="st-link" disabled={busy} onClick={acknowledge}>I have seen this</button> : null}
        </div>
      </div>
    </div>
  );
}
