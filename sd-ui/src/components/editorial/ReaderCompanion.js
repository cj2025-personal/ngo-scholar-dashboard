"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FaPaperPlane, FaXmark } from "react-icons/fa6";
import { HiOutlineBookOpen, HiOutlineChatBubbleLeftRight } from "react-icons/hi2";

import TypedText from "@/components/kivyn/TypedText";
import { getPublicStoryPassages, publicEvidenceUrl } from "@/lib/drafting";
import { FACES, TONES, usePersona } from "@/lib/persona";
import { askCompanion, forgetMe, getCompanionThread, getMyCompanionTurns, getSuggestions } from "@/lib/reader";
import AgentFace, { CompanionMark } from "./AgentFace";

/**
 * The reading companion: a personal helper beside the article, shaped like
 * a messaging app rather than a dashboard.
 *
 * ── The shape ───────────────────────────────────────────────────────────────
 * One pane, docked the height of the window, with two tabs along its top:
 *
 *   Chat       the conversation. The reader's question takes its place at
 *              once; the work arrives step by step under it; the answer is
 *              typed in once the Sentinel has read it back, labelled with
 *              where it came from and with citations that point back at the
 *              page. Things worth asking about THIS story, written by a
 *              model that has read it at the reader's level, open the
 *              conversation; each answer offers what to ask next.
 *   Sources    the passages of the paper the article rests on, with the ones
 *              the companion has cited marked, and the signed record to verify.
 *
 * The companion has a name and a face the reader chooses (its own mark until
 * they do), and a line under its name that says what it is doing right now.
 * Tapping it opens what it did, the reader's checklist for this story, what
 * it may and may not do, and the way to be forgotten.
 *
 * ── What it is not ──────────────────────────────────────────────────────────
 * It does not remember the reader between devices, run tasks while they are
 * away, or suggest things from outside the story. The name and the checklist
 * live in this browser and nowhere else; the server knows only a hashed
 * device key. On a wide screen the article moves over and the two sit side
 * by side; on a phone the pane is a sheet over the bottom of the page.
 */

const TABS = [
  { key: "chat", label: "Chat", icon: <HiOutlineChatBubbleLeftRight size={16} /> },
  { key: "sources", label: "Sources", icon: <HiOutlineBookOpen size={16} /> },
];

const DEFAULT_PERSONA = { name: "Reading companion", face: "mark", tone: "navy" };

const GROUNDING_LABEL = {
  story: { text: "From the story", cls: "is-story" },
  background: { text: "Background, not from the paper", cls: "is-background" },
  not_here: { text: "The story doesn't say", cls: "is-not-here" },
  clarify: { text: "A question back to you", cls: "is-not-here" },
};

const TOOL_ICON = { guard: "•", read_block: "¶", read_passage: "§", search: "⌕", answer: "✎", sentinel: "✓" };

const PERSONA_KEY = "sd:companion";

/** A citation, in the reader's terms: a paragraph number, or a passage of the paper. */
function citeLabel(id) {
  const b = /^b(\d+)$/.exec(id);
  if (b) return `¶ ${b[1]}`;
  const p = /^p(\d+)$/.exec(id);
  if (p) return `Paper · ${id}`;
  return id;
}

/** A finished turn's work, folded to one line: how many steps it took, and how it ended. */
function stepsSummary(steps) {
  const work = (steps || []).filter((s) => s.tool !== "guard" && s.tool !== "sentinel" && s.tool !== "answer");
  const reviews = (steps || []).filter((s) => s.tool === "sentinel").length;
  if (!work.length && !reviews) return "";
  const parts = [];
  if (work.length) parts.push(`${work.length} step${work.length === 1 ? "" : "s"}`);
  if (reviews) parts.push(reviews === 1 ? "checked before you saw it" : `checked ${reviews} times before you saw it`);
  return parts.join(" · ");
}

/* ── pieces of the chat ──────────────────────────────────────────────────── */

function Face({ persona, size = "" }) {
  return <AgentFace persona={persona} size={size} />;
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

function Answer({ turn, onCite, onAsk, disabled, fresh = false }) {
  /* An answer that just arrived is typed in; where it came from and what to
     ask next follow once it is all on screen. */
  const [said, setSaid] = useState(!fresh);
  const g = turn?.outcome === "refused" ? { text: "Couldn't answer safely", cls: "is-refused" }
    : turn?.outcome === "failed" ? { text: "Ran out of time", cls: "is-refused" }
    : GROUNDING_LABEL[turn?.answer?.grounding] || GROUNDING_LABEL.story;
  const blockIds = turn?.answer?.blockIds || [];
  const passageIds = turn?.answer?.passageIds || [];
  const cites = [...blockIds, ...passageIds];
  return (
    <div className="rc-answer">
      <TypedText as="p" className="rc-answer-text" text={turn.text} animate={fresh} onDone={() => setSaid(true)} />
      {said ? (
      <>
      <div className="rc-answer-foot">
        <span className={`rc-grounding ${g.cls}`}>{g.text}{turn?.answer?.term ? ` · “${turn.answer.term}”` : ""}</span>
        {cites.length ? (
          <span className="rc-cites">
            {cites.map((id) => (
              <button key={id} type="button" className={`rc-cite${id.startsWith("p") ? " is-paper" : ""}`} onClick={() => onCite?.(id.startsWith("b") ? { blockId: id } : { blockId: blockIds[0] || null, passageId: id })} title={id.startsWith("b") ? "Go to this paragraph" : "Open this passage of the paper"}>
                {citeLabel(id)}
              </button>
            ))}
          </span>
        ) : null}
      </div>
      {/* What the companion thinks this reader might want next. */}
      {turn?.answer?.followUps?.length && onAsk ? (
        <div className="rc-followups">
          {turn.answer.followUps.map((f) => <button key={f} type="button" className="rc-followup" disabled={disabled} onClick={() => onAsk(f)}>{f}</button>)}
        </div>
      ) : null}
      </>
      ) : null}
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

function Turn({ turn, persona, onCite, onAsk, disabled, latest = false, fresh = false }) {
  return (
    <div className={`ag-turn rc-turn${turn.pending ? " is-pending" : ""}`}>
      <div className="ag-ask">{turn.question}</div>
      <div className="ag-reply">
        <Face persona={persona} />
        <div className="ag-reply-body">
          {turn.pending ? (
            <div className="rc-working" role="status" aria-live="polite">
              <StepList steps={turn.steps.length ? turn.steps : [{ tool: "answer", summary: "Reading your question" }]} live />
              <Elapsed />
            </div>
          ) : (
            <>
              <Steps steps={turn.steps} />
              <Answer turn={turn} onCite={onCite} onAsk={latest ? onAsk : null} disabled={disabled} fresh={fresh} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** The opening: who it is, and things worth asking about this story, grouped as the model wrote them. */
function Intro({ persona, suggestions, onExample, disabled }) {
  return (
    <div className="ag-reply rc-intro">
      <Face persona={persona} />
      <div className="ag-reply-body">
        <p className="rc-intro-text">
          Hello, I&apos;m {persona.name}. I&apos;m here to help you read this story. Ask me about any part of it and I&apos;ll look it up in the article and the paper behind it, show you what I read, and tell you plainly if the story doesn&apos;t say. I never ask about you.
        </p>
        <p className="rc-intro-hint">Tap a paragraph to ask about that one, or start with one of these:</p>
        {suggestions === null ? <p className="st-muted">Reading the story for questions…</p> : null}
        {(suggestions || []).map((g) => (
          <div key={g.title} className="rc-ask-group">
            <p className="rc-ask-group-title">{g.title}</p>
            <div className="ag-examples rc-examples">
              {g.questions.slice(0, 3).map((q) => <button key={q} type="button" className="ag-example" disabled={disabled} onClick={() => onExample(q)}>{q}</button>)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── The reader's checklist, behind the face ─────────────────────────────── */

function ReadingChecklist({ blocks, readSet, turns, marks, levelsAvailable }) {
  const paragraphs = (blocks || []).filter((b) => b.type === "paragraph");
  const readCount = paragraphs.filter((p) => readSet.has(p.index)).length;
  const asked = new Set((turns || []).flatMap((t) => t.answer?.blockIds || []).map((id) => Number(id.slice(1))));
  const askedCount = asked.size;
  /* The companion says what kind of answer each was; a quiz is one it called a quiz. */
  const quizzed = (turns || []).some((t) => t.answer?.intent === "quiz" || t.intent === "quiz");
  const items = [
    { key: "read", label: "Read every paragraph", detail: `${readCount} of ${paragraphs.length}`, done: paragraphs.length > 0 && readCount >= paragraphs.length },
    { key: "ask", label: "Ask about a paragraph", detail: askedCount ? `${askedCount} asked about` : "none yet", done: askedCount > 0 },
    { key: "quiz", label: "Take a quiz", detail: quizzed ? "done" : "try “Quiz me on what I’ve read”", done: quizzed },
    { key: "source", label: "Open a passage of the paper", detail: marks.source ? "done" : "tap a Paper chip, or the Sources tab", done: Boolean(marks.source) },
    ...(levelsAvailable ? [{ key: "level", label: "Try another reading age", detail: marks.level ? "done" : "use “Read this for” above the story", done: Boolean(marks.level) }] : []),
  ];
  const done = items.filter((i) => i.done).length;
  return (
    <div className="rc-about-section rc-progress">
      <p className="rc-tab-title">Your reading, on this story</p>
      <p className="st-muted rc-tab-note">Kept in this browser only. Nobody else sees it.</p>
      <div className="rc-progress-bar" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={items.length} aria-label="Reading checklist">
        <span style={{ width: `${items.length ? Math.round((done / items.length) * 100) : 0}%` }} />
      </div>
      <p className="rc-progress-count">{done} of {items.length} done</p>
      <ul className="rc-checklist">
        {items.map((i) => (
          <li key={i.key} className={i.done ? "is-done" : ""}>
            <span className="rc-check" aria-hidden>{i.done ? "✓" : ""}</span>
            <span className="rc-check-label">{i.label}</span>
            <span className="rc-check-detail">{i.detail}</span>
          </li>
        ))}
      </ul>
      {asked.size ? <p className="rc-progress-asked">Paragraphs you asked about: {[...asked].sort((a, b) => a - b).map((n) => `¶ ${n}`).join(", ")}</p> : null}
    </div>
  );
}

/* ── Sources: the paper behind the story ─────────────────────────────────── */

function SourcesTab({ slug, blocks, turns, onCite }) {
  const [passages, setPassages] = useState(null);
  useEffect(() => {
    let alive = true;
    getPublicStoryPassages(slug).then((r) => { if (alive) setPassages(r.ok ? r.data.passages : []); });
    return () => { alive = false; };
  }, [slug]);
  const cited = new Set((turns || []).flatMap((t) => t.answer?.passageIds || []));
  const blockFor = (pid) => (blocks || []).find((b) => (b.passageIds || []).includes(pid))?.id || null;
  return (
    <div className="rc-tab rc-sources">
      <p className="rc-tab-title">The paper behind this story</p>
      <p className="st-muted rc-tab-note">Every paragraph drawn from the paper rests on one of these passages. The ones I&apos;ve pointed you at are marked. <a href={publicEvidenceUrl(slug)} target="_blank" rel="noreferrer noopener">Verify the record</a>.</p>
      {passages === null ? <p className="st-muted">Loading…</p> : null}
      {passages && !passages.length ? <p className="st-muted">This story was written by hand, with no paper behind it.</p> : null}
      <ol className="rc-passages">
        {(passages || []).map((p) => {
          const b = blockFor(p.id);
          return (
            <li key={p.id} className={`rc-passage${cited.has(p.id) ? " is-cited" : ""}${b ? "" : " is-unused"}`}>
              <div className="rc-passage-head">
                <b>{p.id}</b>
                {cited.has(p.id) ? <span className="rc-passage-mark">cited in an answer</span> : null}
                {b ? <button type="button" className="rc-cite" onClick={() => onCite?.({ blockId: b, passageId: p.id })} title="Open under the paragraph that rests on it">{citeLabel(b)}</button> : <span className="rc-passage-mark">not used by the article</span>}
              </div>
              <p className="rc-passage-text">{p.text}</p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ── behind the avatar: who it is, what it did, what it may do ───────────── */

function AboutSheet({ persona, onPersona, onClose, onForgotten, reading }) {
  const [state, setState] = useState({ loading: true, turns: [], keepDays: 30, error: "" });
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(persona.name);
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
  const commitName = () => onPersona({ ...persona, name: name.trim().slice(0, 24) || DEFAULT_PERSONA.name });
  return (
    <div className="rc-about">
      <div className="rc-about-head">
        <Face persona={persona} size="lg" />
        <div className="rc-about-name">
          <label className="rc-about-label" htmlFor="rc-name">Name</label>
          <input id="rc-name" className="rc-name-input" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} onBlur={commitName} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitName(); e.currentTarget.blur(); } }} />
        </div>
        <button type="button" className="ag-rail-close" onClick={onClose} aria-label="Back to the conversation"><FaXmark size={12} aria-hidden /></button>
      </div>
      <div className="rc-about-row">
        <span className="rc-about-label">Face</span>
        <div className="rc-faces">{FACES.map((f) => <button key={f} type="button" className={`rc-face-pick${persona.face === f ? " on" : ""}`} aria-pressed={persona.face === f} aria-label={f === "mark" ? "The companion's own mark" : undefined} onClick={() => onPersona({ ...persona, face: f })}>{f === "mark" ? <CompanionMark size={16} /> : f}</button>)}</div>
      </div>
      <div className="rc-about-row">
        <span className="rc-about-label">Colour</span>
        <div className="rc-tones">{TONES.map((t) => <button key={t} type="button" className={`rc-tone-pick is-${t}${persona.tone === t ? " on" : ""}`} aria-pressed={persona.tone === t} aria-label={t} onClick={() => onPersona({ ...persona, tone: t })} />)}</div>
      </div>

      {reading}

      <div className="rc-about-section">
        <p className="rc-tab-title">What {persona.name} may do</p>
        <ul className="rc-permissions">
          <li className="is-yes"><span aria-hidden>✓</span> Read this story and the paper behind it</li>
          <li className="is-yes"><span aria-hidden>✓</span> Show you every step it took, and where an answer came from</li>
          <li className="is-yes"><span aria-hidden>✓</span> Have every answer read back by a second checker before you see it</li>
          <li className="is-no"><span aria-hidden>✕</span> Ask about you, or remember anything about you</li>
          <li className="is-no"><span aria-hidden>✕</span> Bring in facts from outside the story, or give links</li>
          <li className="is-no"><span aria-hidden>✕</span> Do anything while you are away</li>
        </ul>
      </div>

      <div className="rc-about-section rc-activity">
        <p className="rc-tab-title">What it did</p>
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
      </div>

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

/* ── the pane ────────────────────────────────────────────────────────────── */

/**
 * @param {object} p
 * @param {string} p.slug
 * @param {string|null} p.level                the reading level the reader is on, or null for the article's own
 * @param {boolean} [p.levelsAvailable]         whether the story offers other reading ages
 * @param {{id,index,type,text,passageIds}[]} p.blocks   the text blocks as shown, numbered the companion's way
 * @param {Set<number>} p.readSet               paragraph numbers the reader has scrolled past
 * @param {{source?:boolean, level?:boolean}} p.marks    things the reader has done on the page
 * @param {{index:number, text:string}|null} p.focus     the paragraph the reader last touched
 * @param {(cite:{blockId:string|null, passageId?:string})=>void} [p.onCite]
 */
export default function ReaderCompanion({ slug, level = null, levelsAvailable = false, blocks = [], readSet = new Set(), marks = {}, focus = null, onCite }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("chat");
  const [about, setAbout] = useState(false);
  const [persona, setPersona] = usePersona(PERSONA_KEY, DEFAULT_PERSONA);
  const [turns, setTurns] = useState(null);
  const [pending, setPending] = useState(null);
  const [remaining, setRemaining] = useState(null);
  const [question, setQuestion] = useState("");
  const [error, setError] = useState("");
  const [useFocus, setUseFocus] = useState(true);
  /* The answers that arrived while the reader watched: these are typed in. */
  const [freshIds, setFreshIds] = useState(() => new Set());
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
    if (tab === "chat" && threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [turns?.length, pending?.steps?.length, pending, tab]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const grow = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(140, el.scrollHeight)}px`;
  }, []);

  /* Questions worth asking, written by a model, per level and paragraph in focus. */
  const [suggestions, setSuggestions] = useState({ key: "", groups: null });
  const suggestKey = `${level || ""}:${focus?.index || 0}`;
  useEffect(() => {
    if (!open || suggestions.key === suggestKey) return undefined;
    let alive = true;
    getSuggestions(slug, { level, focus: focus?.index || null }).then((r) => { if (alive) setSuggestions({ key: suggestKey, groups: r.ok ? r.data.groups || [] : [] }); });
    return () => { alive = false; };
  }, [open, slug, level, focus?.index, suggestKey, suggestions.key]);
  const focusUsable = Boolean(focus && focus.index);
  const mentionsParagraph = (t) => /paragraph\s+\d+/i.test(t);

  async function send(text) {
    const ask = (text ?? question).trim();
    if (!ask || busy) return;
    setTab("chat");
    setAbout(false);
    setError("");
    setQuestion("");
    if (inputRef.current) inputRef.current.style.height = "auto";
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
      if (r.turn) { setFreshIds((cur) => new Set(cur).add(r.turn.id)); setTurns((cur) => [...(cur || []), r.turn]); }
      else setError(r.error);
      if (r.status !== 429) setQuestion(ask);
      return;
    }
    setFreshIds((cur) => new Set(cur).add(r.data.turn.id));
    setTurns((cur) => [...(cur || []), r.data.turn]);
    if (r.data.remaining !== null) setRemaining(r.data.remaining);
    inputRef.current?.focus();
  }

  const capped = remaining === 0;
  /* The line under the name: what the companion is doing right now. */
  const status = pending ? (pending.steps.length ? pending.steps[pending.steps.length - 1].summary : "Reading your question") : capped ? "Back tomorrow" : turns?.length ? `${turns.length} question${turns.length === 1 ? "" : "s"} on this story` : "Ready when you are";

  if (!open) {
    return (
      <button type="button" className="rc-launch" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <Face persona={persona} />
        <span>Ask {persona.name === DEFAULT_PERSONA.name ? "about this story" : persona.name}</span>
      </button>
    );
  }

  return (
    <aside className="rc-sheet" role="dialog" aria-label="Reading companion">
      <div className="ag-panel rc-panel">
        <div className="rc-head">
          <button type="button" className="rc-identity" onClick={() => setAbout((v) => !v)} aria-expanded={about} title="Who this is, what it did, and what it may do">
            <Face persona={persona} size="md" />
            <span className="rc-identity-text">
              <b>{persona.name}</b>
              <span className={`rc-status${pending ? " is-busy" : ""}`}>{pending ? <span className="ag-spinner rc-step-spinner" aria-hidden /> : null}{status}</span>
            </span>
          </button>
          <button type="button" className="ag-rail-close" onClick={() => setOpen(false)} aria-label="Close the companion"><FaXmark size={12} aria-hidden /></button>
        </div>

        {about ? (
          <AboutSheet
            persona={persona}
            onPersona={setPersona}
            onClose={() => setAbout(false)}
            onForgotten={() => { setTurns([]); setRemaining(null); }}
            reading={<ReadingChecklist blocks={blocks} readSet={readSet} turns={turns || []} marks={marks} levelsAvailable={levelsAvailable} />}
          />
        ) : (
          <>
            {/* The sections along the top, as in the studio's pane. */}
            <div className="ws-tabs ws-tabs-top rc-tabs" role="tablist" aria-label="Companion sections">
              {TABS.map((t) => (
                <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`ws-tab rc-tab-btn${tab === t.key ? " on" : ""}`} onClick={() => setTab(t.key)}>
                  <span className="ws-tab-ic" aria-hidden>{t.icon}</span>
                  <span>{t.label}</span>
                </button>
              ))}
            </div>
            {tab === "chat" ? (
              <>
                <div className="ag-thread rc-thread" ref={threadRef}>
                  {turns === null ? <p className="st-muted">Loading…</p> : null}
                  {turns !== null && turns.length === 0 ? <Intro persona={persona} suggestions={suggestions.key === suggestKey ? suggestions.groups : null} onExample={send} disabled={busy || capped} /> : null}
                  {(turns || []).map((t, i) => <Turn key={t.id} turn={t} persona={persona} onCite={onCite} onAsk={send} disabled={busy || capped} latest={i === turns.length - 1 && !pending} fresh={freshIds.has(t.id)} />)}
                  {pending ? <Turn turn={pending} persona={persona} /> : null}
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
                    <textarea ref={inputRef} className="ag-input" rows={1} maxLength={500} placeholder={capped ? "You've asked a lot today. Come back tomorrow." : `Ask ${persona.name === DEFAULT_PERSONA.name ? "about this story" : persona.name}…`} value={question} disabled={busy || capped} onChange={(e) => { setQuestion(e.target.value); grow(); }} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
                    <button type="submit" className="sc-write-publish ag-send" disabled={busy || capped || !question.trim()} aria-label="Send"><FaPaperPlane size={12} aria-hidden /></button>
                  </div>
                  <div className="ag-hint">
                    <span>Answers come from this story and its paper, checked before you see them{remaining !== null ? ` · ${remaining} question${remaining === 1 ? "" : "s"} left today` : ""}.</span>
                  </div>
                </form>
              </>
            ) : null}
            {tab === "sources" ? <SourcesTab slug={slug} blocks={blocks} turns={turns || []} onCite={onCite} /> : null}
          </>
        )}
      </div>
    </aside>
  );
}
