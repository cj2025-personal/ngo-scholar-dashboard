"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { FaArrowRight, FaCheck, FaGripVertical, FaXmark } from "react-icons/fa6";

import { DRAFT_AUDIENCES, approveDraftOutline, createDraftJob, getDraftJob, getDraftSources, stepLabel, watchDraftJob } from "@/lib/drafting";

/**
 * New story: source, reader and brief, outline to approve, draft.
 *
 * Four steps, and the third is the one that matters: the agent proposes an
 * outline that names the passages each section will draw on, and the scholar
 * cuts, reorders and renames before a word of prose exists. When the draft
 * is ready it is already a draft story on the server; this page just goes
 * there.
 */

const STEPS = ["Source", "Reader", "Outline", "Draft"];

function SourceStep({ inventory, selected, onSelect, onNext }) {
  const draftable = inventory?.draftable || [];
  return (
    <div className="nsf-step">
      <span className="sc-kicker">Step 1 of 4</span>
      <h1 className="st-h1">Which paper?</h1>
      <p className="st-sub">Only papers we hold in full and may reproduce can be drafted from. The others can be quoted, and appear under Papers.</p>
      {!inventory ? <p className="st-muted">Loading your papers…</p> : draftable.length === 0 ? (
        <p className="sc-src-nudge">{inventory.nudge || "Nothing is ready to draft from yet."} <Link href="/papers">See your papers.</Link></p>
      ) : (
        <div className="nsf-sources">
          {draftable.map((s) => {
            const key = `${s.origin}:${s.id}`;
            return (
              <button type="button" key={key} className={selected === key ? "nsf-source on" : "nsf-source"} onClick={() => onSelect(key)}>
                <span className="nsf-radio" aria-hidden />
                <span className="nsf-source-body">
                  <span className="pp-title">{s.title}{s.year ? <span className="sc-src-year"> · {s.year}</span> : null}</span>
                  <span className="st-todo-detail">{Number(s.words || 0).toLocaleString()} words · {s.reason}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
      <div className="nsf-actions">
        <Link href="/editorial/new?blank=1" className="st-link">Start blank instead</Link>
        <button type="button" className="sc-write-publish" disabled={!selected} onClick={onNext}>Next <FaArrowRight size={11} aria-hidden /></button>
      </div>
    </div>
  );
}

function ReaderStep({ audience, setAudience, brief, setBrief, onBack, onNext, busy }) {
  return (
    <div className="nsf-step">
      <span className="sc-kicker">Step 2 of 4</span>
      <h1 className="st-h1">Who is it for, and what should it focus on?</h1>
      <p className="st-sub">The reader sets the reading level the draft is measured against. The brief is optional; where it asks for something the paper does not say, the agent leaves that out and tells you.</p>
      <div className="nsf-audiences">
        {DRAFT_AUDIENCES.map((a) => (
          <button key={a.value} type="button" className={audience === a.value ? "nsf-choice on" : "nsf-choice"} onClick={() => setAudience(a.value)}>
            <b>{a.label}</b>
            <span className="st-todo-detail">{a.value === "students" ? "Ages roughly 14 to 18. Short sentences, every term defined." : "A curious adult with no background in the field."}</span>
          </button>
        ))}
      </div>
      <label className="sc-write-field" style={{ marginTop: 18 }}>
        <span>Brief (optional)</span>
        <textarea className="sc-write-input" rows={3} maxLength={1000} placeholder="e.g. Focus on why the small boards did better in the second drought, and be honest about the sample size." value={brief} onChange={(e) => setBrief(e.target.value)} />
      </label>
      <div className="nsf-actions">
        <button type="button" className="sc-write-secondary" onClick={onBack}>Back</button>
        <button type="button" className="sc-write-publish" disabled={busy} onClick={onNext}>{busy ? "Reading the paper…" : "Propose an outline"} {busy ? null : <FaArrowRight size={11} aria-hidden />}</button>
      </div>
    </div>
  );
}

function OutlineStep({ job, progress, onApprove, onBack, busy, error }) {
  const [beats, setBeats] = useState(() => (job?.outline?.beats || []).map((b) => ({ ...b, kept: true })));
  const [title, setTitle] = useState(job?.outline?.title || "");
  const dragFrom = useRef(null);

  if (!job?.outline) {
    return (
      <div className="nsf-step">
        <span className="sc-kicker">Step 3 of 4</span>
        <h1 className="st-h1">Reading the paper</h1>
        <p className="sc-src-progress" role="status" aria-live="polite">{progress || "Starting…"}</p>
      </div>
    );
  }

  const kept = beats.filter((b) => b.kept);
  const move = (from, to) => {
    if (from === to || from < 0 || to < 0 || from >= beats.length || to >= beats.length) return;
    setBeats((cur) => { const next = cur.slice(); const [b] = next.splice(from, 1); next.splice(to, 0, b); return next; });
  };

  return (
    <div className="nsf-step">
      <span className="sc-kicker">Step 3 of 4</span>
      <h1 className="st-h1">Here is how the article would go</h1>
      <p className="st-sub">{beats.length} sections, each built only from the passages listed beside it. Drag to reorder, cut what you do not want, rename what you like, then approve. Nothing outside these passages will appear in the draft.</p>
      {job.brief ? <div className="st-card nsf-brief"><span className="sc-kicker">Your brief</span><div className="nsf-brief-text">“{job.brief}”</div></div> : null}
      <label className="sc-write-field" style={{ marginTop: 14 }}>
        <span>Working title</span>
        <input className="sc-write-input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <div className="nsf-beats">
        {beats.map((b, i) => (
          <div
            key={`${b.heading}-${i}`}
            className={b.kept ? "nsf-beat" : "nsf-beat is-cut"}
            draggable
            onDragStart={() => { dragFrom.current = i; }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => { move(dragFrom.current, i); dragFrom.current = null; }}
          >
            <span className="nsf-grip" aria-hidden><FaGripVertical size={12} /></span>
            <div className="nsf-beat-body">
              <input className="nsf-beat-heading" value={b.heading} disabled={!b.kept} onChange={(e) => setBeats((cur) => cur.map((x, k) => (k === i ? { ...x, heading: e.target.value } : x)))} />
              <div className="st-todo-detail">{b.goal}</div>
            </div>
            <div className="nsf-refs">{(b.passageIds || []).map((id) => <span key={id} className="block-chip" style={{ cursor: "default" }}>{id}</span>)}</div>
            <button type="button" className="nsf-cut" aria-label={b.kept ? "Cut this section" : "Keep this section"} onClick={() => setBeats((cur) => cur.map((x, k) => (k === i ? { ...x, kept: !x.kept } : x)))}>
              {b.kept ? <FaXmark size={12} /> : <FaCheck size={12} />}
            </button>
          </div>
        ))}
      </div>
      {error ? <p className="sc-write-msg is-error">{error}</p> : null}
      <div className="nsf-actions">
        <span className="st-todo-detail">{kept.length} section{kept.length === 1 ? "" : "s"} · roughly a minute to draft</span>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="sc-write-secondary" onClick={onBack}>Back</button>
          <button type="button" className="sc-write-publish" disabled={busy || kept.length === 0} onClick={() => onApprove({ title, deck: job.outline.deck, beats: kept.map(({ kept: _k, ...rest }) => rest) })}>
            {busy ? "Approving…" : "Approve and draft"} {busy ? null : <FaArrowRight size={11} aria-hidden />}
          </button>
        </div>
      </div>
    </div>
  );
}

function DraftStep({ progress, error }) {
  return (
    <div className="nsf-step">
      <span className="sc-kicker">Step 4 of 4</span>
      <h1 className="st-h1">Drafting</h1>
      <p className="st-sub">Each section is written from its passages and checked against them before it is accepted. You will land in the workspace when it is done.</p>
      <p className="sc-src-progress" role="status" aria-live="polite">{progress || "Starting…"}</p>
      {error ? <p className="sc-write-msg is-error">{error}</p> : null}
    </div>
  );
}

export default function NewStoryFlow({ initialSource = null, resumeJobId = null }) {
  const router = useRouter();
  const [inventory, setInventory] = useState(null);
  const [step, setStep] = useState(resumeJobId ? 2 : 0);
  const [selected, setSelected] = useState(initialSource);
  const [audience, setAudience] = useState(DRAFT_AUDIENCES[0].value);
  const [brief, setBrief] = useState("");
  const [job, setJob] = useState(null);
  const [progress, setProgress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const stopRef = useRef(null);

  useEffect(() => {
    let alive = true;
    getDraftSources().then((r) => { if (alive && r.ok) setInventory(r.data); });
    return () => { alive = false; if (stopRef.current) stopRef.current(); };
  }, []);

  /* Coming back to a paused job from Studio. */
  useEffect(() => {
    if (!resumeJobId) return;
    getDraftJob(resumeJobId).then((r) => {
      if (!r.ok) { setError(r.error); return; }
      const j = r.data.job;
      setJob(j);
      if (j.storyId) router.replace(`/editorial/${j.storyId}`);
      else if (j.status === "awaiting_outline") setStep(2);
      else if (j.terminal) { setError(j.failure?.sentence || "That draft did not complete."); setStep(2); }
      else { setStep(j.outlineApproved ? 3 : 2); watch(j.id, j.outlineApproved ? 3 : 2); }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeJobId]);

  const selectedSource = useMemo(() => {
    if (!selected || !inventory) return null;
    const [origin, ...rest] = selected.split(":");
    const id = rest.join(":");
    return inventory.draftable.find((s) => s.origin === origin && s.id === id) || null;
  }, [selected, inventory]);

  function watch(jobId, atStep, after = 0) {
    if (stopRef.current) stopRef.current();
    stopRef.current = watchDraftJob(jobId, {
      after,
      onProgress: ({ message }) => setProgress(message),
      onSettled: (settled) => {
        stopRef.current = null;
        setJob(settled);
        setProgress("");
        if (settled.status === "awaiting_outline") { setStep(2); return; }
        if (settled.storyId) { router.push(`/editorial/${settled.storyId}`); return; }
        if (settled.status === "awaiting_review") { setStep(3); setError("The draft is ready but no story was created; open it from Studio."); return; }
        setError(settled.failure?.sentence || "That draft did not complete.");
      },
      onError: (message) => { stopRef.current = null; setProgress(""); setError(message); },
    });
  }

  async function startOutline() {
    if (!selectedSource) return;
    setError("");
    setBusy(true);
    setProgress("Starting…");
    const r = await createDraftJob({ origin: selectedSource.origin, sourceId: selectedSource.id, audience, brief: brief.trim() || null, approveOutline: true, createStory: true });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    const j = r.data.job;
    setJob(j);
    setStep(2);
    if (j.storyId) { router.push(`/editorial/${j.storyId}`); return; }
    if (j.status === "awaiting_outline") return;
    if (j.terminal) { setError(j.failure?.sentence || "That draft did not complete."); return; }
    watch(j.id, 2);
  }

  async function approve(outline) {
    if (!job) return;
    setError("");
    setBusy(true);
    const r = await approveDraftOutline(job.id, outline);
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setJob(r.data.job);
    setStep(3);
    setProgress("Queued…");
    watch(job.id, 3, r.data.job.lastSequence || 0);
  }

  return (
    <div className="nsf-wrap">
      <ol className="nsf-steps" aria-label="Progress">
        {STEPS.map((label, i) => (
          <li key={label} className={i < step ? "done" : i === step ? "on" : ""}>
            <span className="nsf-n">{i < step ? <FaCheck size={10} /> : i + 1}</span>
            {label}
            {i === 0 && selectedSource && step > 0 ? <span className="st-todo-detail"> · {selectedSource.title.slice(0, 40)}</span> : null}
            {i === 1 && step > 1 ? <span className="st-todo-detail"> · {DRAFT_AUDIENCES.find((a) => a.value === audience)?.label}</span> : null}
          </li>
        ))}
      </ol>
      {step === 0 ? <SourceStep inventory={inventory} selected={selected} onSelect={setSelected} onNext={() => setStep(1)} /> : null}
      {step === 1 ? <ReaderStep audience={audience} setAudience={setAudience} brief={brief} setBrief={setBrief} onBack={() => setStep(0)} onNext={startOutline} busy={busy} /> : null}
      {step === 2 ? <OutlineStep key={`${job?.id || "none"}:${job?.outline ? "outline" : "waiting"}`} job={job} progress={progress} onApprove={approve} onBack={() => { setJob(null); setStep(1); }} busy={busy} error={error} /> : null}
      {step === 3 ? <DraftStep progress={progress} error={error} /> : null}
      {step < 2 && error ? <p className="sc-write-msg is-error">{error}</p> : null}
    </div>
  );
}
