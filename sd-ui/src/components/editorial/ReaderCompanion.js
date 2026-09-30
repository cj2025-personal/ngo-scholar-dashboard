"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { FaPaperPlane, FaXmark } from "react-icons/fa6";

import { getPublicStoryPassages, publicEvidenceUrl } from "@/lib/drafting";
import { askCompanion, forgetMe, getCompanionThread, getMyCompanionTurns } from "@/lib/reader";

/**
 * The reading companion: a personal helper beside the article, shaped like
 * a messaging app rather than a dashboard.
 *
 * ── The shape ───────────────────────────────────────────────────────────────
 * One pane, four tabs along its foot, the way a messaging app is laid out:
 *
 *   Chat       the conversation. The reader's question takes its place at
 *              once; the work arrives step by step under it; the answer comes
 *              once the Sentinel has read it back, labelled with where it
 *              came from and with citations that point back at the page.
 *   Ask        things worth asking about THIS story, built from its headings
 *              and paragraphs. No model call: the suggestions are the story's.
 *   Progress   a reading checklist: paragraphs read, paragraphs asked about,
 *              a quiz taken, a source opened, another reading age tried.
 *              Kept in this browser only.
 *   Sources    the passages of the paper the article rests on, with the ones
 *              the companion has cited marked, and the signed record to verify.
 *
 * The companion has a name and a face the reader chooses, and a line under
 * its name that says what it is doing right now. Tapping it opens what it
 * did, what it may and may not do, and the way to be forgotten.
 *
 * ── What it is not ──────────────────────────────────────────────────────────
 * It does not remember the reader between devices, run tasks while they are
 * away, or suggest things from outside the story. The name and the checklist
 * live in this browser and nowhere else; the server knows only a hashed
 * device key. On a wide screen the article moves over and the two sit side
 * by side; on a phone the pane is a sheet over the bottom of the page.
 */

const TABS = [
  { key: "chat", label: "Chat", icon: "💬" },
  { key: "ask", label: "Ask", icon: "✦" },
  { key: "progress", label: "Progress", icon: "◎" },
  { key: "sources", label: "Sources", icon: "§" },
];

const FACES = ["?", "✦", "★", "☼", "❋", "◆"];
const TONES = ["navy", "teal", "plum", "amber"];
const DEFAULT_PERSONA = { name: "Reading companion", face: "?", tone: "navy" };

const GROUNDING_LABEL = {
  story: { text: "From the story", cls: "is-story" },
  background: { text: "Background, not from the paper", cls: "is-background" },
  not_here: { text: "The story doesn't say", cls: "is-not-here" },
};

const TOOL_ICON = { read_block: "¶", read_passage: "§", search_passages: "⌕", answer: "✎", sentinel: "✓" };

/* ── this browser's memory, and nowhere else ─────────────────────────────── */

/*
 * The persona is read as an external store: the server renders the default,
 * the browser reads what this device chose, and a change tells every
 * subscriber. Private mode or blocked storage falls back to the default.
 */
const PERSONA_KEY = "sd:companion";
const personaListeners = new Set();
let personaMemory = "";
function subscribePersona(cb) { personaListeners.add(cb); return () => personaListeners.delete(cb); }
function personaSnapshot() {
  try { return window.localStorage.getItem(PERSONA_KEY) || personaMemory; } catch { return personaMemory; }
}
function parsePersona(raw) {
  if (!raw) return DEFAULT_PERSONA;
  try {
    const p = JSON.parse(raw);
    return { name: String(p.name || DEFAULT_PERSONA.name).slice(0, 24), face: FACES.includes(p.face) ? p.face : DEFAULT_PERSONA.face, tone: TONES.includes(p.tone) ? p.tone : DEFAULT_PERSONA.tone };
  } catch {
    return DEFAULT_PERSONA;
  }
}
function usePersona() {
  const raw = useSyncExternalStore(subscribePersona, personaSnapshot, () => "");
  const persona = useMemo(() => parsePersona(raw), [raw]);
  const setPersona = useCallback((next) => {
    personaMemory = JSON.stringify(next);
    try { window.localStorage.setItem(PERSONA_KEY, personaMemory); } catch { /* private mode: it lives for this page only */ }
    personaListeners.forEach((cb) => cb());
  }, []);
  return [persona, setPersona];
}

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

/* ── pieces of the chat ──────────────────────────────────────────────────── */

function Face({ persona, size = "" }) {
  return <span className={`rc-face is-${persona.tone}${size ? ` is-${size}` : ""}`} aria-hidden>{persona.face}</span>;
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
              <button key={id} type="button" className={`rc-cite${id.startsWith("p") ? " is-paper" : ""}`} onClick={() => onCite?.(id.startsWith("b") ? { blockId: id } : { blockId: blockIds[0] || null, passageId: id })} title={id.startsWith("b") ? "Go to this paragraph" : "Open this passage of the paper"}>
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

function Turn({ turn, persona, onCite }) {
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
              <Answer turn={turn} onCite={onCite} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Intro({ persona, suggestions, onExample, disabled }) {
  return (
    <div className="ag-reply rc-intro">
      <Face persona={persona} />
      <div className="ag-reply-body">
        <p className="rc-intro-text">
          Hello, I&apos;m {persona.name}. I&apos;m here to help you read this story. Ask me about any part of it and I&apos;ll look it up in the article and the paper behind it, show you what I read, and tell you plainly if the story doesn&apos;t say. I never ask about you.
        </p>
        <p className="rc-intro-hint">Tap a paragraph to ask about that one, or start with:</p>
        <div className="ag-examples rc-examples">{suggestions.slice(0, 3).map((e) => <button key={e} type="button" className="ag-example" disabled={disabled} onClick={() => onExample(e)}>{e}</button>)}</div>
      </div>
    </div>
  );
}

/* ── Ask: things worth asking about this story ───────────────────────────── */

/**
 * Suggestions from the story itself: its headings, its paragraphs, its
 * numbers. Deterministic and free, so the tab is never empty and never
 * waits on a model.
 */
function buildSuggestions(blocks, focus) {
  const out = [];
  const headings = (blocks || []).filter((b) => b.type === "subheading" || b.type === "heading");
  const paragraphs = (blocks || []).filter((b) => b.type === "paragraph");
  if (focus?.index) out.push({ group: "About the paragraph you tapped", text: `What does paragraph ${focus.index} mean?` }, { group: "About the paragraph you tapped", text: `How did they find that out in paragraph ${focus.index}?` });
  out.push({ group: "About the whole story", text: "What's the main point of this story?" }, { group: "About the whole story", text: "What did they actually do in this study?" }, { group: "About the whole story", text: "What does this story leave out or not know yet?" });
  for (const h of headings.slice(0, 4)) out.push({ group: "By section", text: `What is “${h.text.replace(/[.?!]+$/, "")}” about?` });
  const withNumbers = paragraphs.filter((p) => /\d|\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|forty|hundred|thousand)\b/i.test(p.text)).slice(0, 3);
  for (const p of withNumbers) out.push({ group: "The numbers", text: `How did they measure what paragraph ${p.index} says?` });
  const longWord = paragraphs.flatMap((p) => p.text.split(/\W+/)).filter((w) => w.length >= 11 && /^[a-z]+$/i.test(w));
  const rare = [...new Set(longWord.map((w) => w.toLowerCase()))].slice(0, 3);
  for (const w of rare) out.push({ group: "Words", text: `What does the word ${w} mean?` });
  out.push({ group: "Test yourself", text: "Quiz me on what I've read" }, { group: "Test yourself", text: "Give me one question about each section" });
  return out;
}

function AskTab({ suggestions, onAsk, disabled }) {
  const groups = [...new Set(suggestions.map((s) => s.group))];
  return (
    <div className="rc-tab rc-ask">
      <p className="rc-tab-title">Things worth asking</p>
      <p className="st-muted rc-tab-note">Made from this story&apos;s own headings, paragraphs and numbers. Tap one and I&apos;ll look it up.</p>
      {groups.map((g) => (
        <div key={g} className="rc-ask-group">
          <p className="rc-ask-group-title">{g}</p>
          <div className="ag-examples rc-examples">
            {suggestions.filter((s) => s.group === g).map((s) => <button key={s.text} type="button" className="ag-example" disabled={disabled} onClick={() => onAsk(s.text)}>{s.text}</button>)}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Progress: a reading checklist ───────────────────────────────────────── */

function ProgressTab({ blocks, readSet, turns, marks, levelsAvailable }) {
  const paragraphs = (blocks || []).filter((b) => b.type === "paragraph");
  const readCount = paragraphs.filter((p) => readSet.has(p.index)).length;
  const asked = new Set((turns || []).flatMap((t) => t.answer?.blockIds || []).map((id) => Number(id.slice(1))));
  const askedCount = asked.size;
  const quizzed = (turns || []).some((t) => /quiz|question/i.test(t.question));
  const items = [
    { key: "read", label: "Read every paragraph", detail: `${readCount} of ${paragraphs.length}`, done: paragraphs.length > 0 && readCount >= paragraphs.length },
    { key: "ask", label: "Ask about a paragraph", detail: askedCount ? `${askedCount} asked about` : "none yet", done: askedCount > 0 },
    { key: "quiz", label: "Take a quiz", detail: quizzed ? "done" : "try “Quiz me on what I’ve read”", done: quizzed },
    { key: "source", label: "Open a passage of the paper", detail: marks.source ? "done" : "tap a Paper chip, or the Sources tab", done: Boolean(marks.source) },
    ...(levelsAvailable ? [{ key: "level", label: "Try another reading age", detail: marks.level ? "done" : "use “Read this for” above the story", done: Boolean(marks.level) }] : []),
  ];
  const done = items.filter((i) => i.done).length;
  return (
    <div className="rc-tab rc-progress">
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

function AboutSheet({ persona, onPersona, onClose, onForgotten }) {
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
        <div className="rc-faces">{FACES.map((f) => <button key={f} type="button" className={`rc-face-pick${persona.face === f ? " on" : ""}`} aria-pressed={persona.face === f} onClick={() => onPersona({ ...persona, face: f })}>{f}</button>)}</div>
      </div>
      <div className="rc-about-row">
        <span className="rc-about-label">Colour</span>
        <div className="rc-tones">{TONES.map((t) => <button key={t} type="button" className={`rc-tone-pick is-${t}${persona.tone === t ? " on" : ""}`} aria-pressed={persona.tone === t} aria-label={t} onClick={() => onPersona({ ...persona, tone: t })} />)}</div>
      </div>

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
  const [persona, setPersona] = usePersona();
  const [turns, setTurns] = useState(null);
  const [pending, setPending] = useState(null);
  const [remaining, setRemaining] = useState(null);
  const [question, setQuestion] = useState("");
  const [error, setError] = useState("");
  const [useFocus, setUseFocus] = useState(true);
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

  const suggestions = useMemo(() => buildSuggestions(blocks, focus), [blocks, focus]);
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
          <AboutSheet persona={persona} onPersona={setPersona} onClose={() => setAbout(false)} onForgotten={() => { setTurns([]); setRemaining(null); }} />
        ) : (
          <>
            {tab === "chat" ? (
              <>
                <div className="ag-thread rc-thread" ref={threadRef}>
                  {turns === null ? <p className="st-muted">Loading…</p> : null}
                  {turns !== null && turns.length === 0 ? <Intro persona={persona} suggestions={suggestions.filter((s) => s.group === "About the whole story" || s.group === "Test yourself").map((s) => s.text)} onExample={send} disabled={busy || capped} /> : null}
                  {(turns || []).map((t) => <Turn key={t.id} turn={t} persona={persona} onCite={onCite} />)}
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
                    <span>Answers come from this story and its paper, checked before you see them.</span>
                    {remaining !== null ? <span>{remaining} left today</span> : null}
                  </div>
                </form>
              </>
            ) : null}
            {tab === "ask" ? <AskTab suggestions={suggestions} onAsk={send} disabled={busy || capped} /> : null}
            {tab === "progress" ? <ProgressTab blocks={blocks} readSet={readSet} turns={turns || []} marks={marks} levelsAvailable={levelsAvailable} /> : null}
            {tab === "sources" ? <SourcesTab slug={slug} blocks={blocks} turns={turns || []} onCite={onCite} /> : null}

            <nav className="rc-tabs" aria-label="Companion sections">
              {TABS.map((t) => (
                <button key={t.key} type="button" className={`rc-tab-btn${tab === t.key ? " on" : ""}`} aria-current={tab === t.key ? "page" : undefined} onClick={() => setTab(t.key)}>
                  <span className="rc-tab-ic" aria-hidden>{t.icon}</span>
                  <span>{t.label}</span>
                </button>
              ))}
            </nav>
          </>
        )}
      </div>
    </aside>
  );
}
