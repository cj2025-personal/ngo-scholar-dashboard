"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FaCheck, FaPaperPlane, FaXmark } from "react-icons/fa6";

import Kivyn from "@/components/kivyn/Kivyn";
import KivynButton from "@/components/kivyn/KivynButton";
import TypedText, { TypingDots } from "@/components/kivyn/TypedText";
import { useKivynMoment } from "@/components/kivyn/useKivynMoment";
import { askStoryAgent, listStoryTurns, resolveStoryTurn } from "@/lib/drafting";
import { AGENT_NAME, poseForStep } from "@/lib/kivyn/pose.mjs";

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
];

/* Kivyn beside each reply: still, so a thread does not blink at the reader from every line. */
const Face = () => <Kivyn variant="mark" size={28} />;

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

/**
 * One change, said as an edit: what goes struck through, what comes in
 * marked. A heading field reads the same way; a move says where from.
 */
function ChangeRow({ change }) {
  const label = { added: "Added", changed: "Changed", removed: "Removed", moved: "Moved", field: "Changed" }[change.kind] || change.kind;
  const where = change.kind === "field" ? change.field : `${change.type === "paragraph" || !change.type ? "paragraph" : change.type} ${change.index}${change.kind === "moved" ? ` (was ${change.from})` : ""}`;
  return (
    <div className={`ag-change is-${change.kind}`}>
      <div className="ag-change-head"><span className="sr-only">{label} · </span>{label === "Changed" ? "Proposed" : label} · {where}</div>
      <p className="ag-diff">
        {change.before ? <del className="ag-before">{change.before}</del> : null}
        {change.before && change.text ? " " : null}
        {change.text ? <ins className="ag-after">{change.text}</ins> : null}
      </p>
    </div>
  );
}

/** A check on the change, said as a tick or a warning, one line each. */
function CheckLine({ ok, warn = false, children }) {
  return <li className={ok ? "is-ok" : warn ? "is-warn" : "is-bad"}><span aria-hidden>{ok ? "✓" : "!"}</span> {children}</li>;
}

function Proposal({ turn, onAccept, onReject, busy, blocked = false }) {
  const c = turn.checks || {};
  const pending = turn.status === "proposed" && turn.changes.length > 0;
  return (
    <div className={`ag-proposal${pending ? " ag-approval" : ""}`}>
      <div className="ag-proposal-head">
        <span>{pending ? "Needs your approval · " : ""}{turn.changes.length ? `${turn.changes.length} change${turn.changes.length === 1 ? "" : "s"} proposed` : "No change"}</span>
        {turn.status !== "proposed" ? <span className="ag-resolved">{turn.status === "accepted" ? "Accepted" : "Rejected"}</span> : null}
      </div>
      {turn.changes.length ? <div className="ag-changes">{turn.changes.map((ch, i) => <ChangeRow key={i} change={ch} />)}</div> : <p className="st-muted">The draft is unchanged.</p>}
      {turn.changes.length ? (
        <ul className="ag-checks">
          {c.paragraphsChanged ? (
            <CheckLine ok={!c.unsupported && !c.partial} warn={Boolean(c.partial) && !c.unsupported}>
              {c.supported} of {c.paragraphsChanged} written paragraph{c.paragraphsChanged === 1 ? "" : "s"} supported by the paper
            </CheckLine>
          ) : null}
          {c.extensionsChanged ? (
            <CheckLine ok={!c.overreach && !c.reachPartial} warn={Boolean(c.reachPartial) && !c.overreach}>
              {c.follows} of {c.extensionsChanged} paragraph{c.extensionsChanged === 1 ? "" : "s"} beyond the paper follow{c.follows === 1 ? "s" : ""} from it
            </CheckLine>
          ) : null}
          {c.readability ? <CheckLine ok={c.readability.verdict === "pass"} warn={c.readability.verdict === "warn"}>reads at grade {c.readability.fkGrade}, target {c.readability.targetGrade}</CheckLine> : null}
          {c.imagesGenerated ? <CheckLine ok>{c.imagesGenerated} illustration{c.imagesGenerated === 1 ? "" : "s"} generated</CheckLine> : null}
          {c.refused ? <CheckLine ok={false}>{c.refused} step{c.refused === 1 ? "" : "s"} refused by the rules</CheckLine> : null}
        </ul>
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

/**
 * The turn under way: the step the agent is on, said as the server said it
 * and drawn as Kivyn doing it, and the steps already done beneath. Every line
 * here is a frame the agent sent; nothing advances on a clock but the
 * seconds.
 */
function Working({ activity }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSeconds((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const done = activity.done.filter((c) => c.name !== "finish");
  return (
    <div className="ag-working has-kv" role="status" aria-live="polite">
      <KivynButton pose={activity.pose} busy size={48} />
      <div className="ag-working-body">
        <div className="ag-working-line">{activity.message} <TypingDots label="working" /> <span className="ag-elapsed">{seconds}s</span></div>
        {done.length ? <Steps calls={done} /> : null}
      </div>
    </div>
  );
}

const STARTING = { pose: "reading", message: "Sending your instruction", done: [] };

export default function AgentPanel({ storyId, context = null, dirty = false, prefill = "", onPrefillTaken, onStoryChanged, onProposalPending, onProposalAt = null, onStatus }) {
  const [turns, setTurns] = useState([]);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState(STARTING);
  const [moment, showMoment] = useKivynMoment();
  const [error, setError] = useState("");
  const [useContext, setUseContext] = useState(true);
  /* Turns that arrived while the scholar watched: their summaries are typed in. */
  const [freshIds, setFreshIds] = useState(() => new Set());
  /* A proposal's card shows once its summary has been said, as a reply would. */
  const [saidIds, setSaidIds] = useState(() => new Set());
  const threadRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    let alive = true;
    listStoryTurns(storyId).then((r) => { if (alive && r.ok) setTurns(r.data.turns.slice().reverse()); });
    return () => { alive = false; };
  }, [storyId]);

  /* A conversation reads from its latest turn; an empty one from its heading,
     which a short screen used to scroll out of sight above the examples. A
     proposal appears once its summary is typed, and the thread follows it
     down so Accept is in view. */
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = turns.length || busy ? el.scrollHeight : 0;
  }, [turns.length, busy, saidIds]);

  const pending = turns.find((t) => t.status === "proposed" && t.changes?.length);
  useEffect(() => { onProposalPending?.(Boolean(pending)); }, [pending, onProposalPending]);
  /* Where the waiting change lands, so the article can mark those paragraphs: block numbers, counted from 1. */
  useEffect(() => {
    onProposalAt?.(pending ? pending.changes.filter((c) => c.kind === "changed" || c.kind === "removed" || c.kind === "moved").map((c) => Number(c.index)).filter((n) => n > 0) : []);
  }, [pending, onProposalAt]);
  /* The line under Kivyn's name, in the pane's head, and what it is drawn doing. */
  useEffect(() => {
    onStatus?.({
      text: busy ? activity.message : pending ? "A change is waiting for your decision" : turns.length ? `${turns.length} change${turns.length === 1 ? "" : "s"} discussed` : "Ready to edit what you ask",
      busy,
      pose: busy ? activity.pose : moment || "neutral",
      tone: !busy && pending ? "warn" : null,
    });
  }, [busy, activity, moment, pending, turns.length, onStatus]);

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
    setActivity(STARTING);
    showMoment(null);
    setBusy(true);
    setInstruction("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    const r = await askStoryAgent(storyId, ask, {
      onProgress: (e) => setActivity((cur) => {
        /* A tool's result: one more step done, and the agent still on it until it says what is next. */
        if (e.step === "tool_done") return { ...cur, done: [...cur.done, { name: e.tool, result: `${e.refused ? "refused" : "ok"}: ${e.detail || ""}` }] };
        return { ...cur, pose: poseForStep(e.step, e.tool), message: e.message || cur.message };
      }),
    });
    setBusy(false);
    if (!r.ok) { setError(r.error); setInstruction(text ?? ask); return; }
    setFreshIds((cur) => new Set(cur).add(r.data.turn.id));
    setTurns((cur) => (cur.some((t) => t.id === r.data.turn.id) ? cur : [...cur, r.data.turn]));
    /* Done when there is a change to read; open hands when there is nothing it could change. */
    showMoment(r.data.turn?.changes?.length ? "done" : "cant-answer");
  }

  async function resolve(turn, action) {
    setError("");
    setBusy(true);
    const r = await resolveStoryTurn(storyId, turn.id, action);
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setTurns((cur) => cur.map((t) => (t.id === turn.id ? r.data.turn : t)));
    if (action === "accept" && r.data.story) { onStoryChanged?.(r.data.story); showMoment("done"); }
    inputRef.current?.focus();
  }

  return (
    <div className="ag-panel">
      <div className="ag-thread" ref={threadRef}>
        {turns.length === 0 && !busy ? (
          <div className="ag-reply rc-intro">
            <Face />
            <div className="ag-reply-body ag-empty">
              <p className="ag-empty-title">What should change?</p>
              <p className="st-muted">Say it in plain words. I check the change against the paper and show it to you; nothing lands until you accept.</p>
              <div className="ag-examples">{EXAMPLES.map((e) => <button key={e} type="button" className="ag-example" onClick={() => send(e)}>{e}</button>)}</div>
            </div>
          </div>
        ) : null}
        {turns.map((t) => {
          const fresh = freshIds.has(t.id);
          /* A reply that just arrived is said first, then its card appears,
             the way a chat model's answer comes before its sources. */
          const said = !fresh || !t.summary || saidIds.has(t.id);
          return (
            <div key={t.id} className="ag-turn">
              <div className="ag-ask">{t.instruction}</div>
              <div className="ag-reply">
                <Face />
                <div className="ag-reply-body">
                  <Steps calls={t.calls} />
                  {t.summary ? <TypedText as="div" className="ag-summary" animate={fresh} text={t.summary} onDone={() => setSaidIds((cur) => (cur.has(t.id) ? cur : new Set(cur).add(t.id)))} /> : null}
                  {said ? <Proposal turn={t} busy={busy} blocked={blocked} onAccept={() => resolve(t, "accept")} onReject={() => resolve(t, "reject")} /> : null}
                </div>
              </div>
            </div>
          );
        })}
        {busy ? <Working activity={activity} /> : null}
        {error ? <p className="sc-write-msg is-error">{error}</p> : null}
      </div>

      <form className="ag-composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
        {contextUsable ? (
          <div className="ag-ctx">
            <button type="button" className={useContext ? "ag-ctx-chip on" : "ag-ctx-chip"} onClick={() => setUseContext((v) => !v)} aria-pressed={useContext} title={useContext ? `${AGENT_NAME} will apply your instruction to this paragraph unless you name another` : `Click to point ${AGENT_NAME} at this paragraph`}>
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
            placeholder={blocked ? `Save your edits first, so ${AGENT_NAME} works from the current text` : pending ? "Accept or reject the proposal above first" : "What should change?"}
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
