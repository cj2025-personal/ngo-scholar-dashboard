"use client";

import { useEffect, useState } from "react";

import { AUDIENCE_TARGETS, normaliseAudience } from "@/lib/readability";
import { FaCheck, FaCircleInfo, FaTriangleExclamation } from "react-icons/fa6";

import { DRAFT_AUDIENCES, checkStoryRecord, getStoryReadingLevel } from "@/lib/drafting";
import { AGENT_NAME } from "@/lib/kivyn/pose.mjs";

/**
 * The checks on this draft, as it stands right now.
 *
 * Answers the second question for every paragraph: did the check agree. The
 * counts are computed from the blocks in the editor, not from the last save,
 * so a paragraph the scholar just rewrote counts as theirs immediately.
 *
 * Grouped by what the scholar has to do about them: what needs them first,
 * then the reading level in one line, then what is worth a look; what is
 * clear folds away with its count, and what was not checked says so with a
 * dash rather than a tick.
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
    <div className={`ck-item is-${tone}`}>
      <span className={`st-dot is-${tone}`} aria-hidden />
      <span className="ck-item__text">{children}</span>
      {action}
    </div>
  );
}

/** A group of checks under its heading, the count beside it. */
function Group({ title, tone, items }) {
  if (!items.length) return null;
  return (
    <section className={`ck-group is-${tone}`} aria-label={title}>
      <p className="ck-group-title">{title} · {items.length}</p>
      <div className="ck-list">{items.map((it) => <Item key={it.key} tone={it.tone} action={it.action}>{it.text}</Item>)}</div>
    </section>
  );
}

export default function ChecksRail({ blocks, assessment, audience, warnings, draftChecks = null, record = null, storyId = null, version = null, dirty = false, voice = null, briefOnly = false, onAskAgent = null, levels = [], onGoTo, onStoryChanged, onOpenEvidence, onVerify = null }) {
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
  const authorVoice = voice === "author";
  const goTo = (i, label = "Go to paragraph") => (i >= 0 ? <button type="button" className="ck-act" onClick={() => onGoTo?.(i)}>{label}</button> : null);
  const askToFix = (text) => (onAskAgent ? <button type="button" className="ck-act is-ask" onClick={() => onAskAgent(text)}>Ask {AGENT_NAME} to fix it</button> : null);

  /* Every check, with what it says and what to do about it. */
  const items = [];
  const add = (key, tone, text, action = null) => items.push({ key, tone, text, action });
  /* Written from the brief alone, there is no paper: nothing to support,
     no numbers or caveats to find in it, no record to watch. What there is
     to check is that it is said as the author's own, and what it names. */
  if (!briefOnly) add("supported", s.supported ? "ok" : "faint", `${s.supported} paragraph${s.supported === 1 ? "" : "s"} supported by ${s.supported === 1 ? "its" : "their"} passages`);
  if (s.partial) add("partial", "warn", `${s.partial} partly supported · the claims to check are marked on the paragraph`, goTo(firstAttention));
  if (s.unsupported) add("unsupported", "bad", `${s.unsupported} not supported by the paper · rewrite or remove`, goTo(firstAttention));
  if (s.extension) add("beyond", s.follows === s.extension ? "ok" : "faint", `${s.follows} of ${s.extension} paragraph${s.extension === 1 ? "" : "s"} beyond the paper follow${s.follows === 1 ? "s" : ""} from it · implications only`);
  if (s.reachPartial) add("reachPartial", "warn", `${s.reachPartial} partly follow${s.reachPartial === 1 ? "s" : ""} from the paper · the claims that go too far are marked`, goTo(firstAttention));
  if (s.overreach) add("overreach", "bad", `${s.overreach} go${s.overreach === 1 ? "es" : ""} beyond what the paper supports · rewrite or remove`, goTo(firstAttention));
  if (s.edited) add("edited", "faint", `${s.edited} paragraph${s.edited === 1 ? "" : "s"} rewritten by you beyond ${s.edited === 1 ? "its" : "their"} source`);
  if (s.context && briefOnly) add("context", s.contextAttention ? "warn" : "ok", `${s.context} paragraph${s.context === 1 ? "" : "s"}, all your own account${s.contextAttention ? ` · ${s.contextAttention} present${s.contextAttention === 1 ? "s" : ""} something as a study's finding` : " · none presented as a study's finding"}`, s.contextAttention ? goTo(firstAttention) : null);
  else if (s.context) add("context", s.contextAttention ? "warn" : "ok", `${s.context} paragraph${s.context === 1 ? "" : "s"} of your own context${s.contextAttention ? ` · ${s.contextAttention} present${s.contextAttention === 1 ? "s" : ""} it as the paper's finding` : " · said as yours, not the paper's"}`, s.contextAttention ? goTo(firstAttention) : null);
  if (s.ownView > s.context) add("own", "faint", `${s.ownView - s.context} marked as your own view`);
  if (s.uncited) add("uncited", "faint", `${s.uncited} paragraph${s.uncited === 1 ? "" : "s"} written by hand, citing nothing`);
  /* What the voice judge held each section to when it was drafted. */
  add("voice", "ok", authorVoice ? "Your own account: read at draft time for any sentence speaking as you or naming you" : "About you: read at draft time for any sentence speaking as you");
  if (briefOnly) {
    /* Nothing of a paper's to check against. */
  } else if (numbers) {
    if (numbers.ok) add("numbers", "ok", `Every number in the draft was in the paper (${numbers.numbers} checked)`);
    else add("numbers", "bad", `${numbers.misses.length === 1 ? `“${numbers.misses[0].number}” in paragraph ${numbers.misses[0].block} is` : `${numbers.misses.length} numbers in the draft are`} not in the passage${numbers.misses.length === 1 ? "" : "s"} cited`, <span className="ck-acts">{goTo(numbers.misses[0].block - 1)}{askToFix(`The number ${numbers.misses[0].number} in paragraph ${numbers.misses[0].block} is not in the passage it cites. Correct it from the paper, or remove it.`)}</span>);
  } else {
    add("numbers", "faint", "Numbers: not checked at draft time");
  }
  if (briefOnly) { /* no paper, so no caveats of its own */ }
  else if (limitations?.ok === true) add("limits", "ok", "Carries the paper's own caveats");
  else if (limitations?.ok === false) add("limits", "warn", "Cites none of the passages where the paper states its limitations");
  else add("limits", "faint", limitations?.judged === false ? "The paper's caveats could not be read at draft time" : "The paper states no caveats of its own");
  if (pronouns && pronouns.ok === false) add("pronouns", "bad", pronouns.sentence, pronouns.blocks?.length ? goTo(pronouns.blocks[0] - 1) : null);
  if (budget && budget.ok !== null && !briefOnly) add("budget", budget.ok ? "ok" : "warn", budget.sentence);
  if (worldClaims && worldClaims.ok !== null) {
    add("world", worldClaims.ok ? "ok" : "warn", worldClaims.ok ? "Nothing beyond the paper reads as a claim about the world" : `${worldClaims.hits.length} sentence${worldClaims.hits.length === 1 ? "" : "s"} beyond the paper read${worldClaims.hits.length === 1 ? "s" : ""} as a claim about the world, not an implication`, !worldClaims.ok ? goTo(worldClaims.hits[0].block - 1) : null);
  }
  add("levels", levelsStale || levelsWritten > levelsLive ? "warn" : levelsLive ? "ok" : "faint", levelsWritten ? `${levelsWritten} reading level${levelsWritten === 1 ? "" : "s"} written · ${levelsLive} live for readers${levelsStale ? ` · ${levelsStale} out of date` : ""}` : "Not yet written for other reading ages");
  const recordAction = storyId ? <button type="button" className="ck-act" disabled={checking} onClick={checkRecord}>{checking ? "Checking…" : "Check now"}</button> : null;
  if (!briefOnly) add("record", record?.alerts?.length ? "bad" : record ? "ok" : "faint", record?.alerts?.length ? record.headline : record ? `Nothing registered against the paper · checked ${record.checkedAt ? new Date(record.checkedAt).toLocaleDateString() : "recently"}` : "Not yet checked against the record", recordAction);

  const needs = items.filter((i) => i.tone === "bad");
  const looks = items.filter((i) => i.tone === "warn");
  const clear = items.filter((i) => i.tone === "ok");
  const unchecked = items.filter((i) => i.tone === "faint");
  const verifyLeft = s.toVerify && s.unverified;
  const clearCount = clear.length + (s.toVerify && !s.unverified ? 1 : 0);

  const verifyCard = s.toVerify ? (
    <section className="ck-card ck-verify-card" aria-labelledby="ck-verify-title">
      <header className="ck-card-head">
        <span id="ck-verify-title" className="ck-card-title">To verify</span>
        <span className={`ck-chip ${s.unverified ? "is-warn" : "is-ok"}`}>{s.unverified ? `${s.unverified} of ${s.toVerify} left` : "All verified"}</span>
      </header>
      <p className="ck-card-note">{briefOnly ? `${AGENT_NAME} wrote these from your brief, with no paper behind them.` : `${AGENT_NAME} brought these in from outside the paper, in your own context.`} Tick each once you have checked it, or cut it. The story cannot be published while any is unticked.</p>
      <div className="ck-verify">
        {verifyItems(blocks).map((v) => (
          <label key={`${v.blockId}-${v.itemIndex}`} className={v.verified ? "ck-verify__row is-done" : "ck-verify__row"}>
            <input type="checkbox" checked={v.verified} disabled={!onVerify} onChange={(e) => onVerify?.(v.blockId, v.itemIndex, e.target.checked)} />
            <span>{v.text}<span className="ck-verify__kind">{v.kind}</span></span>
            <button type="button" className="st-link ck-verify__where" onClick={() => onGoTo?.(v.blockIndex)}>¶ {v.blockIndex + 1}</button>
          </label>
        ))}
      </div>
    </section>
  ) : null;

  return (
    <div className="ck-wrap ck-groups">
      <Group title="Needs you" tone="bad" items={needs} />
      {verifyLeft ? verifyCard : null}

      <Group title="Worth a look" tone="warn" items={looks} />

      {/* The reading level, in one line: what was measured, what it is for, and the ruling. */}
      <section className={`ck-level-row is-${ruling}`} aria-labelledby="ck-level-title">
        {assessment?.fkGrade !== null && assessment?.fkGrade !== undefined ? (
          <>
            <div className="ck-level-row__top">
              <span className="ck-ruling-ic" aria-hidden>
                {ruling === "reading" ? <span className="ag-spinner" /> : ruling === "fits" ? <FaCheck size={11} /> : ruling === "hard" || ruling === "simple" ? <FaTriangleExclamation size={11} /> : <FaCircleInfo size={11} />}
              </span>
              <span className="ck-level-row__text" role="status" aria-live="polite">
                <b id="ck-level-title">
                  {ruling === "live" ? `Reading level · measured as you type` : ruling === "reading" ? "Reading it as its reader would…" : ruling === "fits" ? `Reading level fits ${band.toLowerCase()}` : ruling === "hard" ? `Too hard for ${target.label}` : ruling === "simple" ? `Too simple for ${target.label}` : "Reading level not judged just now"}
                </b>
                <span>Measured grade {assessment.fkGrade} · target {target.grade}</span>
              </span>
              <Meter assessment={{ ...assessment, target }} />
            </div>
            {ruling === "hard" || ruling === "simple" || ruling === "unread" ? (
              <p className="ck-level-row__why">
                {ruling === "unread" ? (ruled?.reason || level.error || "The reading level could not be judged. Read it for this reader yourself.") : ruled?.judged?.reason || ""}
              </p>
            ) : null}
            {(ruling === "hard" || ruling === "simple") && onAskAgent ? (
              <button
                type="button"
                className="ck-cta"
                onClick={() => onAskAgent(`Rewrite the article so it reads right for ${target.label}${ruled?.judged?.guidance ? `: ${ruled.judged.guidance}` : "."} Keep every fact and add none.`)}
              >
                Ask {AGENT_NAME} to fit it to {band.toLowerCase()}
              </button>
            ) : null}
          </>
        ) : <p className="st-muted" id="ck-level-title">Reading level: nothing to measure yet.</p>}
      </section>

      <details className="ck-fold is-clear">
        <summary><span>Clear · {clearCount} check{clearCount === 1 ? "" : "s"}</span></summary>
        <div className="ck-list">{clear.map((it) => <Item key={it.key} tone={it.tone} action={it.action}>{it.text}</Item>)}</div>
        {s.toVerify && !s.unverified ? verifyCard : null}
        <button type="button" className="ck-act" onClick={onOpenEvidence}>Check the current text against the paper</button>
      </details>

      {unchecked.length ? (
        <details className="ck-fold is-unchecked" open>
          <summary><span>Not checked · {unchecked.length}</span></summary>
          <div className="ck-list">{unchecked.map((it) => <Item key={it.key} tone={it.tone} action={it.action}>{it.text}</Item>)}</div>
          <p className="ck-card-note">A dash, not a tick: these were not checked, or have nothing to check.</p>
        </details>
      ) : null}
      {checkError ? <p className="sc-write-msg is-error">{checkError}</p> : null}

      {warnings?.length ? (
        <details className="ck-fold">
          <summary><span>From the drafter · {warnings.length} note{warnings.length === 1 ? "" : "s"}</span></summary>
          <ul className="ag-warnings">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </details>
      ) : null}
    </div>
  );
}
