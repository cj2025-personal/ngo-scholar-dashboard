"use client";

import { useEffect, useRef, useState } from "react";
import { FaCheck, FaPaperPlane, FaXmark } from "react-icons/fa6";

import { askStoryAgent, listStoryTurns, resolveStoryTurn } from "@/lib/drafting";

/**
 * The agent, as a conversation about this draft.
 *
 * The scholar types what they want changed. What comes back is a proposal:
 * a summary, the changes block by block, the fact-check on what was written,
 * and two buttons. Nothing reaches the story until Accept; Reject discards
 * the proposal and any illustration it generated. Earlier turns stay in
 * view so "no, shorter" has something to refer to.
 */

const EXAMPLES = [
  "Shorten paragraph 2 to two sentences",
  "Add a paragraph about the limitations, citing the paper",
  "Make the opening plainer for a fifteen-year-old",
  "Delete the last section",
];

function ChangeRow({ change }) {
  const label = { added: "Added", changed: "Changed", removed: "Removed", moved: "Moved", field: "Changed" }[change.kind] || change.kind;
  const where = change.kind === "field" ? change.field : `block ${change.index}${change.kind === "moved" ? ` (was ${change.from})` : ""}`;
  return (
    <div className={`ag-change is-${change.kind}`}>
      <div className="ag-change-head"><b>{label}</b> · {where}{change.type ? ` · ${change.type}` : ""}</div>
      {change.before ? <div className="ag-before">{change.before}</div> : null}
      {change.text ? <div className="ag-after">{change.text}</div> : null}
    </div>
  );
}

function Proposal({ turn, onAccept, onReject, busy }) {
  const c = turn.checks || {};
  return (
    <div className="ag-proposal">
      <div className="ag-summary">{turn.summary}</div>
      {turn.changes.length ? <div className="ag-changes">{turn.changes.map((ch, i) => <ChangeRow key={i} change={ch} />)}</div> : <p className="st-muted">No changes were made.</p>}
      {turn.changes.length ? (
        <div className="ag-checks">
          {c.paragraphsChanged ? (
            <span className={c.unsupported ? "block-chip is-lost" : c.partial ? "block-chip is-partial" : "block-chip"}>
              {c.supported} of {c.paragraphsChanged} written paragraph{c.paragraphsChanged === 1 ? "" : "s"} supported by the paper
            </span>
          ) : null}
          {c.readability ? <span className={`block-chip ${c.readability.verdict === "pass" ? "" : c.readability.verdict === "warn" ? "is-partial" : "is-lost"}`}>reads at grade {c.readability.fkGrade} · target {c.readability.targetGrade}</span> : null}
          {c.imagesGenerated ? <span className="block-chip">{c.imagesGenerated} illustration{c.imagesGenerated === 1 ? "" : "s"} generated</span> : null}
          {c.refused ? <span className="block-chip is-lost">{c.refused} step{c.refused === 1 ? "" : "s"} refused by the rules</span> : null}
        </div>
      ) : null}
      {turn.warnings?.length ? <ul className="ag-warnings">{turn.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul> : null}
      {turn.status === "proposed" && turn.changes.length ? (
        <div className="ag-actions">
          <button type="button" className="sc-write-publish st-btn-primary" disabled={busy} onClick={onAccept}><FaCheck size={11} aria-hidden /> Accept</button>
          <button type="button" className="sc-write-secondary st-btn" disabled={busy} onClick={onReject}><FaXmark size={11} aria-hidden /> Reject</button>
        </div>
      ) : turn.status !== "proposed" ? (
        <div className="ag-resolved">{turn.status === "accepted" ? "Accepted" : "Rejected"}</div>
      ) : null}
    </div>
  );
}

export default function AgentPanel({ storyId, onStoryChanged, onProposalPending }) {
  const [turns, setTurns] = useState([]);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const listRef = useRef(null);

  useEffect(() => {
    let alive = true;
    listStoryTurns(storyId).then((r) => { if (alive && r.ok) setTurns(r.data.turns.slice().reverse()); });
    return () => { alive = false; };
  }, [storyId]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [turns.length, busy]);

  const pending = turns.find((t) => t.status === "proposed" && t.changes?.length);
  useEffect(() => { onProposalPending?.(Boolean(pending)); }, [pending, onProposalPending]);

  async function send(text) {
    const ask = (text ?? instruction).trim();
    if (!ask || busy) return;
    setError("");
    setBusy(true);
    setInstruction("");
    const r = await askStoryAgent(storyId, ask);
    setBusy(false);
    if (!r.ok) { setError(r.error); setInstruction(ask); return; }
    setTurns((cur) => [...cur, r.data.turn]);
  }

  async function resolve(turn, action) {
    setError("");
    setBusy(true);
    const r = await resolveStoryTurn(storyId, turn.id, action);
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setTurns((cur) => cur.map((t) => (t.id === turn.id ? r.data.turn : t)));
    if (action === "accept" && r.data.story) onStoryChanged?.(r.data.story);
  }

  return (
    <div className="ag-panel">
      <div className="ag-list" ref={listRef}>
        {turns.length === 0 && !busy ? (
          <div className="ag-empty">
            <p className="st-muted">Tell the agent what to change. It edits only what you ask, cites the passages it uses, and shows you the change before it lands.</p>
            <div className="ag-examples">{EXAMPLES.map((e) => <button key={e} type="button" className="ag-example" onClick={() => send(e)}>{e}</button>)}</div>
          </div>
        ) : null}
        {turns.map((t) => (
          <div key={t.id} className="ag-turn">
            <div className="ag-ask">{t.instruction}</div>
            <Proposal turn={t} busy={busy} onAccept={() => resolve(t, "accept")} onReject={() => resolve(t, "reject")} />
          </div>
        ))}
        {busy ? <div className="ag-working" role="status">Working on it…</div> : null}
        {error ? <p className="sc-write-msg is-error">{error}</p> : null}
      </div>
      <form className="ag-compose" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea
          className="ag-input"
          rows={2}
          placeholder={pending ? "Accept or reject the proposal above first" : "What should change?"}
          value={instruction}
          disabled={busy || Boolean(pending)}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
        />
        <button type="submit" className="sc-write-publish ag-send" disabled={busy || Boolean(pending) || !instruction.trim()} aria-label="Send"><FaPaperPlane size={12} aria-hidden /></button>
      </form>
    </div>
  );
}
