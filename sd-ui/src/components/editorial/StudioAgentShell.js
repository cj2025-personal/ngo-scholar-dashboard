"use client";

import { useState } from "react";
import { FaXmark } from "react-icons/fa6";

import { FACES, TONES, usePersona } from "@/lib/persona";
import AgentFace from "./AgentFace";

/**
 * The scholar's agent as a personal helper: one pane, shaped like a
 * messaging app rather than a toolbox.
 *
 * At the top, who it is: a name and a face the scholar chose, and a line
 * under the name saying what it is doing right now. Tapping it opens what
 * the agent may and may not do, the story's history, its terms, and the
 * controls to rename it. Along the foot, the sections: Chat, Ideas, Checks,
 * Sources, whichever apply to the page. Between them, whatever the current
 * section shows.
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

export const STUDIO_PERSONA_KEY = "sd:studio-agent";
export const STUDIO_PERSONA_DEFAULT = { name: "Agent", face: "A", tone: "navy" };

export function useStudioPersona() {
  return usePersona(STUDIO_PERSONA_KEY, STUDIO_PERSONA_DEFAULT);
}

/** The head: face, name, and the line saying what the agent is doing. */
export function AgentIdentity({ status, busy = false, about, onAbout, onClose, closeLabel = "Close the agent" }) {
  const [persona] = useStudioPersona();
  return (
    <div className="rc-head ws-agent-head">
      <button type="button" className="rc-identity ws-identity" onClick={() => onAbout(!about)} aria-expanded={about} title="Who this is, what it may do, and what it did">
        <AgentFace persona={persona} size="md" />
        <span className="rc-identity-text">
          <b>{persona.name}</b>
          <span className={`rc-status${busy ? " is-busy" : ""}`}>{busy ? <span className="ag-spinner rc-step-spinner" aria-hidden /> : null}{status}</span>
        </span>
      </button>
      {onClose ? <button type="button" className="ag-rail-close" aria-label={closeLabel} onClick={onClose}><FaXmark size={13} aria-hidden /></button> : null}
    </div>
  );
}

/** Behind the face: rename it, what it may do, its terms, what it did. */
export function AgentAbout({ onClose, permissions, termsVersion = null, onTerms, activity = null, activityTitle = "What it did" }) {
  const [persona, setPersona] = useStudioPersona();
  const [name, setName] = useState(persona.name);
  const commitName = () => setPersona({ ...persona, name: name.trim().slice(0, 24) || STUDIO_PERSONA_DEFAULT.name });
  return (
    <div className="rc-about ws-about">
      <div className="rc-about-head">
        <AgentFace persona={persona} size="lg" />
        <div className="rc-about-name">
          <label className="rc-about-label" htmlFor="ws-agent-name">Name</label>
          <input id="ws-agent-name" className="rc-name-input" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} onBlur={commitName} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitName(); e.currentTarget.blur(); } }} />
        </div>
        <button type="button" className="ag-rail-close" onClick={onClose} aria-label="Back to the agent"><FaXmark size={12} aria-hidden /></button>
      </div>
      <div className="rc-about-row">
        <span className="rc-about-label">Face</span>
        <div className="rc-faces">{FACES.map((f) => <button key={f} type="button" className={`rc-face-pick${persona.face === f ? " on" : ""}`} aria-pressed={persona.face === f} onClick={() => setPersona({ ...persona, face: f })}>{f}</button>)}</div>
      </div>
      <div className="rc-about-row">
        <span className="rc-about-label">Colour</span>
        <div className="rc-tones">{TONES.map((t) => <button key={t} type="button" className={`rc-tone-pick is-${t}${persona.tone === t ? " on" : ""}`} aria-pressed={persona.tone === t} aria-label={t} onClick={() => setPersona({ ...persona, tone: t })} />)}</div>
      </div>

      <div className="rc-about-section">
        <p className="rc-tab-title">What {persona.name} may do</p>
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

/** The foot: the sections, as tabs. */
export function AgentTabs({ tabs, tab, onTab }) {
  if (!tabs || tabs.length < 2) return null;
  return (
    <div className="rc-tabs ws-tabs" role="tablist" aria-label="Agent sections" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
      {tabs.map((t) => (
        <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`ws-tab rc-tab-btn${tab === t.key ? " on" : ""}`} onClick={() => onTab(t.key)}>
          <span className="rc-tab-ic" aria-hidden>{t.icon}</span>
          <span>{t.label}{t.badge ? <span className="ws-tab-badge">{t.badge}</span> : null}</span>
        </button>
      ))}
    </div>
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
 * @param {{key:string,label:string,icon:string,badge?:number}[]} p.tabs
 * @param {string} p.tab
 * @param {(key:string)=>void} p.onTab
 * @param {string|null} [p.termsVersion]
 * @param {()=>void} [p.onTerms]
 * @param {import("react").ReactNode} [p.activity]
 * @param {string} [p.activityTitle]
 * @param {import("react").ReactNode} p.children   the current tab's body
 */
export default function StudioAgentShell({ status, busy = false, tabs, tab, onTab, termsVersion = null, onTerms, activity = null, activityTitle, children }) {
  const [about, setAbout] = useState(false);
  return (
    <div className="ag-panel ws-agent">
      <AgentIdentity status={status} busy={busy} about={about} onAbout={setAbout} />
      {about ? (
        <AgentAbout onClose={() => setAbout(false)} permissions={STUDIO_PERMISSIONS} termsVersion={termsVersion} onTerms={onTerms} activity={activity} activityTitle={activityTitle} />
      ) : (
        <>
          <div className="ws-agent-body">{children}</div>
          <AgentTabs tabs={tabs} tab={tab} onTab={onTab} />
        </>
      )}
    </div>
  );
}
