"use client";

import { useEffect, useState } from "react";

import { getAgentIdeas } from "@/lib/drafting";

/**
 * Ideas: what the agent could do next for this scholar, on this page.
 *
 * Written by the studio agent's model after reading what is in front of the
 * scholar: for a story, the draft — every paragraph and what the checkers
 * said about it — the paragraph they are on and the paper's record; before
 * there is a story, their papers and the one they picked. Each idea is an
 * instruction they could have typed. Tapping one puts it in the composer, or
 * asks the agent to propose, as the page decides.
 *
 * Cached on the server per story version and paragraph, or per paper, so
 * coming back to the tab is not another model call.
 */

/**
 * @param {object} p
 * @param {string|null} [p.storyId]      ideas for this story
 * @param {number|null} [p.version]      the story's saved version, so ideas follow a save
 * @param {string|null} [p.paperKey]     before there is a story: the paper picked, `origin:id`
 * @param {number|null} [p.focusIndex]   the paragraph the scholar is on, from 1
 * @param {(idea:{text:string,propose:boolean})=>void} p.onPick
 * @param {boolean} [p.disabled]
 * @param {string} [p.note]
 */
export default function AgentIdeas({ storyId = null, version = null, paperKey = null, focusIndex = null, onPick, disabled = false, note }) {
  const key = `${storyId || "new"}:${version || ""}:${paperKey || ""}:${focusIndex || ""}`;
  const [got, setGot] = useState({ key: null, groups: [], error: "" });

  useEffect(() => {
    let alive = true;
    /* A moment's pause, so tapping through paragraphs asks once, for the one they stop on. */
    const t = setTimeout(() => {
      getAgentIdeas({ storyId, paperKey, focusIndex }).then((r) => {
        if (alive) setGot({ key, groups: r.ok ? r.data.groups || [] : [], error: r.ok ? "" : r.error });
      });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const loading = got.key !== key;
  return (
    <div className="rc-tab ws-ideas">
      <p className="rc-tab-title">Ideas</p>
      <p className="st-muted rc-tab-note">{note || "Things the agent could do next, after reading this page. Tap one to put it in the chat; change it before you send."}</p>
      {loading ? (
        <div className="ag-working" role="status" aria-live="polite"><div className="ag-working-line"><span className="ag-spinner" aria-hidden /> Reading the page for ideas…</div></div>
      ) : got.error ? (
        <p className="st-muted rc-tab-note">{got.error}</p>
      ) : !got.groups.length ? (
        <p className="st-muted rc-tab-note">No ideas just now. Tell the agent in Chat what you want instead.</p>
      ) : got.groups.map((g) => (
        <div key={g.title} className="rc-ask-group">
          <p className="rc-ask-group-title">{g.title}</p>
          <div className="ag-examples rc-examples">
            {g.ideas.map((s) => (
              <button key={s.text} type="button" className={`ag-example${s.action === "propose" ? " is-primary" : ""}`} disabled={disabled} onClick={() => onPick({ text: s.text, propose: s.action === "propose" })}>{s.text}</button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
