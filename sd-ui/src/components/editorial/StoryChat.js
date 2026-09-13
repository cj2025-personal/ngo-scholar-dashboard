"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FaCheck, FaPaperPlane, FaXmark } from "react-icons/fa6";

import { DEFAULT_AUDIENCE, DRAFT_AUDIENCES, approveDraftOutline, createDraftJob, discardDraftJob, getDraftJob, getDraftSources, replanDraftOutline, watchDraftJob } from "@/lib/drafting";

/**
 * New story, as a conversation.
 *
 * One thread. The scholar picks a paper and a reader in the composer, then
 * says what the article should be. The agent reads the paper and answers
 * with an outline; the scholar replies with changes or approves it; the
 * agent drafts and the workspace opens. Every step is a message, so the
 * scholar can scroll up and see what was asked and what was proposed.
 *
 * The job behind the thread is the same durable draft job as before: pause
 * at the outline, replan from a follow-up, draft, create the story.
 */

const PLACEHOLDER_START = "Describe the article you want: what to focus on, what to leave out, who it is for…";
const PLACEHOLDER_REPLY = "Reply with what to change about the outline, or approve it above";

function paperKey(p) {
  return `${p.origin}:${p.id}`;
}

function OutlineMessage({ msg, latest, busy, onApprove, onDiscard }) {
  const [beats, setBeats] = useState(() => (msg.outline.beats || []).map((b) => ({ ...b, kept: true })));
  const kept = beats.filter((b) => b.kept);
  return (
    <div className="ch-msg is-agent is-outline">
      <span className="ag-avatar" aria-hidden>A</span>
      <div className="ch-bubble">
        <p className="ch-text">
          {msg.replans ? "Here is the outline again, replanned from what you said." : "I read the paper. Here is how the article would go."}{" "}
          {beats.length} section{beats.length === 1 ? "" : "s"}, each built only from the passages listed beside it.
        </p>
        <div className="ch-outline-title">{msg.outline.title}</div>
        {msg.outline.deck ? <div className="st-todo-detail">{msg.outline.deck}</div> : null}
        <ol className="ch-beats">
          {beats.map((b, i) => (
            <li key={`${b.heading}-${i}`} className={b.kept ? "ch-beat" : "ch-beat is-cut"}>
              <div className="ch-beat-body">
                <div className="ch-beat-heading">{b.heading}</div>
                <div className="st-todo-detail">{b.goal}</div>
                <div className="ch-beat-refs">{(b.passageIds || []).map((id) => <span key={id} className="block-chip" style={{ cursor: "default" }}>{id}</span>)}</div>
              </div>
              {latest ? (
                <button type="button" className="nsf-cut" aria-label={b.kept ? "Cut this section" : "Keep this section"} disabled={busy} onClick={() => setBeats((cur) => cur.map((x, k) => (k === i ? { ...x, kept: !x.kept } : x)))}>
                  {b.kept ? <FaXmark size={11} /> : <FaCheck size={11} />}
                </button>
              ) : null}
            </li>
          ))}
        </ol>
        {latest ? (
          <div className="ch-actions">
            <button type="button" className="sc-write-publish st-btn-primary" disabled={busy || kept.length === 0} onClick={() => onApprove({ title: msg.outline.title, deck: msg.outline.deck, beats: kept.map(({ kept: _k, ...b }) => b) })}>
              <FaCheck size={11} aria-hidden /> Approve and draft{kept.length !== beats.length ? ` ${kept.length} of ${beats.length}` : ""}
            </button>
            <span className="st-todo-detail">or reply below with what to change</span>
            <button type="button" className="st-link ch-discard" disabled={busy} onClick={onDiscard}>Discard</button>
          </div>
        ) : (
          <div className="ag-resolved">{msg.superseded ? "Replaced by the outline below" : "Approved"}</div>
        )}
      </div>
    </div>
  );
}

export default function StoryChat({ me, initialSource = null, resumeJobId = null }) {
  const router = useRouter();
  const [inventory, setInventory] = useState(null);
  const [paper, setPaper] = useState(initialSource);
  const [audience, setAudience] = useState(DEFAULT_AUDIENCE);
  const [everyAge, setEveryAge] = useState(false);
  const [messages, setMessages] = useState([]);
  const [job, setJob] = useState(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const stopRef = useRef(null);
  const threadRef = useRef(null);
  const inputRef = useRef(null);

  const draftable = inventory?.draftable || [];
  const selectedPaper = useMemo(() => draftable.find((p) => paperKey(p) === paper) || null, [draftable, paper]);
  const outlineWaiting = job?.status === "awaiting_outline";
  const locked = Boolean(job);

  const push = useCallback((m) => setMessages((cur) => [...cur, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ...m }]), []);
  const setProgress = useCallback((textValue) => setMessages((cur) => {
    const i = cur.findIndex((m) => m.role === "progress");
    if (i < 0) return [...cur, { id: "progress", role: "progress", text: textValue }];
    const next = cur.slice();
    next[i] = { ...next[i], text: textValue };
    return next;
  }), []);
  const clearProgress = useCallback(() => setMessages((cur) => cur.filter((m) => m.role !== "progress")), []);

  /* The opening line, once we know what the scholar holds. */
  const greet = useCallback((inv) => {
    if (resumeJobId) return;
    const first = (me?.name || "").split(/\s+/)[0];
    if (!inv.eligible) {
      push({ role: "agent", text: `${first ? `${first}, ` : ""}drafting is not open to you yet. ${inv.gateReason || ""}`.trim() });
      return;
    }
    if ((inv.draftable || []).length === 0) {
      push({ role: "agent", text: inv.nudge || "Nothing is ready to draft from yet. Add a paper you hold the rights to and come back." });
      return;
    }
    push({ role: "agent", text: `What shall we write${first ? `, ${first}` : ""}? Pick the paper and the reader's age below, then tell me what the article should be: what to focus on, what to leave out, the angle you want. I will read the paper and propose an outline before a word is drafted.` });
  }, [me?.name, push, resumeJobId]);

  useEffect(() => {
    let alive = true;
    getDraftSources().then((r) => { if (alive && r.ok) { setInventory(r.data); greet(r.data); } });
    return () => { alive = false; if (stopRef.current) stopRef.current(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages, busy]);

  function showOutline(j, { replans = 0 } = {}) {
    setMessages((cur) => [...cur.filter((m) => m.role !== "progress").map((m) => (m.role === "outline" ? { ...m, superseded: true } : m)), { id: `outline-${j.id}-${replans}`, role: "outline", outline: j.outline, replans, jobId: j.id }]);
  }

  function watch(j, after = 0) {
    if (stopRef.current) stopRef.current();
    stopRef.current = watchDraftJob(j.id, {
      after,
      onProgress: ({ message }) => setProgress(message),
      onSettled: (settled) => {
        stopRef.current = null;
        setJob(settled);
        setBusy(false);
        if (settled.status === "awaiting_outline") { showOutline(settled, { replans: settled.replans || 0 }); return; }
        clearProgress();
        if (settled.storyId) { push({ role: "agent", text: "Your draft is ready. Opening the workspace, where you can read it against the paper and keep editing by instruction." }); router.push(`/editorial/${settled.storyId}`); return; }
        push({ role: "error", text: settled.failure?.sentence || "That draft did not complete." });
      },
      onError: (message) => { stopRef.current = null; setBusy(false); clearProgress(); push({ role: "error", text: message }); },
    });
  }

  /* Coming back to a job from Studio. */
  useEffect(() => {
    if (!resumeJobId) return;
    getDraftJob(resumeJobId).then((r) => {
      if (!r.ok) { push({ role: "error", text: r.error }); return; }
      const j = r.data.job;
      setJob(j);
      setPaper(j.source ? `${j.source.origin}:${j.source.id}` : null);
      setAudience(j.audience || DEFAULT_AUDIENCE);
      if (j.brief) push({ role: "user", text: j.brief });
      if (j.storyId) { router.replace(`/editorial/${j.storyId}`); return; }
      if (j.status === "awaiting_outline") { showOutline(j, { replans: j.replans || 0 }); return; }
      if (j.terminal) { push({ role: "error", text: j.failure?.sentence || "That draft did not complete." }); return; }
      setBusy(true);
      setProgress("Picking up where it left off…");
      watch(j);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeJobId]);

  async function send() {
    const ask = text.trim();
    if (!ask || busy) return;
    if (!locked && !selectedPaper) {
      push({ role: "user", text: ask });
      push({ role: "agent", text: "Which paper should this come from? Pick one below; only papers we hold in full and may reproduce are listed." });
      setText("");
      return;
    }
    setText("");
    push({ role: "user", text: ask });
    setBusy(true);
    if (outlineWaiting) {
      setProgress("Replanning the outline from what you said…");
      const r = await replanDraftOutline(job.id, ask);
      if (!r.ok) { setBusy(false); clearProgress(); push({ role: "error", text: r.error }); return; }
      setJob(r.data.job);
      watch(r.data.job, r.data.job.lastSequence || 0);
      return;
    }
    setProgress("Reading the paper…");
    const r = await createDraftJob({ origin: selectedPaper.origin, sourceId: selectedPaper.id, audience, brief: ask, approveOutline: true, createStory: true, levels: everyAge });
    if (!r.ok) { setBusy(false); clearProgress(); push({ role: "error", text: r.error }); return; }
    const j = r.data.job;
    setJob(j);
    if (j.storyId) { router.push(`/editorial/${j.storyId}`); return; }
    if (j.status === "awaiting_outline") { setBusy(false); showOutline(j, { replans: j.replans || 0 }); return; }
    if (j.terminal) { setBusy(false); clearProgress(); push({ role: "error", text: j.failure?.sentence || "That draft did not complete." }); return; }
    watch(j);
  }

  async function approve(outline) {
    if (!job || busy) return;
    setBusy(true);
    push({ role: "user", text: `Approved${outline.beats.length ? `: ${outline.beats.length} section${outline.beats.length === 1 ? "" : "s"}` : ""}.` });
    setProgress("Drafting…");
    const r = await approveDraftOutline(job.id, outline);
    if (!r.ok) { setBusy(false); clearProgress(); push({ role: "error", text: r.error }); return; }
    setJob(r.data.job);
    setMessages((cur) => cur.map((m) => (m.role === "outline" ? { ...m, approved: true } : m)));
    watch(r.data.job, r.data.job.lastSequence || 0);
  }

  async function discard() {
    if (!job || busy) return;
    setBusy(true);
    const r = await discardDraftJob(job.id);
    setBusy(false);
    if (!r.ok) { push({ role: "error", text: r.error }); return; }
    setJob(null);
    setMessages((cur) => cur.map((m) => (m.role === "outline" ? { ...m, superseded: true } : m)));
    push({ role: "agent", text: "Discarded. Pick a paper and describe another article whenever you like." });
  }

  const latestOutlineId = [...messages].reverse().find((m) => m.role === "outline" && !m.superseded && !m.approved)?.id;

  return (
    <div className="ch-wrap">
      <div className="ch-head">
        <div>
          <span className="sc-kicker">New story</span>
          <h1 className="st-h1">Tell the agent what to write</h1>
        </div>
        <Link href="/editorial/new?blank=1" className="st-link">Start blank instead</Link>
      </div>

      <div className="ch-thread" ref={threadRef}>
        {messages.map((m) => {
          if (m.role === "outline") {
            return <OutlineMessage key={m.id} msg={m} latest={m.id === latestOutlineId && outlineWaiting} busy={busy} onApprove={approve} onDiscard={discard} />;
          }
          if (m.role === "user") return <div key={m.id} className="ch-msg is-user"><div className="ch-bubble">{m.text}</div></div>;
          if (m.role === "progress") {
            return (
              <div key={m.id} className="ch-msg is-agent">
                <span className="ag-avatar" aria-hidden>A</span>
                <div className="ag-working" role="status" aria-live="polite"><div className="ag-working-line"><span className="ag-spinner" aria-hidden /> {m.text}</div></div>
              </div>
            );
          }
          if (m.role === "error") return <div key={m.id} className="ch-msg is-agent"><span className="ag-avatar" aria-hidden>A</span><div className="ch-bubble is-error">{m.text}</div></div>;
          return <div key={m.id} className="ch-msg is-agent"><span className="ag-avatar" aria-hidden>A</span><div className="ch-bubble">{m.text}</div></div>;
        })}
      </div>

      <form className="ch-composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <div className="ch-options">
          <label className="ch-opt">
            <span>Paper</span>
            <select aria-label="Paper" value={paper || ""} disabled={locked || !inventory} onChange={(e) => setPaper(e.target.value || null)}>
              <option value="">Choose a paper…</option>
              {draftable.map((p) => <option key={paperKey(p)} value={paperKey(p)}>{p.title}{p.year ? ` (${p.year})` : ""}</option>)}
            </select>
          </label>
          <label className="ch-opt">
            <span>Reader age</span>
            <select aria-label="Reader age" value={audience} disabled={locked} onChange={(e) => setAudience(e.target.value)}>
              {DRAFT_AUDIENCES.map((a) => <option key={a.value} value={a.value}>{a.label} · reads at grade {a.grade}</option>)}
            </select>
          </label>
          <label className="ch-opt ch-check" title="After the article, write it for every other reading age too. More model calls; you approve each level before readers see it.">
            <input type="checkbox" checked={everyAge} disabled={locked} onChange={(e) => setEveryAge(e.target.checked)} />
            <span>Also write it for every age</span>
          </label>
          {locked ? <span className="st-todo-detail ch-locked">Paper and reader are set for this draft. <button type="button" className="st-link" onClick={() => { if (stopRef.current) stopRef.current(); setJob(null); setBusy(false); setMessages((cur) => cur.filter((m) => m.role !== "progress").map((m) => (m.role === "outline" ? { ...m, superseded: true } : m))); }}>Start another</button></span> : null}
        </div>
        <div className="ag-box">
          <textarea
            ref={inputRef}
            className="ag-input"
            rows={2}
            placeholder={outlineWaiting ? PLACEHOLDER_REPLY : PLACEHOLDER_START}
            value={text}
            disabled={busy || (locked && !outlineWaiting)}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          />
          <button type="submit" className="sc-write-publish ag-send" disabled={busy || !text.trim() || (locked && !outlineWaiting)} aria-label="Send"><FaPaperPlane size={12} aria-hidden /></button>
        </div>
        <div className="ag-hint">
          <span><kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line</span>
          <span>{outlineWaiting ? "Approve the outline, or say what to change" : "The agent proposes an outline before it drafts"}</span>
        </div>
      </form>
    </div>
  );
}
