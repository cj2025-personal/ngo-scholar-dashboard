"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FaCheck, FaXmark } from "react-icons/fa6";
import { HiOutlineArrowUp, HiOutlinePlus } from "react-icons/hi2";

import { BRIEF_SOURCE, DEFAULT_AUDIENCE, DEFAULT_VOICE, DRAFT_AUDIENCES, DRAFT_VOICES, approveDraftOutline, converseWithAgent, createDraftJob, discardDraftJob, endConversation, getDraftJob, getDraftSources, latestConversation, proposeFromPaper, replanDraftOutline, watchDraftJob } from "@/lib/drafting";
import Kivyn from "@/components/kivyn/Kivyn";
import KivynButton from "@/components/kivyn/KivynButton";
import TypedText, { TypingDots } from "@/components/kivyn/TypedText";
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

const PLACEHOLDER_START = "Describe the article you want, and which paper it should come from, if any…";
const PLACEHOLDER_FROM_BRIEF = "Describe the article you want: the subject, what to cover, who it is for…";
/* With a paper chosen, asking which paper is a question already answered. */
const PLACEHOLDER_FROM_PAPER = "Describe the article you want: what to focus on, and who it is for…";
const PLACEHOLDER_REPLY = "Tell me what to change about the outline…";

function paperKey(p) {
  return `${p.origin}:${p.id}`;
}

/* ── what the page tells the agent it did ────────────────────────────────── */

/**
 * The conversation itself is kept by the API: the scholar's words and the
 * agent's replies go on the record there as they are said. What the API
 * cannot see is what this page did between turns — an outline shown,
 * approved or replaced, a line the page said on its own — so those go with
 * the next turn as notes. A line the agent itself said (`spoken`) is already
 * on the record and is never sent back.
 */
function pageNotes(messages) {
  return messages.flatMap((m) => {
    if (m.spoken || m.role === "user") return [];
    if (m.role === "outline") return [`Proposed an outline, “${m.outline?.title || "untitled"}”: ${(m.outline?.beats || []).map((b) => b.heading).join("; ")}${m.approved ? " (approved)" : m.superseded ? " (replaced)" : ""}`];
    if (["agent", "papers", "audience", "story", "error"].includes(m.role) && m.text) return [m.text];
    return [];
  });
}

function PaperCards({ papers, onPick, disabled }) {
  return (
    <div className="ch-papers">
      {papers.map((p) => (
        <button key={paperKey(p)} type="button" className={p.brief ? "ch-paper is-brief" : "ch-paper"} disabled={disabled} onClick={() => onPick(p)}>
          <span className="ch-paper-title">{p.title}</span>
          <span className="ch-paper-meta">
            {p.brief
              ? "From what you tell me, using none of your papers. Every specific is listed for you to verify."
              : [p.year, p.wordCount ? `${Number(p.wordCount).toLocaleString()} words` : null, p.host || null].filter(Boolean).join(" · ")}
          </span>
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

/* What each drafting step is, said of the section it is on. */
const STEP_WORDS = {
  draft_blocks: (n) => `Writing section ${n}`,
  judge_voice: (n) => `Reading section ${n} for whose voice it is in`,
  judge_fidelity: (n) => `Checking section ${n} against the paper`,
  judge_reach: (n) => `Checking what section ${n} draws from the paper`,
  judge_context: (n) => `Checking section ${n} for what it claims of the paper`,
};
const ARTICLE_STEPS = new Set(["assemble", "review_article", "verify", "create_story"]);

/**
 * The draft under way, as a checklist: the paper read, each section written
 * and checked, the one being worked on, the ones still to come, and the
 * whole article read as its reader would. Every line is a step the drafter
 * reported; nothing advances on a clock.
 */
function DraftChecklist({ run, brief = false }) {
  const onArticle = ARTICLE_STEPS.has(run.step);
  return (
    <ol className="ns-checklist" aria-live="polite">
      <li className="is-done"><span className="ns-check" aria-hidden>✓</span>{brief ? "Read your brief" : "Read the paper"}</li>
      {run.beats.map((b) => {
        const done = run.written.includes(b.index);
        const now = !done && !onArticle && run.index === b.index;
        /* The section's number is in its circle; the line says what it is, or what is happening to it. */
        const label = done ? `${b.heading} · written and checked` : now ? (STEP_WORDS[run.step] || STEP_WORDS.draft_blocks)(b.index) : b.heading;
        return (
          <li key={b.index} className={done ? "is-done" : now ? "is-now" : "is-waiting"}>
            <span className="ns-check" aria-hidden>{done ? "✓" : b.index}</span>
            <span>{label}{now ? <TypingDots label="working" /> : null}</span>
          </li>
        );
      })}
      <li className={onArticle ? "is-now" : "is-waiting"}>
        <span className="ns-check" aria-hidden />
        <span>Read the whole article as its reader would{onArticle ? <TypingDots label="working" /> : null}</span>
      </li>
    </ol>
  );
}

/**
 * The outline waiting for approval, where the article will be.
 *
 * Read in the space the draft will take, beside Kivyn, with its decision
 * pinned at the foot of the page so "Approve and draft" is always in view on
 * a laptop; the sections are cards to keep or cut. It keeps the outline
 * message's own classes, so what finds an outline still finds this one.
 */
function OutlinePlan({ msg, beats, setBeats, kept, busy, onApprove, onDiscard }) {
  const beyond = beats.filter((b) => b.kind === "extension").length;
  const coverage = msg.outline.coverage || null;
  return (
    <div className="ch-msg is-agent is-outline ag-approval ws-outline-plan">
      <div className="ws-outline-plan__body">
        <p className="ag-approval-kicker">Outline · needs your approval</p>
        <h1 className="ch-outline-title">{msg.outline.title}</h1>
        {msg.outline.deck ? <p className="ws-outline-plan__deck">{msg.outline.deck}</p> : null}
        <p className="ws-outline-plan__note">
          {msg.replans ? "Replanned from what you said. " : ""}
          {msg.briefOnly
            ? `${beats.length} section${beats.length === 1 ? "" : "s"} from your brief, as your own account; none of your papers is used. Every specific the draft brings in is listed for you to verify before it can be published.`
            : beyond
            ? `${beats.length - beyond} section${beats.length - beyond === 1 ? "" : "s"} built only from the passages listed with ${beats.length - beyond === 1 ? "it" : "them"}, and ${beyond} that say${beyond === 1 ? "s" : ""} what follows for the reader: implications only, checked claim by claim.`
            : `${beats.length} section${beats.length === 1 ? "" : "s"}, each built only from the passages listed with it.`}
        </p>
        {coverage && coverage.met !== "full" ? (
          <p className="ch-coverage">
            {coverage.met === "none" ? "The paper cannot carry what you asked for" : "Part of what you asked for is left out"}
            {coverage.note ? `: ${coverage.note}` : "."}{" "}
            {coverage.met === "none" ? "This plan reports the paper instead." : "Tell Kivyn if you want a different plan."}
          </p>
        ) : null}
        <ol className="ch-beats">
          {beats.map((b, i) => (
            <li key={`${b.heading}-${i}`} className={`ch-beat${b.kept ? "" : " is-cut"}${b.kind === "extension" ? " is-beyond" : ""}`}>
              <span className="ch-beat-n" aria-hidden>{i + 1}</span>
              <div className="ch-beat-body">
                <div className="ch-beat-heading">{b.heading}{b.kind === "extension" ? <span className="ch-beat-kind" title="Says what follows from the paper for the reader. Every claim is checked to follow from the passages it builds on; nothing from outside the paper.">Beyond the paper</span> : b.kind === "context" && !msg.briefOnly ? <span className="ch-beat-kind is-context" title="Your own context: what you know about the world around the work, written as your view. Nothing in it is attributed to the paper, and every specific it brings in is listed for you to verify before the story can be published.">Your own context</span> : null}</div>
                <div className="st-todo-detail">{b.goal}</div>
              </div>
              <div className="ch-beat-refs">{(b.passageIds || []).map((id) => <span key={id} className="block-chip" style={{ cursor: "default" }}>{id}</span>)}</div>
              <button type="button" className="nsf-cut" aria-label={b.kept ? `Cut section ${i + 1}` : `Keep section ${i + 1}`} disabled={busy} onClick={() => setBeats((cur) => cur.map((x, k) => (k === i ? { ...x, kept: !x.kept } : x)))}>
                {b.kept ? <FaXmark size={11} /> : <FaCheck size={11} />}
              </button>
            </li>
          ))}
        </ol>
      </div>
      {/* The decision, pinned: it stays in view however long the plan. */}
      <div className="ch-actions ws-outline-plan__bar">
        <span className="ws-outline-plan__kept"><b>{kept.length} of {beats.length} sections kept</b> · nothing is drafted until you approve</span>
        <button type="button" className="st-link ch-discard" disabled={busy} onClick={onDiscard}>Discard</button>
        <button type="button" className="sc-write-publish st-btn-primary" disabled={busy || kept.length === 0} onClick={() => onApprove({ title: msg.outline.title, deck: msg.outline.deck, beats: kept.map(({ kept: _k, ...b }) => b) })}>
          <FaCheck size={11} aria-hidden /> Approve and draft{kept.length !== beats.length ? ` ${kept.length} of ${beats.length}` : ""}
        </button>
      </div>
    </div>
  );
}

function OutlineMessage({ msg, latest, busy, onApprove, onDiscard, onKept, moment = null, slot = null }) {
  const [beats, setBeats] = useState(() => (msg.outline.beats || []).map((b) => ({ ...b, kept: true })));
  const kept = beats.filter((b) => b.kept);
  /* The outline as it stands, sections cut or kept, so an approval said in
     words approves what the scholar sees. */
  useEffect(() => {
    if (latest) onKept?.({ title: msg.outline.title, deck: msg.outline.deck, beats: beats.filter((b) => b.kept).map(({ kept: _k, ...b }) => b) });
  }, [latest, beats, msg.outline.title, msg.outline.deck, onKept]);
  const beyond = beats.filter((b) => b.kind === "extension").length;
  const coverage = msg.outline.coverage || null;
  /* Waiting, with the page free to show it: the plan goes where the article
     will be, and the thread says where it is. */
  if (latest && slot) {
    return (
      <>
        <div className="ch-msg is-agent is-outline-note">
          <Kivyn variant="mark" size={28} pose={moment || "neutral"} live={Boolean(moment)} />
          <div className="ch-bubble">
            <TypedText animate={Boolean(msg.fresh)} text={msg.briefOnly ? `The outline is beside us: ${beats.length} section${beats.length === 1 ? "" : "s"} from your brief, using none of your papers. Approve it, cut what you don't want, or tell me what to change.` : `I read the paper. The outline is beside us: ${beats.length} section${beats.length === 1 ? "" : "s"}${beyond ? `, ${beyond} of them saying what follows for the reader` : ""}. Approve it, cut what you don't want, or tell me what to change.`} />
          </div>
        </div>
        {createPortal(<OutlinePlan msg={msg} beats={beats} setBeats={setBeats} kept={kept} busy={busy} onApprove={onApprove} onDiscard={onDiscard} />, slot)}
      </>
    );
  }
  return (
    <div className={`ch-msg is-agent is-outline${latest ? " ag-approval" : ""}`}>
      {/* While an outline waits the page is the plan and the pane's head is gone, so its moment is on this face. */}
      <Kivyn variant="mark" size={28} pose={latest && moment ? moment : "neutral"} live={Boolean(latest && moment)} />
      <div className="ch-bubble">
        {latest ? <p className="ag-approval-kicker">Needs your approval</p> : null}
        <p className="ch-text">
          {msg.replans ? "Here is the outline again, replanned from what you said." : msg.briefOnly ? "Here is how the article would go, from your brief alone." : "I read the paper. Here is how the article would go."}{" "}
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
export default function NewStoryAgent({ me, initialSource = null, resumeJobId = null, autoPropose = false, hasText = false, onDraftReady, onStoryReady, onStageChange, prefill = "", onPrefillTaken, proposeNow = 0, onStatus, onPaperChange, onDraftingStart, onSection, onDraftStep, planSlot = null }) {
  const [inventory, setInventory] = useState(null);
  /* The draft under way, as the checklist in this pane shows it: the
     sections approved, the ones written, and the step the drafter is on. */
  const [draftRun, setDrafting] = useState({ beats: [], written: [], step: null, index: null });
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
  /* The conversation on the API's record, and which of this page's lines
     have been reported to it. */
  const conversationRef = useRef(null);
  const reportedRef = useRef(new Set());
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

  /* The scholar's papers, and beside them writing from the brief alone, for
     anyone who may draft at all. */
  const papersHeld = inventory?.draftable || [];
  const draftable = inventory?.eligible ? [...papersHeld, BRIEF_SOURCE] : papersHeld;
  const selectedPaper = draftable.find((p) => paperKey(p) === paper) || null;
  const fromBrief = Boolean(selectedPaper?.brief);
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

  /* What arrives while the scholar watches is typed onto the screen; what was
     picked up from the record was said before, and is shown whole. */
  const push = useCallback((m) => setMessages((cur) => [...cur, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, fresh: m.role !== "user", ...m }]), []);
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
      /* No paper to draft from: the brief alone still is. */
      push({ role: "agent", text: `${inv.nudge ? `${inv.nudge} ` : "None of your papers can be drafted from yet. "}I can still write from your brief alone: tell me what the article should be about and who it is for.` });
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
    /* A conversation under way is picked up where it was, from the API's
       record, instead of greeting the scholar as if nothing had been said.
       Not when the page already knows what the scholar wants: a job to
       resume, or a paper to propose from. */
    const pickUp = resumeJobId || autoPropose ? Promise.resolve(null) : latestConversation().then((c) => (c.ok ? c.data?.conversation : null)).catch(() => null);
    Promise.all([getDraftSources(), pickUp]).then(([r, found]) => {
      if (!alive || !r.ok) return;
      setInventory(r.data);
      if (found && found.lines.some((l) => l.role === "scholar")) {
        conversationRef.current = found.conversationId;
        const kept = found.lines.map((l, i) => ({ id: `kept-${i}`, role: l.role === "scholar" ? "user" : "agent", text: l.text, spoken: true }));
        kept.forEach((m) => reportedRef.current.add(m.id));
        setMessages(kept);
        if (found.state?.paperKey && (found.state.paperKey === paperKey(BRIEF_SOURCE) || (r.data.draftable || []).some((p) => paperKey(p) === found.state.paperKey))) setPaper(found.state.paperKey);
        if (found.state?.audience) { setAudience(found.state.audience); setAudienceSet(true); }
        if (found.state?.voice) setVoice(found.state.voice);
        return;
      }
      greet(r.data);
    });
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
    setMessages((cur) => [...cur.filter((m) => m.role !== "progress").map((m) => (m.role === "outline" ? { ...m, superseded: true } : m)), { id: `outline-${j.id}-${replans}`, role: "outline", outline: j.outline, replans, jobId: j.id, briefOnly: j.source?.origin === "brief" }]);
  }

  /* The finished draft goes to the page. A job started before the rail
     existed made its own story; the page goes there instead. */
  function settle(settled, source) {
    clearProgress();
    if (settled.storyId) {
      showMoment("done");
      push({ role: "agent", text: settled.source?.origin === "brief" ? "Your draft is ready. Opening it, where you can verify what it names and keep editing by instruction." : "Your draft is ready. Opening it, where you can read it against the paper and keep editing by instruction." });
      /* The story is where the work goes on; this conversation is over. */
      if (conversationRef.current) { endConversation(conversationRef.current); conversationRef.current = null; }
      onStoryReady?.(settled.storyId);
      return true;
    }
    if (settled.status === "awaiting_review" && settled.draft) {
      showMoment("done");
      push({ role: "agent", text: settled.source?.origin === "brief" ? "The draft is in the page beside us, under your name, written from your brief alone. Every specific it names is listed in Checks for you to verify before it can be published. Read it, change what you like, and tell me what to do next." : "The draft is in the page beside us, under your name. Every paragraph shows the passage it came from. Read it, change what you like, and tell me what to do next." });
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
        /* The step and the section it is on, for the checklist here and the plan on the page. */
        const index = Number.isInteger(detail?.index) ? detail.index : null;
        setDrafting((cur) => ({
          ...cur,
          step,
          index: index ?? cur.index,
          written: step === "section_drafted" && index !== null && !cur.written.includes(index) ? [...cur.written, index] : cur.written,
        }));
        onDraftStep?.({ step, index });
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
    /* An angle is read from a paper; the brief alone has none to read. */
    if (!ready || busy || job || !from || from.brief) return;
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
    if (!ready || resumeJobId || job || !selectedPaper || selectedPaper.brief) return;
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
      if (!selectedPaper || selectedPaper.brief) { push({ role: "agent", text: "Pick a paper below first, and I will read it and propose what it could become." }); return; }
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
  useEffect(() => { onPaperChange?.(fromBrief ? null : selectedPaper); }, [selectedPaper, fromBrief, onPaperChange]);

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
    setProgress(from.brief ? "Planning from your brief…" : "Reading the paper…", "pick_source");
    wantedLevelsRef.current = extras.filter((a) => a !== forAudience);
    /* No story from the job: the page beside us is the story. The brief
       alone names no source, and is always the scholar's own account. */
    const r = await createDraftJob({ origin: from.origin, sourceId: from.brief ? null : from.id, audience: forAudience, voice: forVoice, brief, approveOutline: true, createStory: false, levels: false });
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
    push({ role: "papers", text: lead || "Which of your papers should this come from? Tap one, or name it. Only papers we hold in full and may reproduce are listed.", spoken: Boolean(lead) });
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
    /* What this page did since the last turn, for the record; then every
       line so far counts as reported, whatever the agent makes of it. */
    const notes = pageNotes(messages.filter((m) => !reportedRef.current.has(m.id)));
    messages.forEach((m) => reportedRef.current.add(m.id));
    push({ role: "user", text: said });
    setBusy(true);
    setProgress("Reading what you said…", "converse");
    const r = await converseWithAgent({
      conversationId: conversationRef.current,
      message: said,
      notes,
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
    conversationRef.current = r.data.conversationId || conversationRef.current;
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
        push({ role: "audience", text: d.reply || "Who is this for? Tap an age, or tell me.", spoken: Boolean(d.reply) });
        return;
      case "plan":
        if (d.reply) push({ role: "agent", text: d.reply, spoken: true });
        startJob(d.brief, { from, forAudience, forVoice, extras });
        return;
      case "propose":
        if (!from || from.brief) { askWhichPaper(d.reply); return; }
        if (d.reply) push({ role: "agent", text: d.reply, spoken: true });
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
        else if (d.reply) push({ role: "agent", text: d.reply, spoken: true });
        return;
      default:
        if (d.reply) push({ role: "agent", text: d.reply, spoken: true });
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
    const beats = outline.beats.map((b, i) => ({ index: b.index ?? i + 1, heading: b.heading }));
    onDraftingStart?.({ title: outline.title || "", beats });
    setDrafting({ beats, written: [], step: "draft_blocks", index: beats[0]?.index ?? 1 });
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
    /* Another article is another conversation; this one closes on the record. */
    if (conversationRef.current) { endConversation(conversationRef.current); conversationRef.current = null; }
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
            return <OutlineMessage key={m.id} msg={m} latest={m.id === latestOutlineId && outlineWaiting} busy={busy} onApprove={(o) => approve(o)} onDiscard={() => discard()} onKept={onKept} moment={moment} slot={planSlot} />;
          }
          if (m.role === "user") return <div key={m.id} className="ch-msg is-user"><div className="ch-bubble">{m.text}</div></div>;
          if (m.role === "papers") {
            return (
              <div key={m.id} className="ch-msg is-agent is-papers">
                <Face />
                <div className="ch-bubble">
                  <TypedText as="p" className="ch-text" animate={Boolean(m.fresh)} text={m.text} />
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
                  <TypedText as="p" className="ch-text" animate={Boolean(m.fresh)} text={m.text} />
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
                  <TypedText as="p" className="ch-text" animate={Boolean(m.fresh)} text={m.text} />
                  <AudienceChips disabled={busy || locked || !awaitingAudience} onPick={(a) => pickAudience(a)} />
                </div>
              </div>
            );
          }
          if (m.role === "progress") {
            /* While the draft is written, the steps as a checklist; before
               that, what Kivyn is doing in a line, with the dots of a reply
               on its way. */
            const draftingNow = Boolean(job) && !outlineWaiting && draftRun.beats.length > 0;
            return (
              <div key={m.id} className={`ch-msg is-agent is-working${draftingNow ? " is-drafting" : ""}`}>
                <KivynButton pose={poseForStep(m.step)} busy size={draftingNow ? 44 : 56} />
                <div className="ag-working" role="status" aria-live="polite">
                  {draftingNow ? (
                    <>
                      <div className="ag-working-line"><b>Drafting it now</b></div>
                      <DraftChecklist run={draftRun} brief={job?.source?.origin === "brief"} />
                    </>
                  ) : (
                    <div className="ag-working-line">{m.text} <TypingDots label="working" /></div>
                  )}
                </div>
              </div>
            );
          }
          if (m.role === "error") return <div key={m.id} className="ch-msg is-agent"><Face /><div className="ch-bubble is-error"><TypedText animate={Boolean(m.fresh)} text={m.text} /></div></div>;
          return (
            <div key={m.id} className="ch-msg is-agent">
              <Face />
              <div className="ch-bubble">
                <TypedText animate={Boolean(m.fresh)} text={m.text} />
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
        {/* What the article is set to: the paper, the reader, the voice,
            each changed where it is shown. Once a draft is under way they
            are said in a line, with the way to start another. */}
        {locked ? (
          <div className="ch-context ns-pickers is-locked">
            <span className="ch-locked">
              <b>Set for this draft:</b> {fromBrief ? "your brief alone, no paper" : <>“{selectedPaper?.title || "your paper"}”</>} · for {DRAFT_AUDIENCES.find((a) => a.value === audience)?.label.toLowerCase() || "adults"} · {DRAFT_VOICES.find((v) => v.value === voice)?.label.toLowerCase() || "my own account"}{extraBands.length ? ` · also for ${extraBands.length} more ${extraBands.length === 1 ? "age" : "ages"}` : ""}
              {" · "}<button type="button" className="st-link" onClick={startAnother}>Start another</button>
            </span>
          </div>
        ) : ready && draftable.length ? (
          <div className="ch-context ns-pickers">
            <label className="ns-pick is-paper">
              <span className="ns-pick__label">From</span>
              <select aria-label="Paper" value={paper || ""} disabled={busy} onChange={(e) => setPaper(e.target.value || null)}>
                <option value="">Choose a paper…</option>
                {draftable.map((p) => <option key={paperKey(p)} value={paperKey(p)}>{p.title}{p.year ? ` (${p.year})` : ""}</option>)}
              </select>
            </label>
            <label className="ns-pick">
              <span className="ns-pick__label">For</span>
              <select aria-label="Reader age" value={audience} disabled={busy} onChange={(e) => { setAudience(e.target.value); setAudienceSet(true); }}>
                {DRAFT_AUDIENCES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select>
            </label>
            {/* From the brief alone it is always the scholar's own account. */}
            {fromBrief ? null : (
              <label className="ns-pick">
                <span className="ns-pick__label">Voice</span>
                <select aria-label="Written as" value={voice} disabled={busy} onChange={(e) => setVoice(e.target.value)}>
                  {DRAFT_VOICES.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
                </select>
              </label>
            )}
            {/* The other reading ages: a choice made once, at the end, so a
                small menu rather than a fourth picker. */}
            <details ref={bandsRef} className="ch-context-more ns-pick-more">
              <summary aria-label="Also write it for other reading ages" title="Also write it for other reading ages">
                <HiOutlinePlus size={14} aria-hidden />{extraBands.length ? <span className="ns-pick-more__n">{extraBands.length}</span> : null}
              </summary>
              <div className="ch-menu ch-context-menu">
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
          </div>
        ) : null}
        <div className="ch-dock">
          <div className="ag-box">
            <textarea
              ref={inputRef}
              className="ag-input"
              rows={1}
              placeholder={outlineWaiting ? PLACEHOLDER_REPLY : awaitingAudience ? "Tap an age above, or tell me who it is for…" : fromBrief ? PLACEHOLDER_FROM_BRIEF : selectedPaper ? PLACEHOLDER_FROM_PAPER : PLACEHOLDER_START}
              value={text}
              disabled={!ready || busy || (locked && !outlineWaiting)}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            />
            <button type="submit" className="ag-send" disabled={!ready || busy || !text.trim() || (locked && !outlineWaiting)} aria-label="Send"><HiOutlineArrowUp size={16} aria-hidden /></button>
          </div>
        </div>
        <div className="ag-hint">
          {locked && !outlineWaiting && busy ? (
            <span>You can talk to {AGENT_NAME} again when the draft lands.</span>
          ) : (
            <>
              <span><kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line</span>
              <span>{outlineWaiting ? "Approve the outline, or say what to change" : selectedPaper ? "An outline comes before anything is drafted" : "Name a paper, or say to write from none"}</span>
            </>
          )}
        </div>
      </form>
    </div>
  );
}
