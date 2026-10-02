"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FaCheck, FaXmark } from "react-icons/fa6";
import { HiOutlineArrowUp, HiOutlinePlus } from "react-icons/hi2";

import { DEFAULT_AUDIENCE, DEFAULT_VOICE, DRAFT_AUDIENCES, DRAFT_VOICES, approveDraftOutline, converseWithAgent, createDraftJob, discardDraftJob, getDraftJob, getDraftSources, proposeFromPaper, replanDraftOutline, watchDraftJob } from "@/lib/drafting";
import Kivyn from "@/components/kivyn/Kivyn";
import KivynButton from "@/components/kivyn/KivynButton";
import { useKivynMoment } from "@/components/kivyn/useKivynMoment";
import { AGENT_NAME, poseForStep } from "@/lib/kivyn/pose.mjs";

/* Kivyn beside each message: still, so the thread does not blink from every line. */
const Face = () => <Kivyn variant="mark" size={28} />;

/**
 * The agent, in the rail of a story that has no paper behind it yet.
 *
 * A conversation. Whatever the scholar says — or taps: a paper card, an age —
 * goes to the studio agent's model with what is set so far, and the model
 * decides what it means: ask which paper, ask who it is for, plan, propose,
 * replan, approve, discard, or just answer. This component carries the
 * decision out; it does not read the scholar's words itself. What they
 * approve is drafted and handed to the workspace, which lands it in the page
 * beside this rail — the page they may already have started typing in. The
 * page saves it under their name, linked to the paper's passages, and from
 * then on the rail is the agent that edits by instruction.
 *
 * The job behind the thread is the durable draft job: pause at the outline,
 * replan from a follow-up, draft. It does not create the story; the page does,
 * so a story is one thing in one place whoever wrote its first paragraph.
 */

const PLACEHOLDER_START = "Describe the article you want, or say which paper it should come from…";
/* With a paper chosen, asking which paper is a question already answered. */
const PLACEHOLDER_FROM_PAPER = "Describe the article you want: what to focus on, and who it is for…";
const PLACEHOLDER_REPLY = "Reply with what to change about the outline, or approve it above";

function paperKey(p) {
  return `${p.origin}:${p.id}`;
}

/* ── the conversation, as the studio agent's model reads it ──────────────── */

/** The thread in words: what the scholar said or tapped, and what the agent said back. */
function transcript(messages) {
  return messages.flatMap((m) => {
    if (m.role === "user") return [{ role: "scholar", text: m.text }];
    if (m.role === "outline") return [{ role: "agent", text: `Proposed an outline, “${m.outline?.title || "untitled"}”: ${(m.outline?.beats || []).map((b) => b.heading).join("; ")}${m.approved ? " (approved)" : m.superseded ? " (replaced)" : ""}` }];
    if (["agent", "papers", "audience", "story", "error"].includes(m.role) && m.text) return [{ role: "agent", text: m.text }];
    return [];
  });
}

function PaperCards({ papers, onPick, disabled }) {
  return (
    <div className="ch-papers">
      {papers.map((p) => (
        <button key={paperKey(p)} type="button" className="ch-paper" disabled={disabled} onClick={() => onPick(p)}>
          <span className="ch-paper-title">{p.title}</span>
          <span className="ch-paper-meta">{[p.year, p.wordCount ? `${Number(p.wordCount).toLocaleString()} words` : null, p.host || null].filter(Boolean).join(" · ")}</span>
        </button>
      ))}
    </div>
  );
}

/* Ways to begin a story. Each puts words in the box for the scholar to finish or send; none is sent for them. */
const STARTERS = [
  { label: "From one of my papers", text: "I'd like to write from one of my papers." },
  { label: "For a general reader", text: "Write for a general reader about " },
  { label: "For ages 12–14", text: "Write for readers aged 12 to 14 about " },
];
const STARTERS_FROM_PAPER = [
  { label: "What could this become?", text: "What could this paper become as an article?" },
  { label: "Its main finding, plainly", text: "Focus on the main finding, for a general reader." },
  { label: "Be honest about the limits", text: "Focus on what the study shows, and be clear about its limits." },
];

function AudienceChips({ onPick, disabled }) {
  return (
    <div className="ch-chips">
      {DRAFT_AUDIENCES.map((a) => (
        <button key={a.value} type="button" className={`ch-chip${a.value === DEFAULT_AUDIENCE ? " is-default" : ""}`} disabled={disabled} onClick={() => onPick(a.value)}>{a.label}{a.value === DEFAULT_AUDIENCE ? " · default" : ""}</button>
      ))}
    </div>
  );
}

function OutlineMessage({ msg, latest, busy, onApprove, onDiscard, onKept, moment = null }) {
  const [beats, setBeats] = useState(() => (msg.outline.beats || []).map((b) => ({ ...b, kept: true })));
  const kept = beats.filter((b) => b.kept);
  /* The outline as it stands, sections cut or kept, so an approval said in
     words approves what the scholar sees. */
  useEffect(() => {
    if (latest) onKept?.({ title: msg.outline.title, deck: msg.outline.deck, beats: beats.filter((b) => b.kept).map(({ kept: _k, ...b }) => b) });
  }, [latest, beats, msg.outline.title, msg.outline.deck, onKept]);
  const beyond = beats.filter((b) => b.kind === "extension").length;
  const coverage = msg.outline.coverage || null;
  return (
    <div className={`ch-msg is-agent is-outline${latest ? " ag-approval" : ""}`}>
      {/* While an outline waits the page is the plan and the pane's head is gone, so its moment is on this face. */}
      <Kivyn variant="mark" size={28} pose={latest && moment ? moment : "neutral"} live={Boolean(latest && moment)} />
      <div className="ch-bubble">
        {latest ? <p className="ag-approval-kicker">Needs your approval</p> : null}
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
export default function NewStoryAgent({ me, initialSource = null, resumeJobId = null, autoPropose = false, hasText = false, onDraftReady, onStoryReady, onStageChange, prefill = "", onPrefillTaken, proposeNow = 0, onStatus, onPaperChange, onDraftingStart, onSection }) {
  const [inventory, setInventory] = useState(null);
  /* A finished piece of work, for a moment: an outline in, a draft landed. */
  const [moment, showMoment] = useKivynMoment();
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
  /* Whether the reader has been chosen — tapped, picked in the menu, or
     understood by the agent — rather than standing at the default. A paper
     brought from the Papers shelf comes with the reader shown beside it. */
  const [audienceSet, setAudienceSet] = useState(Boolean(initialSource));
  /* The agent has asked who the article is for and is waiting on the answer. */
  const [awaitingAudience, setAwaitingAudience] = useState(false);
  const stopRef = useRef(null);
  /* The waiting outline as the scholar has trimmed it. */
  const keptRef = useRef(null);
  const onKept = useCallback((outline) => { keptRef.current = outline; }, []);
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
  /* And while the draft is being written, the page shows it being written. */
  const drafting = Boolean(job) && !outlineWaiting && busy;
  useEffect(() => {
    onStageChange?.(outlineWaiting ? "outline" : drafting ? "drafting" : null);
  }, [outlineWaiting, drafting, onStageChange]);
  /* Closing the rail, or leaving, puts the page back the way it was. */
  useEffect(() => () => onStageChange?.(null), [onStageChange]);

  const push = useCallback((m) => setMessages((cur) => [...cur, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ...m }]), []);
  const setProgress = useCallback((textValue, step) => setMessages((cur) => {
    const i = cur.findIndex((m) => m.role === "progress");
    if (i < 0) return [...cur, { id: "progress", role: "progress", text: textValue, step }];
    const next = cur.slice();
    next[i] = { ...next[i], text: textValue, step };
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
    const chosen = (inv.draftable || []).find((p) => paperKey(p) === paper) || null;
    if (chosen) {
      push({
        role: "agent",
        /* The paper is named in the line under Kivyn's name and in the card
           above the composer; said a third time here, the greeting outgrew a
           laptop's pane and its first line scrolled away. */
        text: `What shall we write${first ? `, ${first}` : ""}? Tell me what to focus on and who it is for; I'll propose an outline${hasText ? " that follows what you have written" : ""} for you to approve first.`,
        starters: STARTERS_FROM_PAPER,
      });
      return;
    }
    push({
      role: "agent",
      text: `What shall we write${first ? `, ${first}` : ""}? Tell me what it is about and who it is for, or name one of your papers; I'll propose an outline${hasText ? " that follows what you have written" : ""} for you to approve first.`,
      starters: STARTERS,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.name, push, resumeJobId]);

  useEffect(() => {
    let alive = true;
    getDraftSources().then((r) => { if (alive && r.ok) { setInventory(r.data); greet(r.data); } });
    return () => { alive = false; if (stopRef.current) stopRef.current(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* A conversation reads from its latest message; the greeting alone, from its first line. */
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = messages.length > 1 || busy ? el.scrollHeight : 0;
  }, [messages, busy]);

  /* One line until there is more to show; `auto` first or it never shrinks. */
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  function showOutline(j, { replans = 0 } = {}) {
    /* An outline is work done; one that says the paper cannot carry what was asked is the paper not saying it. */
    showMoment(j.outline?.coverage?.met === "none" ? "cant-answer" : "done");
    setMessages((cur) => [...cur.filter((m) => m.role !== "progress").map((m) => (m.role === "outline" ? { ...m, superseded: true } : m)), { id: `outline-${j.id}-${replans}`, role: "outline", outline: j.outline, replans, jobId: j.id }]);
  }

  /* The finished draft goes to the page. A job started before the rail
     existed made its own story; the page goes there instead. */
  function settle(settled, source) {
    clearProgress();
    if (settled.storyId) {
      showMoment("done");
      push({ role: "agent", text: "Your draft is ready. Opening it, where you can read it against the paper and keep editing by instruction." });
      onStoryReady?.(settled.storyId);
      return true;
    }
    if (settled.status === "awaiting_review" && settled.draft) {
      showMoment("done");
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
      onProgress: ({ step, message, detail }) => {
        setProgress(message, step);
        /* A section as it lands: handed to the page, which types it in. */
        if (detail?.step === "section_drafted" && Array.isArray(detail.blocks)) onSection?.({ index: detail.index, total: detail.total, heading: detail.heading, kind: detail.kind, blocks: detail.blocks });
      },
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
  async function propose({ from = selectedPaper, said = true } = {}) {
    if (!ready || busy || job || !from) return;
    if (said) push({ role: "user", text: "What could this paper become?" });
    setBusy(true);
    setProgress("Reading the paper…", "pick_source");
    const r = await proposeFromPaper({ origin: from.origin, sourceId: from.id });
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
    if (r.data.reused && j.terminal) { setBusy(false); clearProgress(); if (alreadyDone(j)) return; }
    setJob(j);
    if (j.status === "awaiting_outline") { setBusy(false); showOutline(j, { replans: j.replans || 0 }); return; }
    if (j.terminal) { setBusy(false); clearProgress(); push({ role: "error", text: j.failure?.sentence || "That did not complete. Ask again in a moment." }); return; }
    watch(j);
  }
  useEffect(() => {
    if (!autoPropose || proposedRef.current) return;
    if (!ready || resumeJobId || job || !selectedPaper) return;
    proposedRef.current = true;
    const t = setTimeout(propose, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPropose, ready, resumeJobId, job, selectedPaper]);
  /* The Ideas tab asks the same question, on demand. */
  const proposeSeenRef = useRef(proposeNow);
  useEffect(() => {
    if (proposeNow === proposeSeenRef.current) return undefined;
    proposeSeenRef.current = proposeNow;
    const t = setTimeout(() => {
      if (!selectedPaper) { push({ role: "agent", text: "Pick a paper below first, and I will read it and propose what it could become." }); return; }
      propose();
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposeNow]);

  /* A brief handed in from the Ideas tab: in the box, to change before sending. */
  useEffect(() => {
    if (!prefill) return undefined;
    const t = setTimeout(() => {
      setText(prefill);
      onPrefillTaken?.();
      inputRef.current?.focus();
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  /* The line under the agent's name, in the pane's head. */
  const progressMessage = messages.find((m) => m.role === "progress");
  const progressText = progressMessage?.text || "";
  const progressStep = progressMessage?.step || null;
  useEffect(() => {
    const text = busy ? (progressText || "Working") : outlineWaiting ? "An outline is waiting for your approval" : locked ? "Draft in hand" : !ready ? "Looking at your papers" : awaitingAudience ? "Who is the article for?" : selectedPaper ? `Ready to plan from “${String(selectedPaper.title || "").length > 26 ? `${String(selectedPaper.title).slice(0, 25).trim()}…` : selectedPaper.title}”` : "Tell me what to write";
    onStatus?.({ text, busy, pose: busy ? poseForStep(progressStep) : moment || "neutral" });
  }, [busy, progressText, progressStep, moment, outlineWaiting, locked, ready, selectedPaper, awaitingAudience, onStatus]);
  useEffect(() => { onPaperChange?.(selectedPaper); }, [selectedPaper, onPaperChange]);

  /* Coming back to a job from Studio. */
  useEffect(() => {
    if (!resumeJobId) return;
    getDraftJob(resumeJobId).then((r) => {
      if (!r.ok) { push({ role: "error", text: r.error }); return; }
      const j = r.data.job;
      setJob(j);
      setPaper(j.source ? `${j.source.origin}:${j.source.id}` : null);
      setAudience(j.audience || DEFAULT_AUDIENCE);
      setAudienceSet(true);
      setVoice(j.voice || DEFAULT_VOICE);
      if (j.brief) push({ role: "user", text: j.brief });
      if (j.status === "awaiting_outline") { showOutline(j, { replans: j.replans || 0 }); return; }
      if (settle(j, j.source)) return;
      if (j.terminal) { push({ role: "error", text: j.failure?.sentence || "That draft did not complete." }); return; }
      setBusy(true);
      setProgress("Picking up where it left off…", "resume");
      watch(j);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeJobId]);

  /**
   * A job the server handed back instead of starting one: this exact brief
   * from this paper was drafted before. Says so, points at the story if it
   * became one, and leaves the composer open. True when it was handled.
   */
  function alreadyDone(j) {
    if (j.status === "published" && j.storyId) {
      push({ role: "story", text: "You have had this exact brief drafted from this paper already, and it became a story. Open it, or change a word and I will plan a fresh one.", storyId: j.storyId });
      return true;
    }
    if (j.status === "discarded") {
      push({ role: "agent", text: "This exact brief from this paper was planned before and you discarded it. Change a word and I will plan it again." });
      return true;
    }
    push({ role: "agent", text: `This exact brief from this paper was tried before and did not complete${j.failure?.sentence ? `: ${j.failure.sentence}` : ""}. Change a word and I will try again.` });
    return true;
  }

  /** Plan the article from a brief, with the paper, reader and voice given or as set. */
  async function startJob(brief, { from = selectedPaper, forAudience = audience, forVoice = voice, extras = levelBands } = {}) {
    if (!from) return;
    setBusy(true);
    setProgress("Reading the paper…", "pick_source");
    wantedLevelsRef.current = extras.filter((a) => a !== forAudience);
    /* No story from the job: the page beside us is the story. */
    const r = await createDraftJob({ origin: from.origin, sourceId: from.id, audience: forAudience, voice: forVoice, brief, approveOutline: true, createStory: false, levels: false });
    if (!r.ok) { setBusy(false); clearProgress(); push({ role: "error", text: r.error }); return; }
    const j = r.data.job;
    if (r.data.reused && j.terminal) {
      /* The same brief from the same paper was drafted before, so the server
         handed back that job rather than paying for it twice. Said as what
         it is, and the composer stays open for a changed brief. */
      setBusy(false);
      clearProgress();
      if (alreadyDone(j)) return;
    }
    setJob(j);
    if (j.status === "awaiting_outline") { setBusy(false); showOutline(j, { replans: j.replans || 0 }); return; }
    if (j.terminal) { setBusy(false); clearProgress(); push({ role: "error", text: j.failure?.sentence || "That draft did not complete. Change the brief a little and I will try again." }); return; }
    if (settle(j, from)) { setBusy(false); return; }
    watch(j);
  }

  /** Which paper: shown as cards in the thread, for a tap or a name. */
  function askWhichPaper(lead) {
    push({ role: "papers", text: lead || "Which of your papers should this come from? Tap one, or name it. Only papers we hold in full and may reproduce are listed." });
  }

  /**
   * What the scholar said — typed, or a tap on a paper or an age — goes to the
   * studio agent with what is set, and the page carries out what it decides.
   * `set` is what a tap has just changed, which this render's state does not
   * show yet.
   */
  async function converse(said, set = {}) {
    const now = {
      paperKey: set.paperKey !== undefined ? set.paperKey : paper,
      audience: set.audience !== undefined ? set.audience : audience,
      audienceSet: set.audience !== undefined ? true : audienceSet,
    };
    const thread = [...transcript(messages), { role: "scholar", text: said }];
    push({ role: "user", text: said });
    setBusy(true);
    setProgress("Reading what you said…", "converse");
    const r = await converseWithAgent({
      messages: thread,
      state: {
        paperKey: now.paperKey || null,
        paperFrom: now.paperKey ? (now.paperKey === initialSource ? "shelf" : "conversation") : null,
        audience: now.audienceSet ? now.audience : null,
        voice,
        extraAudiences: extraBands,
        stage: outlineWaiting ? "outline_waiting" : job ? "drafting" : "start",
        outlineTitle: outlineWaiting ? job?.outline?.title || null : null,
      },
    });
    setBusy(false);
    clearProgress();
    if (!r.ok) { push({ role: "error", text: r.error }); return; }
    act(r.data.decision, now);
  }

  /** Carry out what the agent decided: set what it understood, then do it. */
  function act(d, now) {
    const from = draftable.find((p) => paperKey(p) === (d.paperKey || now.paperKey)) || null;
    if (d.paperKey && from) setPaper(d.paperKey);
    if (d.audience) { setAudience(d.audience); setAudienceSet(true); }
    if (d.voice) setVoice(d.voice);
    if (d.extraAudiences?.length) setLevelBands(d.extraAudiences);
    const forAudience = d.audience || now.audience;
    const forVoice = d.voice || voice;
    const extras = d.extraAudiences?.length ? d.extraAudiences : levelBands;
    setAwaitingAudience(d.action === "ask_audience");

    switch (d.action) {
      case "ask_paper":
        askWhichPaper(d.reply);
        return;
      case "ask_audience":
        push({ role: "audience", text: d.reply || "Who is this for? Tap an age, or tell me." });
        return;
      case "plan":
        if (d.reply) push({ role: "agent", text: d.reply });
        startJob(d.brief, { from, forAudience, forVoice, extras });
        return;
      case "propose":
        if (!from) { askWhichPaper(d.reply); return; }
        if (d.reply) push({ role: "agent", text: d.reply });
        propose({ from, said: false });
        return;
      case "replan":
        if (outlineWaiting) replan(d.brief);
        return;
      case "approve":
        if (outlineWaiting && keptRef.current) approve(keptRef.current, { said: false });
        return;
      case "discard":
        if (job) discard({ reply: d.reply });
        else if (d.reply) push({ role: "agent", text: d.reply });
        return;
      default:
        if (d.reply) push({ role: "agent", text: d.reply });
    }
  }

  /** The scholar tapped a paper card. */
  function pickPaper(p) {
    setPaper(paperKey(p));
    converse(`Use “${p.title}”.`, { paperKey: paperKey(p) });
  }

  /** The scholar tapped an age. */
  function pickAudience(value) {
    const label = DRAFT_AUDIENCES.find((a) => a.value === value)?.label || value;
    setAudience(value);
    setAudienceSet(true);
    setAwaitingAudience(false);
    converse(`For ${label.toLowerCase()}.`, { audience: value });
  }

  async function send() {
    const ask = text.trim();
    /* Enter reaches here even when the button is disabled. */
    if (!ask || busy || !ready) return;
    setText("");
    await converse(ask);
  }

  /** The outline again, changed as the scholar asked. */
  async function replan(instruction) {
    if (!job) return;
    setBusy(true);
    setProgress("Replanning the outline from what you said…", "plan_outline");
    const r = await replanDraftOutline(job.id, instruction);
    if (!r.ok) { setBusy(false); clearProgress(); push({ role: "error", text: r.error }); return; }
    setJob(r.data.job);
    watch(r.data.job, r.data.job.lastSequence || 0);
  }

  /** Approve the outline: from the button, or because the scholar said so in words. */
  async function approve(outline, { said = true } = {}) {
    if (!job || busy) return;
    setBusy(true);
    if (said) push({ role: "user", text: `Approved${outline.beats.length ? `: ${outline.beats.length} section${outline.beats.length === 1 ? "" : "s"}` : ""}.` });
    setProgress("Drafting…", "draft_blocks");
    /* The page knows what is coming, and shows each section as it is written. */
    onDraftingStart?.({ title: outline.title || "", beats: outline.beats.map((b, i) => ({ index: b.index ?? i + 1, heading: b.heading })) });
    const r = await approveDraftOutline(job.id, outline);
    if (!r.ok) { setBusy(false); clearProgress(); push({ role: "error", text: r.error }); return; }
    setJob(r.data.job);
    setMessages((cur) => cur.map((m) => (m.role === "outline" ? { ...m, approved: true } : m)));
    watch(r.data.job, r.data.job.lastSequence || 0);
  }

  async function discard({ reply = "" } = {}) {
    if (!job || busy) return;
    setBusy(true);
    const r = await discardDraftJob(job.id);
    setBusy(false);
    if (!r.ok) { push({ role: "error", text: r.error }); return; }
    setJob(null);
    setMessages((cur) => cur.map((m) => (m.role === "outline" ? { ...m, superseded: true } : m)));
    push({ role: "agent", text: reply || "Discarded. Pick a paper and describe another article whenever you like." });
  }

  function startAnother() {
    if (stopRef.current) stopRef.current();
    setJob(null);
    setBusy(false);
    setMessages((cur) => cur.filter((m) => m.role !== "progress").map((m) => (m.role === "outline" ? { ...m, superseded: true } : m)));
  }

  const saidAnything = messages.some((m) => m.role === "user");
  const latestOutlineId = [...messages].reverse().find((m) => m.role === "outline" && !m.superseded && !m.approved)?.id;

  return (
    <div className="ch-wrap is-rail">
      <div className="ch-thread" ref={threadRef}>
        {messages.map((m) => {
          if (m.role === "outline") {
            return <OutlineMessage key={m.id} msg={m} latest={m.id === latestOutlineId && outlineWaiting} busy={busy} onApprove={(o) => approve(o)} onDiscard={() => discard()} onKept={onKept} moment={moment} />;
          }
          if (m.role === "user") return <div key={m.id} className="ch-msg is-user"><div className="ch-bubble">{m.text}</div></div>;
          if (m.role === "papers") {
            return (
              <div key={m.id} className="ch-msg is-agent is-papers">
                <Face />
                <div className="ch-bubble">
                  <p className="ch-text">{m.text}</p>
                  <PaperCards papers={draftable} disabled={busy || locked || Boolean(selectedPaper)} onPick={(p) => pickPaper(p)} />
                </div>
              </div>
            );
          }
          if (m.role === "story") {
            return (
              <div key={m.id} className="ch-msg is-agent is-story">
                <Face />
                <div className="ch-bubble">
                  <p className="ch-text">{m.text}</p>
                  <div className="ch-chips"><button type="button" className="ch-chip is-default" onClick={() => onStoryReady?.(m.storyId)}>Open the story</button></div>
                </div>
              </div>
            );
          }
          if (m.role === "audience") {
            return (
              <div key={m.id} className="ch-msg is-agent is-audience">
                <Face />
                <div className="ch-bubble">
                  <p className="ch-text">{m.text}</p>
                  <AudienceChips disabled={busy || locked || !awaitingAudience} onPick={(a) => pickAudience(a)} />
                </div>
              </div>
            );
          }
          if (m.role === "progress") {
            return (
              <div key={m.id} className="ch-msg is-agent is-working">
                <KivynButton pose={poseForStep(m.step)} busy size={56} />
                <div className="ag-working" role="status" aria-live="polite"><div className="ag-working-line">{m.text}</div></div>
              </div>
            );
          }
          if (m.role === "error") return <div key={m.id} className="ch-msg is-agent"><Face /><div className="ch-bubble is-error">{m.text}</div></div>;
          return (
            <div key={m.id} className="ch-msg is-agent">
              <Face />
              <div className="ch-bubble">
                {m.text}
                {/* Ways to begin: each fills the box, never sends, so the scholar finishes the sentence. Gone once anything is said. */}
                {m.starters && !saidAnything ? (
                  <div className="ch-chips ch-starters" role="group" aria-label="Ways to begin">
                    {m.starters.map((st) => (
                      <button key={st.label} type="button" className="ch-chip" disabled={!ready || busy} onClick={() => { setText(st.text); inputRef.current?.focus(); }}>{st.label}</button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <form className="ch-composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
        {/* What the article is set to, once anything is: the paper, the
            reader, the voice, the other ages. Said in a line above the box,
            with the controls one tap away behind "Change", never in the way
            of the words. The selects keep their labels so the keyboard, the
            screen reader and the browser suite see ordinary controls. */}
        {selectedPaper || locked ? (
          <div className={`ch-context${locked ? " is-locked" : ""}`}>
            <span className="ch-context-line">
              <b>From</b> “{selectedPaper?.title || "your paper"}” · <b>for</b> {DRAFT_AUDIENCES.find((a) => a.value === audience)?.label.toLowerCase() || "adults"} · {DRAFT_VOICES.find((v) => v.value === voice)?.label.toLowerCase() || "my own account"}{extraBands.length ? ` · also for ${extraBands.length} more ${extraBands.length === 1 ? "age" : "ages"}` : ""}
            </span>
            {locked ? (
              <span className="ch-locked">Set for this draft · <button type="button" className="st-link" onClick={startAnother}>Start another</button></span>
            ) : (
              <details ref={bandsRef} className="ch-context-more">
                <summary className="st-link">Change</summary>
                <div className="ch-menu ch-context-menu">
                  <label className="ch-field"><span>Paper</span>
                    <select aria-label="Paper" value={paper || ""} onChange={(e) => setPaper(e.target.value || null)}>
                      <option value="">Choose a paper…</option>
                      {draftable.map((p) => <option key={paperKey(p)} value={paperKey(p)}>{p.title}{p.year ? ` (${p.year})` : ""}</option>)}
                    </select>
                  </label>
                  <label className="ch-field"><span>Reader age</span>
                    <select aria-label="Reader age" value={audience} onChange={(e) => { setAudience(e.target.value); setAudienceSet(true); }}>
                      {DRAFT_AUDIENCES.map((a) => <option key={a.value} value={a.value}>{a.label} · grade {a.grade}</option>)}
                    </select>
                  </label>
                  <label className="ch-field"><span>Written as</span>
                    <select aria-label="Written as" value={voice} onChange={(e) => setVoice(e.target.value)}>
                      {DRAFT_VOICES.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
                    </select>
                  </label>
                  <fieldset className="ch-field ch-field-bands">
                    <legend>Also write it for</legend>
                    <p className="ch-menu__note">After the article, {AGENT_NAME} writes it again for each of these, on its own. You approve every level before readers see it.</p>
                    {DRAFT_AUDIENCES.filter((a) => a.value !== audience).map((a) => (
                      <label key={a.value} className="ch-menu__row">
                        <input type="checkbox" checked={levelBands.includes(a.value)} onChange={(e) => setLevelBands((cur) => (e.target.checked ? [...cur, a.value] : cur.filter((v) => v !== a.value)))} />
                        <span>{a.label}</span>
                        <span className="ch-menu__grade">reads at grade {a.grade}</span>
                      </label>
                    ))}
                  </fieldset>
                </div>
              </details>
            )}
          </div>
        ) : null}
        <div className="ch-dock">
          <div className="ag-box">
            {/* "+": the paper, the reader, the voice. With no paper yet it
                asks which; with one, it opens the line above for changing. */}
            <button
              type="button"
              className="ch-plus"
              aria-label={selectedPaper ? "Options" : "Add a source"}
              title={selectedPaper ? "Which source, who it is for, whose voice" : "Add a source"}
              disabled={!ready || busy || (locked && !outlineWaiting)}
              onClick={() => { if (!selectedPaper) { askWhichPaper(); return; } const el = bandsRef.current; if (el) el.open = !el.open; }}
            >
              <HiOutlinePlus size={18} aria-hidden />
            </button>
            <textarea
              ref={inputRef}
              className="ag-input"
              rows={1}
              placeholder={outlineWaiting ? PLACEHOLDER_REPLY : awaitingAudience ? "Tap an age above, or tell me who it is for…" : selectedPaper ? PLACEHOLDER_FROM_PAPER : PLACEHOLDER_START}
              value={text}
              disabled={!ready || busy || (locked && !outlineWaiting)}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            />
            <button type="submit" className="ag-send" disabled={!ready || busy || !text.trim() || (locked && !outlineWaiting)} aria-label="Send"><HiOutlineArrowUp size={16} aria-hidden /></button>
          </div>
        </div>
        <div className="ag-hint">
          <span><kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line</span>
          <span>{outlineWaiting ? "Approve the outline, or say what to change" : selectedPaper ? "An outline is proposed before anything is drafted" : "Name a paper, or ask to write from one"}</span>
        </div>
      </form>
    </div>
  );
}
