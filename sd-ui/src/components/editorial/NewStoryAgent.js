"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FaCheck, FaPaperPlane, FaXmark } from "react-icons/fa6";
import { HiChevronDown, HiOutlineAcademicCap, HiOutlineDocumentText, HiOutlinePencilSquare, HiOutlinePlusSmall, HiOutlineUsers } from "react-icons/hi2";

import { DEFAULT_AUDIENCE, DEFAULT_VOICE, DRAFT_AUDIENCES, DRAFT_VOICES, approveDraftOutline, createDraftJob, discardDraftJob, getDraftJob, getDraftSources, proposeFromPaper, replanDraftOutline, watchDraftJob } from "@/lib/drafting";

/**
 * The agent, in the rail of a story that has no paper behind it yet.
 *
 * A conversation. The scholar picks a paper and a reader, says what the
 * article should be, and the agent answers with an outline. What they
 * approve is drafted and handed to the workspace, which lands it in the page
 * beside this rail — the page they may already have started typing in. The
 * page saves it under their name, linked to the paper's passages, and from
 * then on the rail is the agent that edits by instruction.
 *
 * The job behind the thread is the durable draft job: pause at the outline,
 * replan from a follow-up, draft. It does not create the story; the page does,
 * so a story is one thing in one place whoever wrote its first paragraph.
 */

const PLACEHOLDER_START = "Describe the article you want: what to focus on, what to leave out, who it is for…";
const PLACEHOLDER_REPLY = "Reply with what to change about the outline, or approve it above";

function paperKey(p) {
  return `${p.origin}:${p.id}`;
}

function OutlineMessage({ msg, latest, busy, onApprove, onDiscard }) {
  const [beats, setBeats] = useState(() => (msg.outline.beats || []).map((b) => ({ ...b, kept: true })));
  const kept = beats.filter((b) => b.kept);
  const beyond = beats.filter((b) => b.kind === "extension").length;
  const coverage = msg.outline.coverage || null;
  return (
    <div className="ch-msg is-agent is-outline">
      <span className="ag-avatar" aria-hidden>A</span>
      <div className="ch-bubble">
        <p className="ch-text">
          {msg.replans ? "Here is the outline again, replanned from what you said." : "I read the paper. Here is how the article would go."}{" "}
          {beyond
            ? `${beats.length - beyond} section${beats.length - beyond === 1 ? "" : "s"} built only from the passages listed beside ${beats.length - beyond === 1 ? "it" : "them"}, and ${beyond} that say${beyond === 1 ? "s" : ""} what follows from the paper for the reader — implications only, checked claim by claim, with nothing from outside the paper.`
            : `${beats.length} section${beats.length === 1 ? "" : "s"}, each built only from the passages listed beside it.`}
        </p>
        {coverage && coverage.met !== "full" ? (
          <p className="ch-coverage">
            {coverage.met === "none" ? "The paper cannot carry what you asked for" : "Part of what you asked for is left out"}
            {coverage.note ? `: ${coverage.note}` : "."}{" "}
            {coverage.met === "none" ? "This plan reports the paper instead." : "Reply below if you want a different plan."}
          </p>
        ) : null}
        <div className="ch-outline-title">{msg.outline.title}</div>
        {msg.outline.deck ? <div className="st-todo-detail">{msg.outline.deck}</div> : null}
        <ol className="ch-beats">
          {beats.map((b, i) => (
            <li key={`${b.heading}-${i}`} className={b.kept ? "ch-beat" : "ch-beat is-cut"}>
              <div className="ch-beat-body">
                <div className="ch-beat-heading">{b.heading}{b.kind === "extension" ? <span className="ch-beat-kind" title="Says what follows from the paper for the reader. Every claim is checked to follow from the passages it builds on; nothing from outside the paper.">Beyond the paper</span> : b.kind === "context" ? <span className="ch-beat-kind is-context" title="Your own context: what you know about the world around the work, written as your view. Nothing in it is attributed to the paper, and every specific it brings in is listed for you to verify before the story can be published.">Your own context</span> : null}</div>
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

/**
 * @param {object} p
 * @param {{name?: string}|null} p.me
 * @param {string|null} p.initialSource   `origin:id` of a paper to preselect
 * @param {string|null} p.resumeJobId     a paused job to pick up
 * @param {boolean} p.hasText             whether the page beside the rail already has writing in it
 * @param {(job: object, source: object, opts: {levels: string[]}) => void} p.onDraftReady   the draft is done; the page takes it
 * @param {(storyId: string) => void} p.onStoryReady   a job from before that made its own story; the page goes to it
 * @param {boolean} [p.autoPropose]   the scholar asked the agent for an angle on
 *                                    `initialSource` rather than describing one
 * @param {(stage: "outline"|null) => void} [p.onStageChange]   what the rail is asking for, so the page can give it the room it needs
 */
export default function NewStoryAgent({ me, initialSource = null, resumeJobId = null, autoPropose = false, hasText = false, onDraftReady, onStoryReady, onStageChange }) {
  const [inventory, setInventory] = useState(null);
  const [paper, setPaper] = useState(initialSource);
  const [audience, setAudience] = useState(DEFAULT_AUDIENCE);
  /* The other reading ages to write once the article exists: any subset,
     each written and judged on its own. The reader's own band is never one. */
  const [levelBands, setLevelBands] = useState([]);
  const [voice, setVoice] = useState(DEFAULT_VOICE);
  const [messages, setMessages] = useState([]);
  const [job, setJob] = useState(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const stopRef = useRef(null);
  const threadRef = useRef(null);
  const inputRef = useRef(null);
  const bandsRef = useRef(null);
  /* The bands chosen when the job was started; the page writes them once the
     story exists, so they ride along with the finished draft. */
  const wantedLevelsRef = useRef([]);

  useEffect(() => {
    function onPointerDown(e) {
      const el = bandsRef.current;
      if (el && el.open && !el.contains(e.target)) el.open = false;
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const draftable = inventory?.draftable || [];
  const selectedPaper = draftable.find((p) => paperKey(p) === paper) || null;
  const outlineWaiting = job?.status === "awaiting_outline";
  const locked = Boolean(job);
  /* Until the inventory has loaded, the agent does not yet know which papers
     the scholar holds, so a paper preselected from the Papers shelf is not
     matched yet. Sending in that window answered "Which paper should this
     come from?" about a paper already named in the pill — the greeting then
     arrived after the answer. So the composer waits to be ready. */
  const ready = Boolean(inventory);
  const extraBands = levelBands.filter((v) => v !== audience);

  /* An outline waiting for approval is the only thing the scholar is here to
     read: the page beside us is still empty, and nothing has been written to
     edit. Tell the page, so it can hand the outline the canvas instead of
     leaving it in a rail beside a blank editor inviting them to start
     writing the article the machine is about to write. */
  useEffect(() => {
    onStageChange?.(outlineWaiting ? "outline" : null);
  }, [outlineWaiting, onStageChange]);
  /* Closing the rail, or leaving, puts the page back the way it was. */
  useEffect(() => () => onStageChange?.(null), [onStageChange]);

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
    /* Nothing to ask when the scholar has already said what they want: a job
       to pick up, or a paper they asked for an angle on. Greeting them with
       "tell me what the article should be" in either case answers a question
       they did not ask and contradicts what happens next. */
    if (resumeJobId || autoPropose) return;
    const first = (me?.name || "").split(/\s+/)[0];
    if (!inv.eligible) {
      push({ role: "agent", text: `${first ? `${first}, ` : ""}drafting is not open to you yet. ${inv.gateReason || ""}`.trim() });
      return;
    }
    if ((inv.draftable || []).length === 0) {
      push({ role: "agent", text: inv.nudge || "Nothing is ready to draft from yet. Add a paper you hold the rights to and come back." });
      return;
    }
    push({ role: "agent", text: `What shall we write${first ? `, ${first}` : ""}? Pick the paper and the reader below, then tell me what the article should be: what to focus on, what to leave out, the angle you want — or what your work means for readers today. I will read the paper and propose an outline before a word is drafted. What you approve lands in the page beside us${hasText ? ", after what you have written" : ""}, as a draft under your name for you to read and change.` });
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  /* One line until there is more to show; `auto` first or it never shrinks. */
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  function showOutline(j, { replans = 0 } = {}) {
    setMessages((cur) => [...cur.filter((m) => m.role !== "progress").map((m) => (m.role === "outline" ? { ...m, superseded: true } : m)), { id: `outline-${j.id}-${replans}`, role: "outline", outline: j.outline, replans, jobId: j.id }]);
  }

  /* The finished draft goes to the page. A job started before the rail
     existed made its own story; the page goes there instead. */
  function settle(settled, source) {
    clearProgress();
    if (settled.storyId) {
      push({ role: "agent", text: "Your draft is ready. Opening it, where you can read it against the paper and keep editing by instruction." });
      onStoryReady?.(settled.storyId);
      return true;
    }
    if (settled.status === "awaiting_review" && settled.draft) {
      push({ role: "agent", text: "The draft is in the page beside us, under your name. Every paragraph shows the passage it came from. Read it, change what you like, and tell me what to do next." });
      onDraftReady?.(settled, source || settled.source || {}, { levels: wantedLevelsRef.current });
      return true;
    }
    return false;
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
        if (settle(settled, selectedPaper)) return;
        push({ role: "error", text: settled.failure?.sentence || "That draft did not complete." });
      },
      onError: (message) => { stopRef.current = null; setBusy(false); clearProgress(); push({ role: "error", text: message }); },
    });
  }

  /* "Suggest an angle": the scholar asked the agent what this paper could
     become instead of telling it. Fires once, after the inventory has
     resolved the paper — before that the agent does not yet know the scholar
     holds it — and never when a job is already in hand, so a reload of a
     proposal that exists picks it up rather than paying for a second one. */
  const proposedRef = useRef(false);
  useEffect(() => {
    if (!autoPropose || proposedRef.current) return;
    if (!ready || resumeJobId || job || !selectedPaper) return;
    proposedRef.current = true;
    (async () => {
      push({ role: "user", text: "What could this paper become?" });
      setBusy(true);
      setProgress("Reading the paper…");
      const r = await proposeFromPaper({ origin: selectedPaper.origin, sourceId: selectedPaper.id });
      if (!r.ok) {
        setBusy(false);
        clearProgress();
        /* The day's allowance, a provider that is down, a paper that turned
           out not to be draftable. Said here, where the composer still works,
           so the scholar can describe an article themselves instead. */
        push({ role: "error", text: `${r.error} You can still tell me what to write below.` });
        return;
      }
      const j = r.data.job;
      setJob(j);
      if (j.status === "awaiting_outline") { setBusy(false); showOutline(j, { replans: j.replans || 0 }); return; }
      if (j.terminal) { setBusy(false); clearProgress(); push({ role: "error", text: j.failure?.sentence || "That did not complete." }); return; }
      watch(j);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPropose, ready, resumeJobId, job, selectedPaper]);

  /* Coming back to a job from Studio. */
  useEffect(() => {
    if (!resumeJobId) return;
    getDraftJob(resumeJobId).then((r) => {
      if (!r.ok) { push({ role: "error", text: r.error }); return; }
      const j = r.data.job;
      setJob(j);
      setPaper(j.source ? `${j.source.origin}:${j.source.id}` : null);
      setAudience(j.audience || DEFAULT_AUDIENCE);
      setVoice(j.voice || DEFAULT_VOICE);
      if (j.brief) push({ role: "user", text: j.brief });
      if (j.status === "awaiting_outline") { showOutline(j, { replans: j.replans || 0 }); return; }
      if (settle(j, j.source)) return;
      if (j.terminal) { push({ role: "error", text: j.failure?.sentence || "That draft did not complete." }); return; }
      setBusy(true);
      setProgress("Picking up where it left off…");
      watch(j);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeJobId]);

  async function send() {
    const ask = text.trim();
    /* Enter reaches here even when the button is disabled. */
    if (!ask || busy || !ready) return;
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
    wantedLevelsRef.current = levelBands.filter((a) => a !== audience);
    /* No story from the job: the page beside us is the story. */
    const r = await createDraftJob({ origin: selectedPaper.origin, sourceId: selectedPaper.id, audience, voice, brief: ask, approveOutline: true, createStory: false, levels: false });
    if (!r.ok) { setBusy(false); clearProgress(); push({ role: "error", text: r.error }); return; }
    const j = r.data.job;
    setJob(j);
    if (j.status === "awaiting_outline") { setBusy(false); showOutline(j, { replans: j.replans || 0 }); return; }
    if (j.terminal) { setBusy(false); clearProgress(); push({ role: "error", text: j.failure?.sentence || "That draft did not complete." }); return; }
    if (settle(j, selectedPaper)) { setBusy(false); return; }
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

  function startAnother() {
    if (stopRef.current) stopRef.current();
    setJob(null);
    setBusy(false);
    setMessages((cur) => cur.filter((m) => m.role !== "progress").map((m) => (m.role === "outline" ? { ...m, superseded: true } : m)));
  }

  const latestOutlineId = [...messages].reverse().find((m) => m.role === "outline" && !m.superseded && !m.approved)?.id;

  return (
    <div className="ch-wrap is-rail">
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
        <div className="ch-dock">
          <div className="ag-box">
            <textarea
              ref={inputRef}
              className="ag-input"
              rows={1}
              placeholder={outlineWaiting ? PLACEHOLDER_REPLY : PLACEHOLDER_START}
              value={text}
              disabled={!ready || busy || (locked && !outlineWaiting)}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            />
          </div>

          {/* The controls are pills under the field: what to read, who for,
              whose voice. Each is a native select styled over, so the
              keyboard, the screen reader and the browser suite all see an
              ordinary control. */}
          <div className="ch-tools">
            <span className="ch-pill" title={selectedPaper?.title || "The paper the article draws on"}>
              <HiOutlineDocumentText size={15} className="ch-pill__ic" aria-hidden />
              <select className="ch-pill__sel" aria-label="Paper" value={paper || ""} disabled={locked || !inventory} onChange={(e) => setPaper(e.target.value || null)}>
                <option value="">Choose a paper…</option>
                {draftable.map((p) => <option key={paperKey(p)} value={paperKey(p)}>{p.title}{p.year ? ` (${p.year})` : ""}</option>)}
              </select>
              <HiChevronDown size={13} className="ch-pill__chev" aria-hidden />
            </span>

            <span className="ch-pill" title="Who the article is written for">
              <HiOutlineAcademicCap size={15} className="ch-pill__ic" aria-hidden />
              <select className="ch-pill__sel" aria-label="Reader age" value={audience} disabled={locked} onChange={(e) => setAudience(e.target.value)}>
                {DRAFT_AUDIENCES.map((a) => <option key={a.value} value={a.value}>{a.label} · grade {a.grade}</option>)}
              </select>
              <HiChevronDown size={13} className="ch-pill__chev" aria-hidden />
            </span>

            <span className="ch-pill" title={DRAFT_VOICES.find((v) => v.value === voice)?.hint}>
              <HiOutlinePencilSquare size={15} className="ch-pill__ic" aria-hidden />
              <select className="ch-pill__sel" aria-label="Written as" value={voice} disabled={locked} onChange={(e) => setVoice(e.target.value)}>
                {DRAFT_VOICES.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
              </select>
              <HiChevronDown size={13} className="ch-pill__chev" aria-hidden />
            </span>

            {/* The other reading ages, behind one pill. */}
            <details ref={bandsRef} className={locked ? "ch-more is-locked" : extraBands.length ? "ch-more is-set" : "ch-more"}>
              <summary className="ch-pill is-summary" aria-disabled={locked || undefined} onClick={(e) => { if (locked) e.preventDefault(); }}>
                {extraBands.length ? <HiOutlineUsers size={15} className="ch-pill__ic" aria-hidden /> : <HiOutlinePlusSmall size={17} className="ch-pill__ic" aria-hidden />}
                <span className="ch-pill__text">{extraBands.length ? `Also for ${extraBands.length} more ${extraBands.length === 1 ? "age" : "ages"}` : "Other ages"}</span>
                <HiChevronDown size={13} className="ch-pill__chev" aria-hidden />
              </summary>
              <fieldset className="ch-menu" disabled={locked}>
                <legend className="ch-menu__title">Also write it for</legend>
                <p className="ch-menu__note">After the article, the agent writes it again for each of these, on its own. You approve every level before readers see it.</p>
                {DRAFT_AUDIENCES.filter((a) => a.value !== audience).map((a) => (
                  <label key={a.value} className="ch-menu__row">
                    <input type="checkbox" checked={levelBands.includes(a.value)} onChange={(e) => setLevelBands((cur) => (e.target.checked ? [...cur, a.value] : cur.filter((v) => v !== a.value)))} />
                    <span>{a.label}</span>
                    <span className="ch-menu__grade">reads at grade {a.grade}</span>
                  </label>
                ))}
                <button type="button" className="st-link ch-menu__all" onClick={() => setLevelBands((cur) => (cur.filter((v) => v !== audience).length === DRAFT_AUDIENCES.length - 1 ? [] : DRAFT_AUDIENCES.map((a) => a.value).filter((v) => v !== audience)))}>
                  {extraBands.length === DRAFT_AUDIENCES.length - 1 ? "None" : "Every age"}
                </button>
              </fieldset>
            </details>

            {locked ? <span className="ch-locked">Set for this draft · <button type="button" className="st-link" onClick={startAnother}>Start another</button></span> : null}

            <button type="submit" className="ag-send" disabled={!ready || busy || !text.trim() || (locked && !outlineWaiting)} aria-label="Send"><FaPaperPlane size={13} aria-hidden /></button>
          </div>
        </div>
        <div className="ag-hint">
          <span><kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line</span>
          <span>{outlineWaiting ? "Approve the outline, or say what to change" : "The agent proposes an outline before it drafts"}</span>
        </div>
      </form>
    </div>
  );
}
