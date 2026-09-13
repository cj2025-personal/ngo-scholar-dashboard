"use client";

import { AUDIENCE_TARGETS } from "@/lib/readability";

/**
 * The checks on this draft, as it stands right now.
 *
 * Answers the second question for every paragraph: did the check agree. The
 * counts are computed from the blocks in the editor, not from the last save,
 * so a paragraph the scholar just rewrote counts as theirs immediately.
 */

export function summariseBlocks(blocks) {
  const paragraphs = blocks.filter((b) => b.type !== "image" && b.type !== "subheading" && b.type !== "heading");
  const drafted = paragraphs.filter((b) => Array.isArray(b.sourceRefs) && b.sourceRefs.length);
  const supported = drafted.filter((b) => b.fidelity?.verdict === "supported").length;
  const partial = drafted.filter((b) => b.fidelity?.verdict === "partial").length;
  const unsupported = drafted.filter((b) => b.fidelity?.verdict === "unsupported").length;
  const ownView = paragraphs.filter((b) => b.ownView).length;
  const edited = drafted.filter((b) => b.traceable === false).length;
  const uncited = paragraphs.length - drafted.length - ownView;
  return { paragraphs: paragraphs.length, drafted: drafted.length, supported, partial, unsupported, ownView, edited, uncited, attention: partial + unsupported };
}

function Meter({ assessment }) {
  if (!assessment || assessment.fkGrade === null) return null;
  const { target, fkGrade, tolerance } = assessment;
  const lo = target.grade - 3;
  const hi = target.grade + tolerance;
  const span = 16;
  const pct = (g) => `${Math.max(0, Math.min(100, ((g - 2) / span) * 100))}%`;
  return (
    <div className="ck-meter" aria-hidden>
      <div className="ck-band" style={{ left: pct(lo), width: `calc(${pct(hi)} - ${pct(lo)})` }} />
      <div className="ck-pin" style={{ left: pct(fkGrade) }} />
    </div>
  );
}

export default function ChecksRail({ blocks, assessment, audience, warnings, onGoTo }) {
  const s = summariseBlocks(blocks);
  const target = AUDIENCE_TARGETS[audience] || AUDIENCE_TARGETS.general;
  const firstAttention = blocks.findIndex((b) => b.fidelity && b.fidelity.verdict !== "supported" && Array.isArray(b.sourceRefs) && b.sourceRefs.length);
  return (
    <div className="ck-wrap">
      <span className="sc-kicker">Reading level</span>
      {assessment?.fkGrade !== null && assessment?.fkGrade !== undefined ? (
        <>
          <div className="ck-row"><span>Measured grade <b>{assessment.fkGrade}</b></span><span className="st-todo-detail">target {target.grade} for {target.label}</span></div>
          <Meter assessment={assessment} />
          <div className="st-todo-detail">
            {assessment.verdict === "pass" ? "Inside the band." : assessment.verdict === "fail" ? `${assessment.drift} grades above target. Ask the agent to make it plainer, or edit.` : !assessment.reliable ? "Too short to measure reliably yet." : "Below target; readable, but may feel thin."}
          </div>
        </>
      ) : <p className="st-muted">Nothing to measure yet.</p>}

      <div className="sc-divider" />
      <span className="sc-kicker">Checks on this draft</span>
      <div className="ck-list">
        <div className="ck-item"><span className="st-dot is-ok" /><span>{s.supported} paragraph{s.supported === 1 ? "" : "s"} supported by {s.supported === 1 ? "its" : "their"} passages</span></div>
        {s.partial ? <div className="ck-item"><span className="st-dot is-warn" /><span>{s.partial} partly supported · claims marked on the block</span>{firstAttention >= 0 ? <button type="button" className="st-link" onClick={() => onGoTo?.(firstAttention)}>Go to first</button> : null}</div> : null}
        {s.unsupported ? <div className="ck-item"><span className="st-dot is-bad" /><span>{s.unsupported} not supported by the paper · rewrite or remove</span>{firstAttention >= 0 ? <button type="button" className="st-link" onClick={() => onGoTo?.(firstAttention)}>Go to first</button> : null}</div> : null}
        {s.edited ? <div className="ck-item"><span className="st-dot is-faint" /><span>{s.edited} paragraph{s.edited === 1 ? "" : "s"} rewritten by you beyond {s.edited === 1 ? "its" : "their"} source</span></div> : null}
        {s.ownView ? <div className="ck-item"><span className="st-dot is-faint" /><span>{s.ownView} marked as your own view</span></div> : null}
        {s.uncited ? <div className="ck-item"><span className="st-dot is-faint" /><span>{s.uncited} paragraph{s.uncited === 1 ? "" : "s"} written by hand, citing nothing</span></div> : null}
        <div className="ck-item"><span className="st-dot is-ok" /><span>Written about you, never as you</span></div>
      </div>
      {warnings?.length ? (
        <>
          <div className="sc-divider" />
          <span className="sc-kicker">From the drafter</span>
          <ul className="ag-warnings">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </>
      ) : null}
    </div>
  );
}
