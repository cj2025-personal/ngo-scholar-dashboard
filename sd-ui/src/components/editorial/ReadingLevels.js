"use client";

import { useState } from "react";
import { FaCheck, FaRotate, FaWandMagicSparkles } from "react-icons/fa6";

import { DRAFT_AUDIENCES, approveStoryLevels, generateStoryLevels } from "@/lib/drafting";
import { normaliseAudience } from "@/lib/readability";

/**
 * The same article, for every reading age.
 *
 * A bar above the article names each age band and where it stands: not
 * written, ready to review, out of date, or live. Pick one and the article
 * is shown as that reader would see it, block for block beside the version
 * the scholar edits, with the checks that were run on it. Nothing reaches a
 * reader until the scholar approves that level; nothing stale ever does.
 */

function LevelStatus({ level }) {
  if (!level) return <span className="lv-status is-none">Not written</span>;
  if (level.stale) return <span className="lv-status is-stale">Out of date</span>;
  if (level.approved) return <span className="lv-status is-live">Live for readers</span>;
  return <span className="lv-status is-ready">Ready to review</span>;
}

function LevelBlocks({ blocks }) {
  return (
    <div className="lv-blocks">
      {blocks.map((b, i) => {
        if (b.type === "image") return <figure key={i} className="lv-image">{b.caption ? <figcaption>{b.caption}</figcaption> : null}</figure>;
        const Tag = b.type === "heading" ? "h2" : b.type === "subheading" ? "h3" : b.type === "quote" ? "blockquote" : "p";
        const refs = (b.sourceRefs || []).map((r) => r.passageId);
        const verdict = b.fidelity?.verdict;
        return (
          <div key={i} className="lv-block" data-index={i + 1}>
            <Tag className={`lv-${b.type}`} dangerouslySetInnerHTML={{ __html: b.html || "" }} />
            {refs.length ? (
              <div className="block-chip-row">
                <span className={verdict === "unsupported" ? "block-chip is-lost" : verdict === "partial" ? "block-chip is-partial" : "block-chip"}>{refs.join(", ")}{verdict ? ` · ${verdict}` : ""}</span>
              </div>
            ) : b.ownView ? <div className="block-chip-row"><span className="block-chip is-lost">your view</span></div> : null}
          </div>
        );
      })}
    </div>
  );
}

export default function ReadingLevels({ story, viewLevel, onView, onChanged, dirty }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const own = normaliseAudience(story.provenance?.audience);
  const byAudience = new Map((story.levels || []).map((l) => [l.audience, l]));
  const bands = DRAFT_AUDIENCES.filter((a) => a.value !== own);
  const written = bands.filter((a) => byAudience.has(a.value));
  const current = viewLevel ? byAudience.get(viewLevel) : null;

  async function write(audiences) {
    setError("");
    setBusy(audiences ? audiences[0] : "all");
    const r = await generateStoryLevels(story.id, { audiences, baseVersion: story.version });
    setBusy("");
    if (!r.ok) { setError(r.error); return; }
    onChanged?.(r.data.story, `Written for ${r.data.written.length === 1 ? "one more reading age" : `${r.data.written.length} reading ages`}. Read each one before you approve it.`);
  }

  async function approve(audiences) {
    setError("");
    setBusy("approve");
    const r = await approveStoryLevels(story.id, { audiences, baseVersion: story.version });
    setBusy("");
    if (!r.ok) { setError(r.error); return; }
    onChanged?.(r.data.story, `${audiences.length === 1 ? "That level is" : "Those levels are"} live for readers.`);
  }

  return (
    <div className="lv-wrap">
      <div className="lv-bar" role="tablist" aria-label="Reading age">
        <span className="lv-label">Reading age</span>
        <button type="button" role="tab" aria-selected={!viewLevel} className={!viewLevel ? "lv-pill on" : "lv-pill"} onClick={() => onView(null)}>
          {DRAFT_AUDIENCES.find((a) => a.value === own)?.label || "Article"} <span className="lv-status is-source">Your article</span>
        </button>
        {bands.map((a) => {
          const l = byAudience.get(a.value);
          return (
            <button key={a.value} type="button" role="tab" aria-selected={viewLevel === a.value} className={viewLevel === a.value ? "lv-pill on" : "lv-pill"} disabled={!l} onClick={() => l && onView(a.value)} title={l ? `Reads at grade ${l.readability?.fkGrade ?? "?"}, target ${a.grade}` : "Not written yet"}>
              {a.label} <LevelStatus level={l} />
            </button>
          );
        })}
        {written.length < bands.length ? (
          <button type="button" className="sc-write-secondary st-btn" disabled={busy !== "" || dirty} onClick={() => write(null)} title={dirty ? "Save your edits first" : "Write the article for every other reading age from the passages it already cites"}>
            <FaWandMagicSparkles size={11} aria-hidden /> {busy === "all" ? "Writing…" : written.length ? "Write the rest" : "Write for every age"}
          </button>
        ) : null}
      </div>
      {error ? <p className="sc-write-msg is-error">{error}</p> : null}
      {dirty && written.length < bands.length ? <p className="st-muted">Save your edits before writing other levels, so they are written from the current text.</p> : null}

      {current ? (
        <div className="lv-preview">
          <div className="lv-head">
            <div>
              <span className="sc-kicker">{DRAFT_AUDIENCES.find((a) => a.value === current.audience)?.label || current.label} · target grade {current.grade}</span>
              <div className="st-todo-detail">
                Reads at grade {current.readability?.fkGrade ?? "?"} · {current.fidelity?.supported ?? 0} of {current.fidelity?.paragraphs ?? 0} rewritten paragraphs supported by the paper
                {current.stale ? ` · out of date: ${current.staleReason}` : current.approved ? ` · live since ${current.approvedAt ? new Date(current.approvedAt).toLocaleDateString() : "now"}` : " · not yet shown to readers"}
              </div>
            </div>
            <div className="lv-actions">
              <button type="button" className="sc-write-secondary st-btn" disabled={busy !== "" || dirty} onClick={() => write([current.audience])}><FaRotate size={10} aria-hidden /> {busy === current.audience ? "Rewriting…" : "Rewrite this level"}</button>
              {!current.approved && !current.stale ? (
                <button type="button" className="sc-write-publish st-btn-primary" disabled={busy !== "" || dirty} onClick={() => approve([current.audience])}><FaCheck size={11} aria-hidden /> {busy === "approve" ? "Approving…" : "Approve for readers"}</button>
              ) : null}
            </div>
          </div>
          {current.stale ? <p className="sc-write-msg is-error">This level was written from an earlier version of the article, so readers are not shown it. Rewrite it to bring it up to date.</p> : null}
          <LevelBlocks blocks={current.blocks || []} />
          <p className="st-muted">Every rewritten paragraph rests on the same passages as the paragraph it replaces, and was checked claim by claim. Headings, quotes and your own words are carried as they are.</p>
        </div>
      ) : null}
    </div>
  );
}
