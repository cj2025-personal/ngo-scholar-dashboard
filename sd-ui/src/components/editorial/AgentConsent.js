"use client";

import { useEffect, useRef } from "react";
import { FaCheck } from "react-icons/fa6";

/**
 * The agent's terms, asked once.
 *
 * The agent drafts from the scholar's own papers under the scholar's own
 * byline, sends the paper's text to a model provider to do it, and keeps
 * every instruction as the record behind the story. None of that should be
 * implied by a button. It is said here, plainly, before the agent writes a
 * word — and said again only when the terms change, which is why the sheet
 * carries a version and sends it back with the agreement.
 *
 * A sheet, not a page: the story the scholar has open stays where it is.
 */
export default function AgentConsent({ version, busy = false, error = "", onAgree, onClose }) {
  const agreeRef = useRef(null);

  useEffect(() => {
    agreeRef.current?.focus();
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="pc-scrim" role="dialog" aria-modal="true" aria-labelledby="ac-title">
      <div className="pc-modal ac-modal">
        <span className="sc-kicker">Before the agent writes with you</span>
        <h2 id="ac-title" className="ac-title">It drafts from your papers, under your name. Here is what that means.</h2>
        <ol className="ac-terms">
          <li><b>It writes from your paper, and only that.</b> Every paragraph is checked against the passages it cites. Anything that goes beyond the paper is marked as such and checked to follow from it.</li>
          <li><b>It publishes nothing.</b> Outlines, drafts and edits wait for you. What goes out is your decision, under your byline, and your responsibility as its author.</li>
          <li><b>Your paper&rsquo;s text and your instructions go to the model provider</b> to write with, and are kept as the record behind the story &mdash; the evidence a reader can open.</li>
          <li><b>It can be wrong.</b> Read every line before you publish, as you would a co-author&rsquo;s draft. Illustrations it generates are marked as generated.</li>
        </ol>
        {error ? <p className="sc-write-msg is-error">{error}</p> : null}
        <div className="ac-actions">
          <button ref={agreeRef} type="button" className="sc-write-publish st-btn-primary" disabled={busy} onClick={onAgree}>
            <FaCheck size={11} aria-hidden /> I agree
          </button>
          <button type="button" className="sc-write-secondary st-btn" disabled={busy} onClick={onClose}>Not now</button>
          <span className="ac-version">Terms of {version || "today"} &middot; asked again only if they change</span>
        </div>
      </div>
    </div>
  );
}
