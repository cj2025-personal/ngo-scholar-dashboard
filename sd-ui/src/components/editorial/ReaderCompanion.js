"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FaPaperPlane, FaXmark } from "react-icons/fa6";

import { askCompanion, forgetMe, getCompanionThread, getMyCompanionTurns } from "@/lib/reader";

/**
 * The reading companion: a thread beside the article, for a reader with a
 * question about it.
 *
 * The reader asks in plain words. Their question takes its place in the
 * thread at once; under it, the work arrives step by step as it happens,
 * then the answer once the Sentinel has read it back. Every answer says
 * where it came from: the story, background on a word, or "the story
 * doesn't say". Citations point back at the paragraph, or open the passage
 * of the paper it rests on. Once a turn is done its steps fold into one
 * line, so a long thread reads as a conversation and not as a log.
 *
 * On a wide screen the article moves over and the two sit side by side; on
 * a phone the companion is a sheet over the bottom of the page. A reader
 * can see everything they asked and can be forgotten, from the same panel.
 *
 * Nothing here knows who the reader is. Neither does the server.
 */

const EXAMPLES = [
  "What does this paragraph mean?",
  "How did they find that out?",
  "What's the main point of this story?",
  "Quiz me on what I've read",
];

const GROUNDING_LABEL = {
  story: { text: "From the story", cls: "is-story" },
  background: { text: "Background, not from the paper", cls: "is-background" },
  not_here: { text: "The story doesn't say", cls: "is-not-here" },
};

const TOOL_ICON = { read_block: "¶", read_passage: "§", search_passages: "⌕", answer: "✎", sentinel: "✓" };

/** A citation, in the reader's terms: a paragraph number, or a passage of the paper. */
function citeLabel(id) {
  const b = /^b(\d+)$/.exec(id);
  if (b) return `¶ ${b[1]}`;
  const p = /^p(\d+)$/.exec(id);
  if (p) return `Paper · ${id}`;
  return id;
}

/** What a finished turn's steps come to, in one line. */
function stepsSummary(steps) {
  const read = [...new Set((steps || []).filter((s) => s.tool === "read_block").map((s) => (s.summary.match(/(\d+)/) || [])[1]).filter(Boolean))];
  const searched = (steps || []).filter((s) => s.tool === "search_passages").length;
  const checked = (steps || []).some((s) => s.tool === "sentinel");
  const parts = [];
  if (read.length) parts.push(`Read ${read.map((n) => `¶ ${n}`).join(", ")}`);
  if (searched) parts.push(searched === 1 ? "searched the paper" : `searched the paper ${searched} times`);
  if (checked) parts.push("checked the answer before showing it");
  if (!parts.length) return "";
  const line = parts.join(" · ");
  return line.charAt(0).toUpperCase() + line.slice(1);
}

function StepList({ steps, live = false }) {
  if (!steps?.length) return null;
  return (
    <ol className="ag-steps rc-steps" aria-live={live ? "polite" : undefined}>
      {steps.map((s, i) => (
        <li key={i} className={`ag-step${live && i === steps.length - 1 ? " is-live" : ""}`}>
          <span className="ag-step-ic" aria-hidden>{live && i === steps.length - 1 ? <span className="ag-spinner rc-step-spinner" /> : TOOL_ICON[s.tool] || "…"}</span>
          <span>{s.summary}</span>
        </li>
      ))}
    </ol>
  );
}

/** A finished turn's work, folded to a line the reader can open. */
function Steps({ steps }) {
  const line = stepsSummary(steps);
  if (!line) return null;
  return (
    <details className="rc-work">
      <summary className="rc-work-line">{line}</summary>
      <StepList steps={steps} />
    </details>
  );
}

function Answer({ turn, onCite }) {
  const g = turn?.outcome === "refused" ? { text: "Couldn't answer safely", cls: "is-refused" }
    : turn?.outcome === "failed" ? { text: "Ran out of time", cls: "is-refused" }
    : GROUNDING_LABEL[turn?.answer?.grounding] || GROUNDING_LABEL.story;
  const blockIds = turn?.answer?.blockIds || [];
  const passageIds = turn?.answer?.passageIds || [];
  const cites = [...blockIds, ...passageIds];
  return (
    <div className="rc-answer">
      <p className="rc-answer-text">{turn.text}</p>
      <div className="rc-answer-foot">
        <span className={`rc-grounding ${g.cls}`}>{g.text}{turn?.answer?.term ? ` · “${turn.answer.term}”` : ""}</span>
        {cites.length ? (
          <span className="rc-cites">
            {cites.map((id) => (
              <button
                key={id}
                type="button"
                className={`rc-cite${id.startsWith("p") ? " is-paper" : ""}`}
                onClick={() => onCite?.(id.startsWith("b") ? { blockId: id } : { blockId: blockIds[0] || null, passageId: id })}
                title={id.startsWith("b") ? "Go to this paragraph" : "Open this passage of the paper"}
              >
                {citeLabel(id)}
              </button>
            ))}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function Elapsed() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSeconds((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="ag-elapsed">{seconds}s</span>;
}

function Turn({ turn, onCite }) {
  return (
    <div className={`ag-turn rc-turn${turn.pending ? " is-pending" : ""}`}>
      <div className="ag-ask">{turn.question}</div>
      <div className="ag-reply">
        <span className="ag-avatar rc-avatar" aria-hidden>?</span>
        <div className="ag-reply-body">
          {turn.pending ? (
            <div className="rc-working" role="status" aria-live="polite">
              <StepList steps={turn.steps.length ? turn.steps : [{ tool: "answer", summary: "Reading your question" }]} live />
              <Elapsed />
            </div>
          ) : (
            <>
              <Steps steps={turn.steps} />
              <Answer turn={turn} onCite={onCite} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Intro({ onExample, disabled }) {
  return (
    <div className="ag-reply rc-intro">
      <span className="ag-avatar rc-avatar" aria-hidden>?</span>
      <div className="ag-reply-body">
        <p className="rc-intro-text">
          Hello. I&apos;m here to help you read this story. Ask me about any part of it and I&apos;ll look it up in the article and the paper behind it, show you what I read, and tell you plainly if the story doesn&apos;t say. I never ask about you.
        </p>
        <p className="rc-intro-hint">Tap a paragraph to ask about that one, or start with:</p>
        <div className="ag-examples rc-examples">{EXAMPLES.map((e) => <button key={e} type="button" className="ag-example" disabled={disabled} onClick={() => onExample(e)}>{e}</button>)}</div>
      </div>
    </div>
  );
}

function Activity({ onForgotten }) {
  const [state, setState] = useState({ loading: true, turns: [], keepDays: 30, error: "" });
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    getMyCompanionTurns().then((r) => { if (alive) setState(r.ok ? { loading: false, turns: r.data.turns, keepDays: r.data.keepDays, error: "" } : { loading: false, turns: [], keepDays: 30, error: r.error }); });
    return () => { alive = false; };
  }, []);
  async function forget() {
    setBusy(true);
    const r = await forgetMe();
    setBusy(false);
    if (!r.ok) { setState((s) => ({ ...s, error: r.error })); return; }
    setState({ loading: false, turns: [], keepDays: state.keepDays, error: "" });
    setConfirm(false);
    onForgotten?.();
  }
  return (
    <div className="rc-activity">
      <p className="rc-activity-title">What the companion did</p>
      <p className="st-muted rc-activity-note">Every question you asked, on any story, and every step taken to answer it. Kept for {state.keepDays} days on this device only, then gone. Nobody knows who you are, here or on the server.</p>
      {state.loading ? <p className="st-muted">Loading…</p> : null}
      {state.error ? <p className="sc-write-msg is-error">{state.error}</p> : null}
      {!state.loading && !state.turns.length ? <p className="st-muted">Nothing yet.</p> : null}
      <ol className="rc-activity-list">
        {state.turns.map((t) => (
          <li key={t.id} className="rc-activity-item">
            <div className="rc-activity-q">{t.question}</div>
            <div className="rc-activity-meta">{t.storyTitle} · {new Date(t.createdAt).toLocaleString()} · {t.outcome === "refused" ? "not answered" : t.outcome === "failed" ? "ran out of time" : GROUNDING_LABEL[t.answer?.grounding]?.text.toLowerCase() || "answered"}</div>
            <StepList steps={t.steps} />
          </li>
        ))}
      </ol>
      <div className="rc-forget">
        {confirm ? (
          <>
            <span className="st-muted">Delete every question on this device?</span>
            <button type="button" className="sc-write-secondary st-btn" disabled={busy} onClick={forget}>Yes, forget me</button>
            <button type="button" className="st-link" onClick={() => setConfirm(false)}>Keep</button>
          </>
        ) : (
          <button type="button" className="st-link rc-forget-link" onClick={() => setConfirm(true)}>Forget me</button>
        )}
      </div>
    </div>
  );
}

/**
 * @param {object} p
 * @param {string} p.slug
 * @param {string|null} p.level        the reading level the reader is on, or null for the article's own
 * @param {{index:number, text:string}|null} p.focus   the paragraph the reader last touched, 1-based among text blocks
 * @param {(cite:{blockId:string|null, passageId?:string})=>void} [p.onCite]
 */
export default function ReaderCompanion({ slug, level = null, focus = null, onCite }) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState(null);
  const [pending, setPending] = useState(null);
  const [remaining, setRemaining] = useState(null);
  const [question, setQuestion] = useState("");
  const [error, setError] = useState("");
  const [useFocus, setUseFocus] = useState(true);
  const [showActivity, setShowActivity] = useState(false);
  const threadRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);
  const busy = Boolean(pending);

  /* The article makes room on a wide screen; the stylesheet reads this. */
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    document.documentElement.classList.toggle("rc-open", open);
    return () => document.documentElement.classList.remove("rc-open");
  }, [open]);

  useEffect(() => {
    if (!open || turns !== null) return undefined;
    let alive = true;
    getCompanionThread(slug).then((r) => {
      if (!alive) return;
      if (r.ok) { setTurns(r.data.turns); setRemaining(r.data.remaining); } else { setTurns([]); setError(r.error); }
    });
    return () => { alive = false; };
  }, [open, slug, turns]);

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [turns?.length, pending?.steps?.length, pending]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const grow = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(140, el.scrollHeight)}px`;
  }, []);

  const focusUsable = Boolean(focus && focus.index);
  const mentionsParagraph = (t) => /paragraph\s+\d+/i.test(t);

  async function send(text) {
    const ask = (text ?? question).trim();
    if (!ask || busy) return;
    setError("");
    setQuestion("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    /* The question takes its place at once; the work fills in under it. */
    setPending({ id: "pending", question: ask, pending: true, steps: [] });
    const controller = new AbortController();
    abortRef.current = controller;
    const r = await askCompanion(slug, {
      question: ask,
      level,
      focusIndex: focusUsable && useFocus && !mentionsParagraph(ask) ? focus.index : null,
    }, { onStep: (s) => setPending((cur) => (cur ? { ...cur, steps: [...cur.steps, s] } : cur)), signal: controller.signal });
    abortRef.current = null;
    setPending(null);
    if (r.aborted) return;
    if (!r.ok) {
      /* A stopped turn takes its place in the thread, saying so; the question
         goes back in the box so asking again is one keypress. */
      if (r.turn) setTurns((cur) => [...(cur || []), r.turn]);
      else setError(r.error);
      if (r.status !== 429) setQuestion(ask);
      return;
    }
    setTurns((cur) => [...(cur || []), r.data.turn]);
    if (r.data.remaining !== null) setRemaining(r.data.remaining);
    inputRef.current?.focus();
  }

  const capped = remaining === 0;

  if (!open) {
    return (
      <button type="button" className="rc-launch" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <span className="rc-launch-mark" aria-hidden>?</span>
        <span>Ask about this story</span>
      </button>
    );
  }

  return (
    <aside className="rc-sheet" role="dialog" aria-label="Reading companion">
      <div className="ag-panel rc-panel">
        <div className="ag-head rc-head">
          <span className="rc-head-title"><span className="ag-avatar rc-avatar" aria-hidden>?</span><b>Reading companion</b></span>
          <span className="rc-head-actions">
            <button type="button" className="st-link rc-activity-link" onClick={() => setShowActivity((v) => !v)} aria-pressed={showActivity}>{showActivity ? "Back" : "What it did"}</button>
            <button type="button" className="ag-rail-close" onClick={() => setOpen(false)} aria-label="Close the companion"><FaXmark size={12} aria-hidden /></button>
          </span>
        </div>

        {showActivity ? (
          <Activity onForgotten={() => { setTurns([]); setRemaining(null); }} />
        ) : (
          <>
            <div className="ag-thread rc-thread" ref={threadRef}>
              {turns === null ? <p className="st-muted">Loading…</p> : null}
              {turns !== null && turns.length === 0 ? <Intro onExample={send} disabled={busy || capped} /> : null}
              {(turns || []).map((t) => <Turn key={t.id} turn={t} onCite={onCite} />)}
              {pending ? <Turn turn={pending} /> : null}
              {error ? <p className="sc-write-msg is-error">{error}</p> : null}
            </div>

            <form className="ag-composer rc-composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
              {focusUsable ? (
                <div className="ag-ctx">
                  <button type="button" className={useFocus ? "ag-ctx-chip on" : "ag-ctx-chip"} onClick={() => setUseFocus((v) => !v)} aria-pressed={useFocus} title={useFocus ? "Your question is about this paragraph unless you name another" : "Click to ask about this paragraph"}>
                    <span>¶ {focus.index}</span>
                    <span className="ag-ctx-text">{focus.text}</span>
                  </button>
                  <span className="st-todo-detail">{useFocus ? "asking about this" : "not about this"}</span>
                </div>
              ) : null}
              <div className="ag-box">
                <textarea
                  ref={inputRef}
                  className="ag-input"
                  rows={1}
                  maxLength={500}
                  placeholder={capped ? "You've asked a lot today. Come back tomorrow." : "Ask about this story…"}
                  value={question}
                  disabled={busy || capped}
                  onChange={(e) => { setQuestion(e.target.value); grow(); }}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                />
                <button type="submit" className="sc-write-publish ag-send" disabled={busy || capped || !question.trim()} aria-label="Send"><FaPaperPlane size={12} aria-hidden /></button>
              </div>
              <div className="ag-hint">
                <span>Answers come from this story and its paper, checked before you see them.</span>
                {remaining !== null ? <span>{remaining} left today</span> : null}
              </div>
            </form>
          </>
        )}
      </div>
    </aside>
  );
}
