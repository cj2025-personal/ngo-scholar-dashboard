"use client";

import { useEffect, useState } from "react";
import { FaCheck, FaEye, FaTriangleExclamation } from "react-icons/fa6";

import { getStoryEvidence } from "@/lib/drafting";

import { AUDIENCE_TARGETS, normaliseAudience } from "@/lib/readability";
import { needsAttention, summariseBlocks } from "@/components/editorial/ChecksRail";

/**
 * Before it goes out under the scholar's name.
 *
 * The things the machine cannot decide: whether every paragraph is supported
 * or the scholar's own, whether the reading level is right for the reader
 * chosen, whether a block that lost its source is meant as commentary, and
 * how the story will be attributed. Publishing is still one click; this is
 * the look before it.
 */
export default function PublishCheck({ blocks, assessment, audience, author, provenance, storyId = null, levels = [], record = null, draftChecks = null, onClose, onPublish, onSchedule, onGoTo, busy }) {
  const s = summariseBlocks(blocks);
  /* The rule checks on the text as it is now, not as it was drafted. */
  const [fresh, setFresh] = useState(null);
  useEffect(() => {
    if (!storyId) return undefined;
    let alive = true;
    getStoryEvidence(storyId).then((r) => { if (alive && r.ok) setFresh(r.data); });
    return () => { alive = false; };
  }, [storyId]);
  const numbers = fresh?.checks?.numbers || draftChecks?.numbers || null;
  const limitations = fresh?.checks?.limitations || draftChecks?.limitations || null;
  const worldClaims = fresh?.checks?.worldClaims || draftChecks?.worldClaims || null;
  const budget = fresh?.checks?.budget || draftChecks?.budget || null;
  const pronouns = fresh?.checks?.pronouns || draftChecks?.pronouns || null;
  const grave = (record?.alerts || []).some((a) => a.kind === "retracted" || a.kind === "withdrawn");
  const levelsLive = (levels || []).filter((l) => l.approved && !l.stale).length;
  const levelsWaiting = (levels || []).filter((l) => !l.approved && !l.stale).length;
  const levelsStale = (levels || []).filter((l) => l.stale).length;
  const target = AUDIENCE_TARGETS[normaliseAudience(audience)];
  const firstAttention = blocks.findIndex(needsAttention);
  const firstLost = blocks.findIndex((b) => b.traceable === false);
  const levelOk = !assessment || assessment.verdict !== "fail";
  const troubles = [
    s.partial ? `${s.partial} partly supported` : "",
    s.unsupported ? `${s.unsupported} not supported` : "",
    s.reachPartial ? `${s.reachPartial} partly following from the paper` : "",
    s.overreach ? `${s.overreach} going beyond what it supports` : "",
  ].filter(Boolean).join(", ");
  const items = [
    {
      ok: s.attention === 0,
      title: s.attention === 0 ? (s.extension ? "Every drafted paragraph is supported, follows from the paper, or is yours" : "Every drafted paragraph is supported, or is yours") : `${s.attention} paragraph${s.attention === 1 ? "" : "s"} still ${s.attention === 1 ? "needs" : "need"} a look`,
      detail: s.attention === 0
        ? `${s.supported} supported by their passages${s.extension ? `, ${s.follows} beyond the paper and following from it` : ""}${s.edited ? `, ${s.edited} rewritten by you` : ""}${s.ownView ? `, ${s.ownView} marked as your view` : ""}.`
        : `${troubles}. Rewrite them, remove them, or mark them as your own view.`,
      action: s.attention ? { label: "Go to it", onClick: () => onGoTo?.(firstAttention) } : null,
    },
    ...(pronouns && pronouns.ok === false ? [{
      ok: false,
      warn: true,
      title: "This article calls you by two different pronouns",
      detail: pronouns.sentence,
      action: pronouns.blocks?.length ? { label: "Go to it", onClick: () => onGoTo?.(pronouns.blocks[0] - 1) } : null,
    }] : []),
    ...(budget && budget.ok === false ? [{
      ok: false,
      warn: true,
      title: "More of this article goes beyond the paper than comes from it",
      detail: `${budget.sentence} Readers came for what the paper found; keep that the larger part.`,
    }] : []),
    ...(worldClaims && worldClaims.ok === false ? [{
      ok: false,
      warn: true,
      title: `${worldClaims.hits.length} sentence${worldClaims.hits.length === 1 ? "" : "s"} beyond the paper read${worldClaims.hits.length === 1 ? "s" : ""} as a claim about the world`,
      detail: `${worldClaims.hits.map((h) => `"${h.sentence}" (block ${h.block})`).join("; ")}. An implication says what would follow; a claim says what is done. Only the first is yours to make from the paper alone.`,
      action: { label: "Go to it", onClick: () => onGoTo?.(worldClaims.hits[0].block - 1) },
    }] : []),
    {
      ok: levelOk,
      title: levelOk ? "Reading level on target" : "Reading level above target",
      detail: assessment?.fkGrade !== null && assessment?.fkGrade !== undefined ? `Measured grade ${assessment.fkGrade} for ${target.label}${levelOk ? "." : `, ${assessment.drift} above.`}` : "Nothing measured.",
    },
    {
      ok: s.edited === 0,
      warn: s.edited > 0,
      title: s.edited === 0 ? "Every drafted block still traces to its source" : `${s.edited} block${s.edited === 1 ? " has" : "s have"} lost ${s.edited === 1 ? "its" : "their"} source`,
      detail: s.edited === 0 ? "Readers can open the passage behind every drafted paragraph." : "You rewrote it from scratch, so it will carry no source chip. That is fine if it is your own view.",
      action: s.edited ? { label: "Go to it", onClick: () => onGoTo?.(firstLost) } : null,
    },
    ...(record?.alerts?.length ? [{
      /* A retraction blocks publishing until the scholar has marked it as
         seen on the banner. That act is recorded; publishing over it is then
         their decision, and a deliberate one. */
      ok: false,
      warn: !grave || Boolean(record.acknowledgedAt),
      title: grave ? "The paper this article rests on has been withdrawn from the record" : "The paper this article rests on has been corrected",
      detail: `${record.headline} Publishing without a notice would put your name over claims the record has changed.${grave && !record.acknowledgedAt ? " Mark it as seen on the banner above to publish anyway." : ""}`,
    }] : []),
    {
      ok: numbers ? numbers.ok : true,
      title: numbers ? (numbers.ok ? `Every number is in the paper (${numbers.numbers} checked${fresh ? ", on the current text" : ""})` : `${numbers.misses.length} number${numbers.misses.length === 1 ? "" : "s"} not in the passages cited`) : "Numbers not checked",
      detail: numbers && !numbers.ok ? `${numbers.misses.map((m) => `${m.number} in block ${m.block}`).join(", ")}. A fluent wrong number is the mistake that gets past a reader.` : "A rule, not a model, checked every figure against the passages it cites.",
      action: numbers && !numbers.ok ? { label: "Go to it", onClick: () => onGoTo?.(numbers.misses[0].block - 1) } : null,
    },
    ...(limitations && limitations.ok !== null ? [{
      ok: limitations.ok,
      warn: !limitations.ok,
      title: limitations.ok ? "The paper's own caveats are in the article" : "The paper's own caveats are not in the article",
      detail: limitations.sentence,
    }] : []),
    {
      ok: true,
      warn: levelsStale > 0 || (levels || []).length === 0,
      title: (levels || []).length === 0 ? "Not yet written for other reading ages" : `${levelsLive} reading level${levelsLive === 1 ? "" : "s"} live for readers${levelsWaiting ? `, ${levelsWaiting} waiting for your approval` : ""}${levelsStale ? `, ${levelsStale} out of date` : ""}`,
      detail: (levels || []).length === 0 ? "Readers of other ages get the article as written. You can write it for every age from the bar above the article." : levelsStale ? "An out-of-date level is never shown. Rewrite it from the bar above the article." : "Readers can switch between the levels you approved.",
    },
  ];
  const blocking = items.some((i) => !i.ok && !i.warn);

  return (
    <div className="pc-scrim" role="dialog" aria-modal="true" aria-labelledby="pc-title">
      <div className="pc-modal">
        <span className="sc-kicker">Before it goes out under your name</span>
        <h2 id="pc-title" className="st-h2" style={{ fontSize: 22, marginTop: 6 }}>Publish check</h2>
        <p className="st-sub">{blocking ? "Something still needs you." : "The machine's part is done. The rest is yours."}</p>
        <div className="pc-items">
          {items.map((it, i) => (
            <div key={i} className="pc-item">
              <span className={`pc-ic ${it.ok ? "is-ok" : it.warn ? "is-warn" : "is-bad"}`} aria-hidden>{it.ok ? <FaCheck size={11} /> : <FaTriangleExclamation size={11} />}</span>
              <div>
                <b>{it.title}</b>
                <p>{it.detail}</p>
                {it.action ? <button type="button" className="sc-write-secondary st-btn" onClick={() => { onClose(); it.action.onClick(); }}>{it.action.label}</button> : null}
              </div>
            </div>
          ))}
          <div className="pc-item">
            <span className="pc-ic is-info" aria-hidden><FaCheck size={11} /></span>
            <div>
              <b>What goes on the record</b>
              <p>{fresh ? fresh.summary : "Every claim, the passage it rests on, and your approval are recorded and signed with the article, for anyone to verify."}</p>
            </div>
          </div>
          <div className="pc-item">
            <span className="pc-ic is-info" aria-hidden><FaEye size={11} /></span>
            <div style={{ flex: 1 }}>
              <b>How it will be attributed</b>
              <div className="pc-preview">
                {author?.name ? (
                  <div className="st-row"><span className="sc-me sc-me--sm" aria-hidden>{author.initials || ""}</span><div><div style={{ fontWeight: 700 }}>{author.name}</div>{author.affiliation ? <div className="st-todo-detail">{author.affiliation}</div> : null}</div></div>
                ) : <p className="st-muted">Your byline could not be resolved from your record; the story would publish without one.</p>}
                {provenance?.line ? <div className="pc-prov">{provenance.line}</div> : null}
                {provenance?.line ? <div className="st-todo-detail">Readers can open the passage behind any drafted paragraph.</div> : null}
              </div>
            </div>
          </div>
        </div>
        <div className="pc-actions">
          <button type="button" className="sc-write-ghost" onClick={onClose}>Back to the draft</button>
          <div style={{ display: "flex", gap: 8 }}>
            {onSchedule ? <button type="button" className="sc-write-secondary" disabled={busy} onClick={onSchedule}>Schedule…</button> : null}
            <button type="button" className="sc-write-publish pc-publish" disabled={busy || blocking} onClick={onPublish}>{busy ? "Publishing…" : "Publish now"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
