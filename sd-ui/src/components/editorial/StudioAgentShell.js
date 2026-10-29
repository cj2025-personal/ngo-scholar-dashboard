"use client";

import { useState } from "react";
import { FaXmark } from "react-icons/fa6";

import Kivyn from "@/components/kivyn/Kivyn";
import KivynButton from "@/components/kivyn/KivynButton";
import { AGENT_NAME } from "@/lib/kivyn/pose.mjs";

/**
 * The scholar's agent as a personal helper: one pane, shaped like a
 * messaging app rather than a toolbox.
 *
 * At the top, who it is: Kivyn, drawn doing what the agent is doing right
 * now, and a line under the name saying it in words. Tapping it opens what
 * Kivyn may and may not do, the story's history and its terms. Along the
 * foot, the sections: Chat, Ideas, Checks, Sources, whichever apply to the
 * page. Between them, whatever the current section shows.
 *
 * One name and one face, the same for every scholar: Kivyn is the product's
 * character, not a costume each person dresses, so a screenshot, a help page
 * and a colleague's screen all show the same helper.
 *
 * Three pieces rather than one wrapper, because the new-story agent holds a
 * running job and must keep its place in the tree while the page rearranges
 * around it: the workspace lays the identity above it and the tabs below it
 * without changing its ancestors. `StudioAgentShell` composes the pieces
 * for the review workspace, where nothing needs to survive a re-shape.
 *
 * The tabs keep `role="tab"` and the `ws-tab` class the workspace always
 * had, so the way the studio is driven and tested is unchanged.
 */

/**
 * The head: Kivyn in its pose, its name, and the line saying what it is
 * doing. Kivyn is its own button — a tap gets a reaction — and the name
 * beside it opens who Kivyn is, so the two never compete for one click.
 */
export function AgentIdentity({ status, busy = false, pose = "neutral", tone = null, about, onAbout, onClose, closeLabel = `Close ${AGENT_NAME}` }) {
  return (
    <div className="rc-head ws-agent-head">
      <KivynButton pose={pose} busy={busy} size={44} />
      <button type="button" className="rc-identity ws-identity" onClick={() => onAbout(!about)} aria-expanded={about} title={`Who ${AGENT_NAME} is, what it may do, and what it did`}>
        <span className="rc-identity-text">
          <b>{AGENT_NAME}</b>
          {/* A change waiting on the scholar is said here, in amber, beside
              the change: the one place it is announced. */}
          <span className={`rc-status${busy ? " is-busy" : ""}${tone ? ` is-${tone}` : ""}`} role="status">{status}</span>
        </span>
      </button>
      {onClose ? <button type="button" className="ag-rail-close" aria-label={closeLabel} onClick={onClose}><FaXmark size={13} aria-hidden /></button> : null}
    </div>
  );
}

/** Behind the face: who Kivyn is, what it may do, its terms, what it did. */
export function AgentAbout({ onClose, permissions, termsVersion = null, onTerms, activity = null, activityTitle = "What it did" }) {
  return (
    <div className="rc-about ws-about">
      <div className="rc-about-head ws-about-hero">
        <KivynButton size={88} />
        <div className="ws-about-who">
          <b className="ws-about-name">{AGENT_NAME}</b>
          <p className="ws-about-intro">A computer helper that reads your papers, drafts with you, and shows the passage behind what it writes.</p>
        </div>
        <button type="button" className="ag-rail-close" onClick={onClose} aria-label={`Back to ${AGENT_NAME}`}><FaXmark size={12} aria-hidden /></button>
      </div>

      <div className="rc-about-section">
        <p className="rc-tab-title">What {AGENT_NAME} may do</p>
        <ul className="rc-permissions">
          {permissions.map((p) => <li key={p.text} className={p.allowed ? "is-yes" : "is-no"}><span aria-hidden>{p.allowed ? "✓" : "✕"}</span> {p.text}</li>)}
        </ul>
        {termsVersion ? (
          <p className="ws-about-terms">Terms of {termsVersion}, agreed once and asked again only if they change. <button type="button" className="st-link" onClick={onTerms}>Read them</button></p>
        ) : null}
      </div>

      {activity ? (
        <div className="rc-about-section ws-about-activity">
          <p className="rc-tab-title">{activityTitle}</p>
          {activity}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The sections, as tabs along the top of the pane, under Kivyn's name: a
 * drawn icon and the word. At the foot they fell below the fold on a
 * laptop, so Checks and Sources could not be reached without scrolling.
 */
export function AgentTabs({ tabs, tab, onTab }) {
  if (!tabs || tabs.length < 2) return null;
  return (
    <div className="ws-tabs ws-tabs-top" role="tablist" aria-label="Agent sections">
      {tabs.map((t) => (
        <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`ws-tab${tab === t.key ? " on" : ""}`} onClick={() => onTab(t.key)}>
          <span className="ws-tab-ic" aria-hidden>{t.icon}</span>
          <span>{t.label}</span>
          {t.badge ? <span className="ws-tab-badge" aria-label={`${t.badge} to look at`}>{t.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

/**
 * Kivyn's pane, closed, on a wide screen: the strip it leaves on the left
 * edge, in the very place the pane's icon bar stands while it is open, so
 * closing reads as folding away rather than vanishing. Kivyn's face opens it
 * on the chat; each section's icon opens it on that section.
 */
export function AgentStrip({ tabs, onOpen }) {
  return (
    <nav className="ws-strip" aria-label={AGENT_NAME}>
      <button type="button" className="ws-strip-btn is-kivyn" onClick={() => onOpen("chat")} aria-label={`Open ${AGENT_NAME}`} title={`Open ${AGENT_NAME}`}>
        <Kivyn variant="mark" size={32} live />
      </button>
      {tabs.map((t) => (
        <button key={t.key} type="button" className="ws-strip-btn" onClick={() => onOpen(t.key)} aria-label={`${AGENT_NAME}: ${t.label}`} title={t.label}>
          <span className="ws-icon-tab-ic" aria-hidden>{t.icon}</span>
        </button>
      ))}
    </nav>
  );
}

/** The permissions the studio agent has, said the same way everywhere. */
export const STUDIO_PERMISSIONS = [
  { allowed: true, text: "Read your paper and this draft, and cite the passages it draws on" },
  { allowed: true, text: "Propose changes, section by section, and show every one before it lands" },
  { allowed: true, text: "Have every paragraph it writes checked against the paper by a separate judge" },
  { allowed: false, text: "Change the story without your acceptance, or publish anything" },
  { allowed: false, text: "Write in your voice, or put a claim under the paper's name that the paper does not make" },
  { allowed: false, text: "Do anything while you are away" },
];

/**
 * The pieces composed, for the review workspace.
 *
 * @param {object} p
 * @param {string} p.status
 * @param {boolean} [p.busy]
 * @param {string} [p.pose]   what Kivyn is drawn doing; see lib/kivyn/pose.mjs
 * @param {{key:string,label:string,icon:string,badge?:number}[]} p.tabs
 * @param {string} p.tab
 * @param {(key:string)=>void} p.onTab
 * @param {string|null} [p.termsVersion]
 * @param {()=>void} [p.onTerms]
 * @param {import("react").ReactNode} [p.activity]
 * @param {string} [p.activityTitle]
 * @param {import("react").ReactNode} p.children   the current tab's body
 */
export default function StudioAgentShell({ status, busy = false, pose = "neutral", tone = null, tabs, tab, onTab, termsVersion = null, onTerms, activity = null, activityTitle, onClose = null, children }) {
  const [about, setAbout] = useState(false);
  return (
    <div className="ag-panel ws-agent">
      <AgentIdentity status={status} busy={busy} pose={pose} tone={tone} about={about} onAbout={setAbout} onClose={onClose} closeLabel={`Close ${AGENT_NAME}`} />
      {about ? (
        <AgentAbout onClose={() => setAbout(false)} permissions={STUDIO_PERMISSIONS} termsVersion={termsVersion} onTerms={onTerms} activity={activity} activityTitle={activityTitle} />
      ) : (
        <>
          <AgentTabs tabs={tabs} tab={tab} onTab={onTab} />
          <div className="ws-agent-body">{children}</div>
        </>
      )}
    </div>
  );
}
