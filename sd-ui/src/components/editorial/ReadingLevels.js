"use client";

import { useMemo, useState } from "react";
import { FaCheck, FaRotate, FaWandMagicSparkles } from "react-icons/fa6";

import DiscardLevelsButton from "@/components/editorial/DiscardLevelsButton";
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
 *
 * The bands are chosen together and acted on together: tick the ages, then
 * write them or approve them in one go. Each is still written on its own,
 * judged on its own, and stands or falls on its own — the selection is a
 * convenience, not a batch. The selection starts as whatever needs doing:
 * the bands not yet written, or out of date.
 */

function LevelStatus({ level }) {
  if (!level) return <span className="lv-status is-none">Not written</span>;
  if (level.stale) return <span className="lv-status is-stale">Out of date</span>;
  if (level.approved) return <span className="lv-status is-live">Live for readers</span>;
  return <span className="lv-status is-ready">Ready to review</span>;
}

function chipFor(b) {
  const refs = (b.sourceRefs || []).map((r) => r.passageId);
  if (!refs.length) return null;
  if (b.extension) {
    const v = b.reach?.verdict;
    return { className: v === "overreach" ? "block-chip is-lost" : v === "partial" ? "block-chip is-partial" : "block-chip is-reach", text: `${refs.join(", ")}${v ? ` · ${v === "follows" ? "follows from the paper" : v === "partial" ? "partly follows" : "goes beyond"}` : ""}` };
  }
  const v = b.fidelity?.verdict;
  return { className: v === "unsupported" ? "block-chip is-lost" : v === "partial" ? "block-chip is-partial" : "block-chip", text: `${refs.join(", ")}${v ? ` · ${v}` : ""}` };
}

function LevelBlocks({ blocks }) {
  return (
    <div className="lv-blocks">
      {blocks.map((b, i) => {
        if (b.type === "image") return <figure key={i} className="lv-image">{b.caption ? <figcaption>{b.caption}</figcaption> : null}</figure>;
        const Tag = b.type === "heading" ? "h2" : b.type === "subheading" ? "h3" : b.type === "quote" ? "blockquote" : "p";
        const chip = chipFor(b);
        return (
          <div key={i} className="lv-block" data-index={i + 1}>
            <Tag className={`lv-${b.type}`} dangerouslySetInnerHTML={{ __html: b.html || "" }} />
            {chip ? (
              <div className="block-chip-row"><span className={chip.className}>{chip.text}</span></div>
            ) : b.ownView ? <div className="block-chip-row"><span className={b.context ? "block-chip is-context" : "block-chip is-lost"}>{b.context ? "your own context" : "your view"}</span></div> : null}
          </div>
        );
      })}
    </div>
  );
}

/** What needs doing for a band: written for the first time, or written again. */
function needsWriting(level) {
  return !level || level.stale;
}

export default function ReadingLevels({ story, viewLevel, onView, onChanged, dirty }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const own = normaliseAudience(story.provenance?.audience);
  const byAudience = useMemo(() => new Map((story.levels || []).map((l) => [l.audience, l])), [story.levels]);
  const bands = DRAFT_AUDIENCES.filter((a) => a.value !== own);
  const current = viewLevel ? byAudience.get(viewLevel) : null;

  /* The selection: what the scholar ticked, or, until they touch it, what
     needs doing — and every band once nothing does, so "write again" and
     "approve all" are one click each. */
  const [picked, setPicked] = useState(null);
  const [open, setOpen] = useState(false);
  const pending = bands.filter((a) => needsWriting(byAudience.get(a.value))).map((a) => a.value);
  const selected = picked || (pending.length ? pending : bands.map((a) => a.value));
  const toggle = (value) => setPicked((selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]));
  const everyBand = selected.length === bands.length;
  const ready = selected.filter((v) => { const l = byAudience.get(v); return l && !l.approved && !l.stale; });

  async function write(audiences) {
    setError("");
    setBusy(audiences && audiences.length === 1 ? audiences[0] : "write");
    const r = await generateStoryLevels(story.id, { audiences, baseVersion: story.version });
    setBusy("");
    if (!r.ok) { setError(r.error); return; }
    setPicked(null);
    onChanged?.(r.data.story, `Written for ${r.data.written.length === 1 ? "one more reading age" : `${r.data.written.length} reading ages`}. Read each one before you approve it.`);
  }

  async function approve(audiences) {
    setError("");
    setBusy("approve");
    const r = await approveStoryLevels(story.id, { audiences, baseVersion: story.version });
    setBusy("");
    if (!r.ok) { setError(r.error); return; }
    setPicked(null);
    onChanged?.(r.data.story, `${audiences.length === 1 ? "That level is" : "Those levels are"} live for readers.`);
  }

  const writeLabel = busy === "write" ? "Writing…" : everyBand ? "Write for every age" : selected.length ? `Write ${selected.length} selected` : "Write selected";
  /* A story with no paper behind it is rewritten from its own paragraphs, so
     the tooltip must not promise passages that do not exist. */
  const selfGrounded = !story.provenance;
  const writeTitle = dirty
    ? "Save your edits first"
    : selfGrounded
    ? "Write the article for the ticked reading ages, each from your own paragraphs and judged against them"
    : "Write the article for the ticked reading ages, each from the passages it already cites and judged on its own";

  /* Before any level exists this bar is two rows of controls the scholar will
     use once, at the end, sitting above the cover image and the title — about
     ninety pixels of a laptop screen spent on the last job, at the moment
     they opened the draft to read it. Folded until it has something to say. */
  const nothingWritten = bands.every((a) => !byAudience.get(a.value));
  if (nothingWritten && !open) {
    return (
      <div className="lv-wrap is-folded">
        <button type="button" className="lv-fold" onClick={() => setOpen(true)} aria-expanded="false">
          <FaWandMagicSparkles size={11} aria-hidden />
          Also write this for other reading ages
          <span className="lv-fold__hint">{bands.map((a) => a.label).join(" · ")}</span>
        </button>
      </div>
    );
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
        <div className="lv-write" role="group" aria-label="Write or approve reading ages">
          <span className="lv-write-label">For</span>
          {bands.map((a) => (
            <label key={a.value} className="lv-check">
              <input type="checkbox" checked={selected.includes(a.value)} disabled={busy !== ""} onChange={() => toggle(a.value)} />
              <span>{a.label}</span>
            </label>
          ))}
          <button type="button" className="sc-write-secondary st-btn" disabled={busy !== "" || dirty || selected.length === 0} onClick={() => write(everyBand ? null : selected)} title={writeTitle}>
            <FaWandMagicSparkles size={11} aria-hidden /> {writeLabel}
          </button>
          {ready.length ? (
            <button type="button" className="sc-write-publish st-btn-primary" disabled={busy !== "" || dirty} onClick={() => approve(ready)} title="Make the ticked levels that are ready live for readers">
              <FaCheck size={11} aria-hidden /> {busy === "approve" ? "Approving…" : `Approve ${ready.length === selected.length && ready.length > 1 ? "all" : ready.length} for readers`}
            </button>
          ) : null}
        </div>
      </div>
      {error ? <p className="sc-write-msg is-error">{error}</p> : null}
      {dirty && selected.length ? <p className="st-muted">Save your edits before writing other levels, so they are written from the current text.</p> : null}

      {current ? (
        <div className="lv-preview">
          <div className="lv-head">
            <div>
              <span className="sc-kicker">{DRAFT_AUDIENCES.find((a) => a.value === current.audience)?.label || current.label} · target grade {current.grade}</span>
              <div className="st-todo-detail">
                Reads at grade {current.readability?.fkGrade ?? "?"} · {current.fidelity?.supported ?? 0} of {current.fidelity?.paragraphs ?? 0} rewritten paragraphs{" "}
                {current.grounding === "self" ? "kept to what you wrote" : "supported by the paper"}
                {current.reach?.paragraphs ? ` · ${current.reach.follows} of ${current.reach.paragraphs} beyond the paper follow${current.reach.follows === 1 ? "s" : ""} from it` : ""}
                {current.stale ? ` · out of date: ${current.staleReason}` : current.approved ? ` · live since ${current.approvedAt ? new Date(current.approvedAt).toLocaleDateString() : "now"}` : " · not yet shown to readers"}
              </div>
            </div>
            <div className="lv-actions">
              <button type="button" className="sc-write-secondary st-btn" disabled={busy !== "" || dirty} onClick={() => write([current.audience])}><FaRotate size={10} aria-hidden /> {busy === current.audience ? "Rewriting…" : "Rewrite this level"}</button>
              {!current.approved && !current.stale ? (
                <button type="button" className="sc-write-publish st-btn-primary" disabled={busy !== "" || dirty} onClick={() => approve([current.audience])}><FaCheck size={11} aria-hidden /> {busy === "approve" ? "Approving…" : "Approve for readers"}</button>
              ) : null}
              {/* Written, and not wanted. Without this a level could only be
                  rewritten or approved, so an unwanted one asked forever. */}
              <DiscardLevelsButton
                storyId={story.id}
                audiences={[current.audience]}
                count={1}
                live={Boolean(current.approved)}
                label="Discard this level"
                onDone={(data) => { onView?.(null); onChanged?.(data.story, `The ${(DRAFT_AUDIENCES.find((a) => a.value === current.audience)?.label || "reading").toLowerCase()} level is gone.${current.approved ? " Readers no longer see it." : ""} You can write it again whenever you like.`); }}
              />
            </div>
          </div>
          {current.stale ? <p className="sc-write-msg is-error">This level was written from an earlier version of the article, so readers are not shown it. Rewrite it to bring it up to date.</p> : null}
          <LevelBlocks blocks={current.blocks || []} />
          <p className="st-muted">Every rewritten paragraph rests on the same passages as the paragraph it replaces, and was checked claim by claim; a paragraph that goes beyond the paper keeps its implications and is checked to still follow from it. Headings, quotes and your own words are carried as they are.</p>
        </div>
      ) : null}
    </div>
  );
}
