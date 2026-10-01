"use client";

import { useEffect, useState } from "react";

import { AUDIENCE_TARGETS, normaliseAudience } from "@/lib/readability";
import { FaCheck, FaCircleInfo, FaTriangleExclamation } from "react-icons/fa6";

import { DRAFT_AUDIENCES, checkStoryRecord, getStoryReadingLevel } from "@/lib/drafting";

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
  /* The author's own context: theirs, judged for what it claims of the
     paper, with the specifics the agent brought in listed to verify. */
  const contextBlocks = paragraphs.filter((b) => b.ownView && b.context);
  const contextAttention = contextBlocks.filter((b) => b.context.verdict && b.context.verdict !== "clear").length;
  const verify = verifyItems(blocks);
  const edited = drafted.filter((b) => b.traceable === false).length;
  const uncited = paragraphs.length - drafted.length - ownView;
  return {
    paragraphs: paragraphs.length, drafted: drafted.length, supported, partial, unsupported,
    extension: beyond.length, follows, reachPartial, overreach,
    ownView, context: contextBlocks.length, contextAttention,
    toVerify: verify.length, unverified: verify.filter((v) => !v.verified).length,
    edited, uncited, attention: partial + unsupported + reachPartial + overreach + contextAttention,
  };
}

/** Every specific the author's own context brought in, with where it sits and whether the author has ticked it. */
export function verifyItems(blocks) {
  const out = [];
  blocks.forEach((b, i) => {
    if (!b.ownView || !b.context) return;
    (b.context.toVerify || []).forEach((v, k) => {
      if (v && v.text) out.push({ blockId: b.id, blockIndex: i, itemIndex: k, text: v.text, kind: v.kind || "other", verified: Boolean(v.verified) });
    });
  });
  return out;
}

/** Whether a drafted block still needs the scholar: short of supported, or short of following. */
export function needsAttention(b) {
  if (b.ownView && b.context) return Boolean(b.context.verdict) && b.context.verdict !== "clear";
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

/** One line of a check: its state, what it says, and where to go. */
function Item({ tone, children, action = null }) {
  return (
    <div className="ck-item">
      <span className={`st-dot is-${tone}`} />
      <span>{children}</span>
      {action}
    </div>
  );
}

export default function ChecksRail({ blocks, assessment, audience, warnings, draftChecks = null, record = null, storyId = null, version = null, dirty = false, voice = null, onAskAgent = null, levels = [], onGoTo, onStoryChanged, onOpenEvidence, onVerify = null }) {
  const s = summariseBlocks(blocks);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState("");
  /* Whether it reads right for its reader is an editor model's ruling on the
     saved version; the grade above is measured live as the scholar types. */
  const [level, setLevel] = useState({ key: null, data: null, error: "" });
  const levelKey = storyId ? `${storyId}:${version ?? ""}` : null;
  useEffect(() => {
    if (!levelKey || dirty) return undefined;
    let alive = true;
    getStoryReadingLevel(storyId).then((r) => { if (alive) setLevel({ key: levelKey, data: r.ok ? r.data : null, error: r.ok ? "" : r.error }); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levelKey, dirty]);
  const ruled = level.key === levelKey ? level.data : null;
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
  const key = normaliseAudience(audience);
  const local = AUDIENCE_TARGETS[key];
  /* The band the server judged against wins over this page's copy of the table. */
  const target = { ...local, grade: ruled?.targetGrade ?? local.grade };
  const band = DRAFT_AUDIENCES.find((a) => a.value === key)?.label || local.label;
  const firstAttention = blocks.findIndex(needsAttention);
  const ruling = dirty || !storyId ? "live" : level.key !== levelKey ? "reading" : !ruled ? "unread" : ruled.verdict === "pass" ? "fits" : ruled.verdict === "fail" ? (ruled.judged?.verdict === "too_simple" ? "simple" : "hard") : "unread";
  const attention = s.partial + s.unsupported + s.reachPartial + s.overreach + s.contextAttention;
  const authorVoice = voice === "author";
  const goFirst = (i, label = "Go to first") => (i >= 0 ? <button type="button" className="st-link" onClick={() => onGoTo?.(i)}>{label}</button> : null);
  return (
    <div className="ck-wrap ck-cards">
      <section className={`ck-card ck-level is-${ruling}`} aria-labelledby="ck-level-title">
        <header className="ck-card-head">
          <span id="ck-level-title" className="ck-card-title">Reading level</span>
          <span className="ck-chip">{band}</span>
        </header>
        {assessment?.fkGrade !== null && assessment?.fkGrade !== undefined ? (
          <>
            <div className="ck-figures">
              <div className="ck-figure"><b>{assessment.fkGrade}</b><span>measured grade</span></div>
              <div className="ck-figure is-target"><b>{target.grade}</b><span>target for {target.label}</span></div>
            </div>
            <Meter assessment={{ ...assessment, target }} />
            <div className="ck-ruling" role="status" aria-live="polite">
              <span className="ck-ruling-ic" aria-hidden>
                {ruling === "reading" ? <span className="ag-spinner" /> : ruling === "fits" ? <FaCheck size={11} /> : ruling === "hard" || ruling === "simple" ? <FaTriangleExclamation size={11} /> : <FaCircleInfo size={11} />}
              </span>
              <div className="ck-ruling-text">
                <b>
                  {ruling === "live" ? "Measured as you type" : ruling === "reading" ? "Reading it as its reader would…" : ruling === "fits" ? `Reads right for ${target.label}` : ruling === "hard" ? `Too hard for ${target.label}` : ruling === "simple" ? `Too simple for ${target.label}` : "Not judged just now"}
                </b>
                <span>
                  {ruling === "live" ? "Once saved, an editor model reads the article again for its reader."
                    : ruling === "reading" ? "An editor model is reading the saved version."
                      : ruling === "unread" ? (ruled?.reason || level.error || "The reading level could not be judged. Read it for this reader yourself.")
                        : ruled?.judged?.reason || ""}
                </span>
              </div>
            </div>
            {(ruling === "hard" || ruling === "simple") && onAskAgent ? (
              <button
                type="button"
                className="ck-cta"
                onClick={() => onAskAgent(`Rewrite the article so it reads right for ${target.label}${ruled?.judged?.guidance ? `: ${ruled.judged.guidance}` : "."} Keep every fact and add none.`)}
              >
                Ask the agent to fit it to {band.toLowerCase()}
              </button>
            ) : null}
          </>
        ) : <p className="st-muted">Nothing to measure yet.</p>}
      </section>

      <section className="ck-card" aria-labelledby="ck-draft-title">
        <header className="ck-card-head">
          <span id="ck-draft-title" className="ck-card-title">Checks on this draft</span>
          <span className={`ck-chip ${attention ? "is-warn" : "is-ok"}`}>{attention ? `${attention} need${attention === 1 ? "s" : ""} a look` : "All clear"}</span>
        </header>
        <div className="ck-list">
          <Item tone="ok">{s.supported} paragraph{s.supported === 1 ? "" : "s"} supported by {s.supported === 1 ? "its" : "their"} passages</Item>
          {s.partial ? <Item tone="warn" action={goFirst(firstAttention)}>{s.partial} partly supported · claims marked on the block</Item> : null}
          {s.unsupported ? <Item tone="bad" action={goFirst(firstAttention)}>{s.unsupported} not supported by the paper · rewrite or remove</Item> : null}
          {s.extension ? <Item tone={s.follows === s.extension ? "ok" : "faint"}>{s.follows} of {s.extension} paragraph{s.extension === 1 ? "" : "s"} beyond the paper follow{s.follows === 1 ? "s" : ""} from it · implications only</Item> : null}
          {s.reachPartial ? <Item tone="warn" action={goFirst(firstAttention)}>{s.reachPartial} partly follow{s.reachPartial === 1 ? "s" : ""} from the paper · the claims that go too far are marked</Item> : null}
          {s.overreach ? <Item tone="bad" action={goFirst(firstAttention)}>{s.overreach} go{s.overreach === 1 ? "es" : ""} beyond what the paper supports · rewrite or remove</Item> : null}
          {s.edited ? <Item tone="faint">{s.edited} paragraph{s.edited === 1 ? "" : "s"} rewritten by you beyond {s.edited === 1 ? "its" : "their"} source</Item> : null}
          {s.context ? <Item tone={s.contextAttention ? "warn" : "ok"} action={s.contextAttention ? goFirst(firstAttention) : null}>{s.context} paragraph{s.context === 1 ? "" : "s"} of your own context{s.contextAttention ? ` · ${s.contextAttention} present${s.contextAttention === 1 ? "s" : ""} it as the paper's finding` : " · said as yours, not the paper's"}</Item> : null}
          {s.ownView > s.context ? <Item tone="faint">{s.ownView - s.context} marked as your own view</Item> : null}
          {s.uncited ? <Item tone="faint">{s.uncited} paragraph{s.uncited === 1 ? "" : "s"} written by hand, citing nothing</Item> : null}
          {/* What the voice judge held each section to when it was drafted. */}
          <Item tone="ok">{authorVoice ? "Your own account: read at draft time for any sentence speaking as you or naming you" : "About you: read at draft time for any sentence speaking as you"}</Item>
        </div>
      </section>

      {s.toVerify ? (
        <section className="ck-card" aria-labelledby="ck-verify-title">
          <header className="ck-card-head">
            <span id="ck-verify-title" className="ck-card-title">To verify</span>
            <span className={`ck-chip ${s.unverified ? "is-warn" : "is-ok"}`}>{s.unverified ? `${s.unverified} of ${s.toVerify} left` : "All verified"}</span>
          </header>
          <p className="ck-card-note">The agent brought these in from outside the paper, in your own context. Tick each once you have checked it, or cut it. The story cannot be published while any is unticked.</p>
          <div className="ck-verify">
            {verifyItems(blocks).map((v) => (
              <label key={`${v.blockId}-${v.itemIndex}`} className={v.verified ? "ck-verify__row is-done" : "ck-verify__row"}>
                <input type="checkbox" checked={v.verified} disabled={!onVerify} onChange={(e) => onVerify?.(v.blockId, v.itemIndex, e.target.checked)} />
                <span>{v.text}<span className="ck-verify__kind">{v.kind}</span></span>
                <button type="button" className="st-link ck-verify__where" onClick={() => onGoTo?.(v.blockIndex)}>¶ {v.blockIndex + 1}</button>
              </label>
            ))}
          </div>
          <Item tone={s.unverified ? "warn" : "ok"}>{s.unverified ? `${s.unverified} of ${s.toVerify} still to verify` : `All ${s.toVerify} verified by you`}</Item>
        </section>
      ) : null}

      <section className="ck-card" aria-labelledby="ck-rules-title">
        <header className="ck-card-head">
          <span id="ck-rules-title" className="ck-card-title">Across the article</span>
          <button type="button" className="ck-card-link" onClick={onOpenEvidence}>Check the current text</button>
        </header>
        <div className="ck-list">
          <Item tone={numbers ? (numbers.ok ? "ok" : "bad") : "faint"} action={numbers && !numbers.ok ? goFirst(numbers.misses[0].block - 1) : null}>
            {numbers ? (numbers.ok ? `Every number in the draft was in the paper (${numbers.numbers} checked)` : `${numbers.misses.length} number${numbers.misses.length === 1 ? "" : "s"} in the draft not in the passages cited`) : "Numbers: not checked at draft time"}
          </Item>
          <Item tone={limitations?.ok === true ? "ok" : limitations?.ok === false ? "warn" : "faint"}>
            {limitations?.ok === true ? "Carries the paper's own caveats" : limitations?.ok === false ? "Cites none of the passages where the paper states its limitations" : limitations?.judged === false ? "The paper's caveats could not be read at draft time" : "The paper states no caveats of its own"}
          </Item>
          {pronouns && pronouns.ok === false ? <Item tone="bad" action={pronouns.blocks?.length ? goFirst(pronouns.blocks[0] - 1) : null}>{pronouns.sentence}</Item> : null}
          {budget && budget.ok !== null ? <Item tone={budget.ok ? "ok" : "warn"}>{budget.sentence}</Item> : null}
          {worldClaims && worldClaims.ok !== null ? (
            <Item tone={worldClaims.ok ? "ok" : "warn"} action={!worldClaims.ok ? goFirst(worldClaims.hits[0].block - 1) : null}>
              {worldClaims.ok ? "Nothing beyond the paper reads as a claim about the world" : `${worldClaims.hits.length} sentence${worldClaims.hits.length === 1 ? "" : "s"} beyond the paper read${worldClaims.hits.length === 1 ? "s" : ""} as a claim about the world, not an implication`}
            </Item>
          ) : null}
          <p className="ck-card-note">From draft time. The current text is checked when you open the evidence.</p>
        </div>
      </section>

      <section className="ck-card ck-card--split" aria-label="Reading levels and the record">
        <div className="ck-list">
          <Item tone={levelsStale ? "warn" : levelsLive ? "ok" : levelsWritten ? "navy" : "faint"}>
            {levelsWritten ? `${levelsWritten} reading level${levelsWritten === 1 ? "" : "s"} written · ${levelsLive} live for readers${levelsStale ? ` · ${levelsStale} out of date` : ""}` : "Not yet written for other reading ages"}
          </Item>
          <Item tone={record?.alerts?.length ? "bad" : record ? "ok" : "faint"} action={storyId ? <button type="button" className="st-link" disabled={checking} onClick={checkRecord}>{checking ? "Checking…" : "Check now"}</button> : null}>
            {record?.alerts?.length ? record.headline : record ? `Nothing registered against the paper · checked ${record.checkedAt ? new Date(record.checkedAt).toLocaleDateString() : "recently"}` : "Not yet checked against the record"}
          </Item>
          {checkError ? <p className="sc-write-msg is-error">{checkError}</p> : null}
        </div>
      </section>

      {warnings?.length ? (
        <details className="ck-card ck-fold">
          <summary className="ck-card-head">
            <span className="ck-card-title">From the drafter</span>
            <span className="ck-chip">{warnings.length} note{warnings.length === 1 ? "" : "s"}</span>
          </summary>
          <ul className="ag-warnings">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </details>
      ) : null}
    </div>
  );
}
