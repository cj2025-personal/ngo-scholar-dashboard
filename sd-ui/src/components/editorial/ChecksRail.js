"use client";

import { useState } from "react";

import { AUDIENCE_TARGETS, normaliseAudience } from "@/lib/readability";
import { checkStoryRecord } from "@/lib/drafting";

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
  const paper = drafted.filter((b) => !b.extension);
  const beyond = drafted.filter((b) => b.extension);
  const supported = paper.filter((b) => b.fidelity?.verdict === "supported").length;
  const partial = paper.filter((b) => b.fidelity?.verdict === "partial").length;
  const unsupported = paper.filter((b) => b.fidelity?.verdict === "unsupported").length;
  /* Paragraphs that go beyond the paper: judged to follow from it, or not. */
  const follows = beyond.filter((b) => b.reach?.verdict === "follows").length;
  const reachPartial = beyond.filter((b) => b.reach?.verdict === "partial").length;
  const overreach = beyond.filter((b) => b.reach?.verdict === "overreach").length;
  const ownView = paragraphs.filter((b) => b.ownView).length;
  const edited = drafted.filter((b) => b.traceable === false).length;
  const uncited = paragraphs.length - drafted.length - ownView;
  return {
    paragraphs: paragraphs.length, drafted: drafted.length, supported, partial, unsupported,
    extension: beyond.length, follows, reachPartial, overreach,
    ownView, edited, uncited, attention: partial + unsupported + reachPartial + overreach,
  };
}

/** Whether a drafted block still needs the scholar: short of supported, or short of following. */
export function needsAttention(b) {
  if (!Array.isArray(b.sourceRefs) || !b.sourceRefs.length) return false;
  if (b.extension) return Boolean(b.reach) && b.reach.verdict !== "follows";
  return Boolean(b.fidelity) && b.fidelity.verdict !== "supported";
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

export default function ChecksRail({ blocks, assessment, audience, warnings, draftChecks = null, record = null, storyId = null, levels = [], onGoTo, onStoryChanged, onOpenEvidence }) {
  const s = summariseBlocks(blocks);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState("");
  const numbers = draftChecks?.numbers || null;
  const limitations = draftChecks?.limitations || null;
  const worldClaims = draftChecks?.worldClaims || null;
  const budget = draftChecks?.budget || null;
  const pronouns = draftChecks?.pronouns || null;
  const levelsWritten = (levels || []).length;
  const levelsLive = (levels || []).filter((l) => l.approved && !l.stale).length;
  const levelsStale = (levels || []).filter((l) => l.stale).length;

  async function checkRecord() {
    setChecking(true);
    setCheckError("");
    const r = await checkStoryRecord(storyId);
    setChecking(false);
    if (!r.ok) { setCheckError(r.error); return; }
    const alerts = r.data.story?.record?.alerts?.length || 0;
    onStoryChanged?.(r.data.story, alerts ? "The record has moved against this article's source. See the notice at the top." : "Checked against the record: nothing registered against the paper.");
  }
  const target = AUDIENCE_TARGETS[normaliseAudience(audience)];
  const firstAttention = blocks.findIndex(needsAttention);
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
        {s.extension ? <div className="ck-item"><span className={`st-dot ${s.follows === s.extension ? "is-ok" : "is-faint"}`} /><span>{s.follows} of {s.extension} paragraph{s.extension === 1 ? "" : "s"} beyond the paper follow{s.follows === 1 ? "s" : ""} from it · implications only</span></div> : null}
        {s.reachPartial ? <div className="ck-item"><span className="st-dot is-warn" /><span>{s.reachPartial} partly follow{s.reachPartial === 1 ? "s" : ""} from the paper · the claims that go too far are marked</span>{firstAttention >= 0 ? <button type="button" className="st-link" onClick={() => onGoTo?.(firstAttention)}>Go to first</button> : null}</div> : null}
        {s.overreach ? <div className="ck-item"><span className="st-dot is-bad" /><span>{s.overreach} go{s.overreach === 1 ? "es" : ""} beyond what the paper supports · rewrite or remove</span>{firstAttention >= 0 ? <button type="button" className="st-link" onClick={() => onGoTo?.(firstAttention)}>Go to first</button> : null}</div> : null}
        {s.edited ? <div className="ck-item"><span className="st-dot is-faint" /><span>{s.edited} paragraph{s.edited === 1 ? "" : "s"} rewritten by you beyond {s.edited === 1 ? "its" : "their"} source</span></div> : null}
        {s.ownView ? <div className="ck-item"><span className="st-dot is-faint" /><span>{s.ownView} marked as your own view</span></div> : null}
        {s.uncited ? <div className="ck-item"><span className="st-dot is-faint" /><span>{s.uncited} paragraph{s.uncited === 1 ? "" : "s"} written by hand, citing nothing</span></div> : null}
        <div className="ck-item"><span className="st-dot is-ok" /><span>Written about you, never as you</span></div>
      </div>

      <div className="sc-divider" />
      <span className="sc-kicker">From the rules</span>
      <div className="ck-list">
        <div className="ck-item">
          <span className={`st-dot ${numbers ? (numbers.ok ? "is-ok" : "is-bad") : "is-faint"}`} />
          <span>{numbers ? (numbers.ok ? `Every number in the draft was in the paper (${numbers.numbers} checked)` : `${numbers.misses.length} number${numbers.misses.length === 1 ? "" : "s"} in the draft not in the passages cited`) : "Numbers: not checked at draft time"}</span>
          {numbers && !numbers.ok ? <button type="button" className="st-link" onClick={() => onGoTo?.(numbers.misses[0].block - 1)}>Go to first</button> : null}
        </div>
        <div className="ck-item">
          <span className={`st-dot ${limitations?.ok === true ? "is-ok" : limitations?.ok === false ? "is-warn" : "is-faint"}`} />
          <span>{limitations?.ok === true ? "Carries the paper's own caveats" : limitations?.ok === false ? "Cites none of the passages where the paper states its limitations" : "No limitations found in the paper by wording"}</span>
        </div>
        {pronouns && pronouns.ok === false ? (
          <div className="ck-item">
            <span className="st-dot is-bad" />
            <span>{pronouns.sentence}</span>
            {pronouns.blocks?.length ? <button type="button" className="st-link" onClick={() => onGoTo?.(pronouns.blocks[0] - 1)}>Go to first</button> : null}
          </div>
        ) : null}
        {budget && budget.ok !== null ? (
          <div className="ck-item">
            <span className={`st-dot ${budget.ok ? "is-ok" : "is-warn"}`} />
            <span>{budget.sentence}</span>
          </div>
        ) : null}
        {worldClaims && worldClaims.ok !== null ? (
          <div className="ck-item">
            <span className={`st-dot ${worldClaims.ok ? "is-ok" : "is-warn"}`} />
            <span>{worldClaims.ok ? "Nothing beyond the paper reads as a claim about the world" : `${worldClaims.hits.length} sentence${worldClaims.hits.length === 1 ? "" : "s"} beyond the paper read${worldClaims.hits.length === 1 ? "s" : ""} as a claim about the world, not an implication`}</span>
            {!worldClaims.ok ? <button type="button" className="st-link" onClick={() => onGoTo?.(worldClaims.hits[0].block - 1)}>Go to first</button> : null}
          </div>
        ) : null}
        <div className="ck-item"><span className="st-dot is-faint" /><span>These are from draft time.</span><button type="button" className="st-link" onClick={onOpenEvidence}>Check the current text</button></div>
      </div>

      <div className="sc-divider" />
      <span className="sc-kicker">Reading levels</span>
      <div className="ck-list">
        <div className="ck-item">
          <span className={`st-dot ${levelsStale ? "is-warn" : levelsLive ? "is-ok" : levelsWritten ? "is-navy" : "is-faint"}`} />
          <span>{levelsWritten ? `${levelsWritten} written · ${levelsLive} live for readers${levelsStale ? ` · ${levelsStale} out of date` : ""}` : "Not yet written for other reading ages"}</span>
        </div>
      </div>

      <div className="sc-divider" />
      <span className="sc-kicker">The record</span>
      <div className="ck-list">
        <div className="ck-item">
          <span className={`st-dot ${record?.alerts?.length ? "is-bad" : record ? "is-ok" : "is-faint"}`} />
          <span>{record?.alerts?.length ? record.headline : record ? `Nothing registered against the paper · checked ${record.checkedAt ? new Date(record.checkedAt).toLocaleDateString() : "recently"}` : "Not yet checked against the record"}</span>
          {storyId ? <button type="button" className="st-link" disabled={checking} onClick={checkRecord}>{checking ? "Checking…" : "Check now"}</button> : null}
        </div>
        {checkError ? <p className="sc-write-msg is-error">{checkError}</p> : null}
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
