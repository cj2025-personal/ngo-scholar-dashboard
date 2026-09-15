"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FaCheck, FaPaperPlane, FaXmark } from "react-icons/fa6";

import { askStoryAgent, listStoryTurns, resolveStoryTurn } from "@/lib/drafting";

/**
 * The agent console: a thread with the agent, and a composer docked at the
 * bottom, the way a coding agent is driven.
 *
 * The scholar types what they want changed. What comes back is a turn: the
 * steps the agent took (each tool call and what the rules said to it), a
 * one-line summary, the change block by block, the fact-check on what was
 * written, and Accept / Reject. Nothing reaches the story until Accept.
 * The paragraph the scholar is on is offered as context, so "make this
 * plainer" needs no block number.
 */

const EXAMPLES = [
  "Shorten paragraph 2 to two sentences",
  "Add a paragraph about the limitations, citing the paper",
  "Make the opening plainer for a fifteen-year-old",
  "Add an illustration of the experiment after paragraph 1",
  "Delete the last section",
];

const WORKING_PHASES = ["Reading the draft", "Searching the paper", "Writing the change", "Checking it against the passages"];

function stepLabel(call) {
  const refused = /^refused/.test(call.result || "");
  const detail = String(call.result || "").replace(/^(ok|refused):\s*/, "");
  const verb = {
    replace_block: "Rewrote a block",
    insert_block: "Inserted a block",
    delete_block: "Removed a block",
    move_block: "Moved a block",
    set_heading_fields: "Changed the heading",
    add_image: "Generated an illustration",
    search_passages: "Searched the paper",
    finish: "Finished",
  }[call.name] || call.name;
  return { verb: refused ? `Tried to ${verb.charAt(0).toLowerCase()}${verb.slice(1)}` : verb, detail, refused };
}

function Steps({ calls }) {
  const shown = (calls || []).filter((c) => c.name !== "finish");
  if (!shown.length) return null;
  return (
    <ol className="ag-steps">
      {shown.map((c, i) => {
        const s = stepLabel(c);
        return (
          <li key={i} className={s.refused ? "ag-step is-refused" : "ag-step"}>
            <span className="ag-step-ic" aria-hidden>{s.refused ? "!" : "✓"}</span>
            <span>{s.verb}{s.detail ? <span className="ag-step-result"> · {s.detail}</span> : null}</span>
          </li>
        );
      })}
    </ol>
  );
}

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

function Proposal({ turn, onAccept, onReject, busy, blocked = false }) {
  const c = turn.checks || {};
  const pending = turn.status === "proposed" && turn.changes.length > 0;
  return (
    <div className="ag-proposal">
      <div className="ag-proposal-head">
        <span>{turn.changes.length ? `${turn.changes.length} change${turn.changes.length === 1 ? "" : "s"} proposed` : "No change"}</span>
        {turn.status !== "proposed" ? <span className="ag-resolved">{turn.status === "accepted" ? "Accepted" : "Rejected"}</span> : null}
      </div>
      {turn.changes.length ? <div className="ag-changes">{turn.changes.map((ch, i) => <ChangeRow key={i} change={ch} />)}</div> : <p className="st-muted">The draft is unchanged.</p>}
      {turn.changes.length ? (
        <div className="ag-checks">
          {c.paragraphsChanged ? (
            <span className={c.unsupported ? "block-chip is-lost" : c.partial ? "block-chip is-partial" : "block-chip"}>
              {c.supported} of {c.paragraphsChanged} written paragraph{c.paragraphsChanged === 1 ? "" : "s"} supported by the paper
            </span>
          ) : null}
          {c.extensionsChanged ? (
            <span className={c.overreach ? "block-chip is-lost" : c.reachPartial ? "block-chip is-partial" : "block-chip is-reach"}>
              {c.follows} of {c.extensionsChanged} paragraph{c.extensionsChanged === 1 ? "" : "s"} beyond the paper follow{c.follows === 1 ? "s" : ""} from it
            </span>
          ) : null}
          {c.readability ? <span className={`block-chip ${c.readability.verdict === "pass" ? "" : c.readability.verdict === "warn" ? "is-partial" : "is-lost"}`}>reads at grade {c.readability.fkGrade} · target {c.readability.targetGrade}</span> : null}
          {c.imagesGenerated ? <span className="block-chip">{c.imagesGenerated} illustration{c.imagesGenerated === 1 ? "" : "s"} generated</span> : null}
          {c.refused ? <span className="block-chip is-lost">{c.refused} step{c.refused === 1 ? "" : "s"} refused by the rules</span> : null}
        </div>
      ) : null}
      {turn.warnings?.length ? <ul className="ag-warnings">{turn.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul> : null}
      {pending ? (
        <div className="ag-actions">
          <button type="button" className="sc-write-publish st-btn-primary" disabled={busy || blocked} onClick={onAccept}><FaCheck size={11} aria-hidden /> Accept</button>
          <button type="button" className="sc-write-secondary st-btn" disabled={busy} onClick={onReject}><FaXmark size={11} aria-hidden /> Reject</button>
          <span className="ag-actions-hint">{blocked ? "Save your edits first" : "Nothing changes until you accept"}</span>
        </div>
      ) : null}
    </div>
  );
}

function Working() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSeconds((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const phase = WORKING_PHASES[Math.min(WORKING_PHASES.length - 1, Math.floor(seconds / 3))];
  return (
    <div className="ag-working" role="status" aria-live="polite">
      <div className="ag-working-line"><span className="ag-spinner" aria-hidden /> Working on it… <span className="ag-elapsed">{seconds}s</span></div>
      <div className="ag-step"><span className="ag-step-ic" aria-hidden>…</span><span>{phase}</span></div>
    </div>
  );
}

export default function AgentPanel({ storyId, context = null, dirty = false, prefill = "", onPrefillTaken, onStoryChanged, onProposalPending }) {
  const [turns, setTurns] = useState([]);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [useContext, setUseContext] = useState(true);
  const threadRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    let alive = true;
    listStoryTurns(storyId).then((r) => { if (alive && r.ok) setTurns(r.data.turns.slice().reverse()); });
    return () => { alive = false; };
  }, [storyId]);

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [turns.length, busy]);

  const pending = turns.find((t) => t.status === "proposed" && t.changes?.length);
  useEffect(() => { onProposalPending?.(Boolean(pending)); }, [pending, onProposalPending]);

  const grow = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(160, el.scrollHeight)}px`;
  }, []);

  /* The agent reads the story as saved. Acting while there is unsaved typing
     would either ignore it or overwrite it, so the composer waits. A draft
     autosaves within a couple of seconds, so this is usually invisible. */
  const blocked = dirty;
  /* An instruction handed in from elsewhere, such as the record banner. */
  useEffect(() => {
    if (!prefill) return undefined;
    const t = setTimeout(() => {
      setInstruction(prefill);
      onPrefillTaken?.();
      inputRef.current?.focus();
      grow();
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  const contextUsable = Boolean(context && context.type !== "image" && context.index);
  const mentionsBlock = (text) => /(?:block|paragraph|section|heading)\s+\d+/i.test(text);

  async function send(text) {
    let ask = (text ?? instruction).trim();
    if (!ask || busy) return;
    if (text === undefined && contextUsable && useContext && !mentionsBlock(ask)) ask = `${ask} (paragraph ${context.index})`;
    setError("");
    setBusy(true);
    setInstruction("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    const r = await askStoryAgent(storyId, ask);
    setBusy(false);
    if (!r.ok) { setError(r.error); setInstruction(text ?? ask); return; }
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
    inputRef.current?.focus();
  }

  return (
    <div className="ag-panel">
      <div className="ag-head">
        <span><b>Agent</b> · edits only what you ask, from the paper</span>
        <span className="ag-head-status"><span className={`st-dot ${busy ? "is-navy" : pending ? "is-warn" : "is-ok"}`} aria-hidden />{busy ? "Working" : pending ? "Awaiting your decision" : "Ready"}</span>
      </div>

      <div className="ag-thread" ref={threadRef}>
        {turns.length === 0 && !busy ? (
          <div className="ag-empty">
            <p className="ag-empty-title">What should change?</p>
            <p className="st-muted">Ask in plain words. The agent reads the draft and the paper, makes the change, checks it against the passages, and shows it to you before it lands. Try one of these:</p>
            <div className="ag-examples">{EXAMPLES.map((e) => <button key={e} type="button" className="ag-example" onClick={() => send(e)}>{e}</button>)}</div>
          </div>
        ) : null}
        {turns.map((t) => (
          <div key={t.id} className="ag-turn">
            <div className="ag-ask">{t.instruction}</div>
            <div className="ag-reply">
              <span className="ag-avatar" aria-hidden>A</span>
              <div className="ag-reply-body">
                <Steps calls={t.calls} />
                {t.summary ? <div className="ag-summary">{t.summary}</div> : null}
                <Proposal turn={t} busy={busy} blocked={blocked} onAccept={() => resolve(t, "accept")} onReject={() => resolve(t, "reject")} />
              </div>
            </div>
          </div>
        ))}
        {busy ? <Working /> : null}
        {error ? <p className="sc-write-msg is-error">{error}</p> : null}
      </div>

      <form className="ag-composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
        {contextUsable ? (
          <div className="ag-ctx">
            <button type="button" className={useContext ? "ag-ctx-chip on" : "ag-ctx-chip"} onClick={() => setUseContext((v) => !v)} aria-pressed={useContext} title={useContext ? "The agent will apply your instruction to this paragraph unless you name another" : "Click to point the agent at this paragraph"}>
              <span>¶ {context.index}</span>
              <span className="ag-ctx-text">{context.text}</span>
            </button>
            <span className="st-todo-detail">{useContext ? "in focus" : "not in focus"}</span>
          </div>
        ) : null}
        <div className="ag-box">
          <textarea
            ref={inputRef}
            className="ag-input"
            rows={1}
            placeholder={blocked ? "Save your edits first, so the agent works from the current text" : pending ? "Accept or reject the proposal above first" : "What should change?"}
            value={instruction}
            disabled={busy || Boolean(pending) || blocked}
            onChange={(e) => { setInstruction(e.target.value); grow(); }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          />
          <button type="submit" className="sc-write-publish ag-send" disabled={busy || Boolean(pending) || blocked || !instruction.trim()} aria-label="Send"><FaPaperPlane size={12} aria-hidden /></button>
        </div>
        <div className="ag-hint">
          <span><kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line</span>
          <span>{blocked ? "Waiting for your edits to save" : pending ? "One proposal at a time" : "Nothing is saved until you accept"}</span>
        </div>
      </form>
    </div>
  );
}
