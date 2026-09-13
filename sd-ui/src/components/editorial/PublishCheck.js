"use client";

import { FaCheck, FaEye, FaTriangleExclamation } from "react-icons/fa6";

import { AUDIENCE_TARGETS, normaliseAudience } from "@/lib/readability";
import { summariseBlocks } from "@/components/editorial/ChecksRail";

/**
 * Before it goes out under the scholar's name.
 *
 * The things the machine cannot decide: whether every paragraph is supported
 * or the scholar's own, whether the reading level is right for the reader
 * chosen, whether a block that lost its source is meant as commentary, and
 * how the story will be attributed. Publishing is still one click; this is
 * the look before it.
 */
export default function PublishCheck({ blocks, assessment, audience, author, provenance, onClose, onPublish, onSchedule, onGoTo, busy }) {
  const s = summariseBlocks(blocks);
  const target = AUDIENCE_TARGETS[normaliseAudience(audience)];
  const firstAttention = blocks.findIndex((b) => b.fidelity && b.fidelity.verdict !== "supported" && Array.isArray(b.sourceRefs) && b.sourceRefs.length);
  const firstLost = blocks.findIndex((b) => b.traceable === false);
  const levelOk = !assessment || assessment.verdict !== "fail";
  const items = [
    {
      ok: s.attention === 0,
      title: s.attention === 0 ? "Every drafted paragraph is supported, or is yours" : `${s.attention} paragraph${s.attention === 1 ? "" : "s"} still ${s.attention === 1 ? "needs" : "need"} a look`,
      detail: s.attention === 0
        ? `${s.supported} supported by their passages${s.edited ? `, ${s.edited} rewritten by you` : ""}${s.ownView ? `, ${s.ownView} marked as your view` : ""}.`
        : `${s.partial ? `${s.partial} partly supported` : ""}${s.partial && s.unsupported ? ", " : ""}${s.unsupported ? `${s.unsupported} not supported` : ""}. Rewrite them, remove them, or mark them as your own view.`,
      action: s.attention ? { label: "Go to it", onClick: () => onGoTo?.(firstAttention) } : null,
    },
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
