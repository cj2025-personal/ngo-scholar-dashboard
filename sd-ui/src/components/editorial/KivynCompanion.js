"use client";

import Link from "next/link";
import { HiOutlineArrowRight, HiOutlineChatBubbleLeftRight } from "react-icons/hi2";

import KivynButton from "@/components/kivyn/KivynButton";
import { AGENT_NAME } from "@/lib/kivyn/pose.mjs";

/**
 * Kivyn, at home beside a new story while its pane is closed.
 *
 * The page used to be a 760-pixel editor in the middle of the screen, with
 * the agent a pill in the corner: a desk of empty space around a blank sheet,
 * and the one thing that could fill the sheet the smallest thing on it. Here
 * Kivyn stands on the left — where its pane opens — and says what it does,
 * offers the scholar's own papers to start from in one tap, and the way to
 * talk to it instead. Starting from a paper opens the pane with that paper
 * chosen; Kivyn asks what the article should be.
 *
 * Once the scholar has written something, the card steps back to a line and
 * a button: they are writing, and Kivyn is there when they want it.
 *
 * Every word about papers comes from the inventory the pane already loaded;
 * nothing here is guessed. Below the width where the card fits beside the
 * sheet, the stylesheet hides it and the corner nudge does the job.
 *
 * @param {object} p
 * @param {object|null} p.inventory   what the scholar may draft from, as the drafting API reports it
 * @param {{name?: string}|null} p.me
 * @param {boolean} p.hasText          the page already has writing in it
 * @param {() => void} p.onOpen        open the pane, as it is
 * @param {(paper: object|null) => void} p.onStart   open the pane on this paper, or on the list of them
 */
export default function KivynCompanion({ inventory, me = null, hasText = false, onOpen, onStart }) {
  const first = (me?.name || "").split(/\s+/)[0];
  const papers = inventory?.draftable || [];
  const shown = papers.slice(0, 3);

  if (hasText) {
    return (
      <aside className="kv-companion is-compact" aria-label={AGENT_NAME}>
        <div className="kvc-card">
          <div className="kvc-hero">
            <KivynButton size={64} />
            <div className="kvc-who">
              <b className="kvc-name">{AGENT_NAME}</b>
              <span className="kvc-sub">Here when you want a hand</span>
            </div>
          </div>
          <p className="kvc-lead">Want a draft from one of your papers? It lands after what you have written, every paragraph cited.</p>
          <button type="button" className="sc-write-publish kvc-cta" onClick={onOpen}><HiOutlineChatBubbleLeftRight size={15} aria-hidden /> Ask {AGENT_NAME}</button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="kv-companion" aria-label={AGENT_NAME}>
      <div className="kvc-card">
        <div className="kvc-hero">
          <KivynButton size={84} />
          <div className="kvc-who">
            <span className="kvc-kicker">Your writing helper</span>
            <b className="kvc-name">Hi{first ? `, ${first}` : ""}. I’m {AGENT_NAME}.</b>
          </div>
        </div>
        <p className="kvc-lead">Choose a paper and I will plan the article, then draft it here for you to edit, every paragraph showing the passage it came from.</p>

        {!inventory ? (
          <div className="kvc-papers is-loading" aria-hidden="true"><span /><span /><span /></div>
        ) : !inventory.eligible ? (
          <p className="kvc-note">{inventory.gateReason || "Drafting from your papers is not open to you yet."}</p>
        ) : !papers.length ? (
          <p className="kvc-note">{inventory.nudge || "Nothing is ready to draft from yet."} <Link href="/papers" className="st-link">Your papers</Link></p>
        ) : (
          <div className="kvc-section">
            <p className="kvc-label">Start from a paper</p>
            <ul className="kvc-papers">
              {shown.map((p) => (
                <li key={`${p.origin}:${p.id}`}>
                  <button type="button" className="kvc-paper" onClick={() => onStart(p)}>
                    <span className="kvc-paper-title">{p.title}</span>
                    <span className="kvc-paper-meta">
                      {[p.year, p.wordCount ? `${Number(p.wordCount).toLocaleString()} words` : null].filter(Boolean).join(" · ")}
                      <span className="kvc-paper-go">Start <HiOutlineArrowRight size={12} aria-hidden /></span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {papers.length > shown.length ? <button type="button" className="st-link kvc-more" onClick={() => onStart(null)}>All {papers.length} papers</button> : null}
          </div>
        )}

        <button type="button" className="sc-write-publish kvc-cta" onClick={onOpen}><HiOutlineChatBubbleLeftRight size={15} aria-hidden /> Tell {AGENT_NAME} what to write</button>

        <ol className="kvc-steps" aria-label="How it works">
          <li><span><b>You choose</b> the paper and reader</span></li>
          <li><span><b>{AGENT_NAME} plans</b> it from the passages</span></li>
          <li><span><b>You approve</b> and it is drafted here</span></li>
        </ol>
        <p className="kvc-or">Or start writing on the page yourself.</p>
      </div>
    </aside>
  );
}
