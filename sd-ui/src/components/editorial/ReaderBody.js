"use client";

import { useEffect, useState } from "react";

import { DRAFT_AUDIENCES, getPublicStoryPassages, publicEvidenceUrl } from "@/lib/drafting";
import { normaliseAudience } from "@/lib/readability";

/**
 * The article body with a Sources toggle.
 *
 * Off, it is the article. On, every paragraph drawn from the paper carries
 * the passages it came from, and a click opens them in the paper's own
 * words. This is the student's side of provenance: not "trust us", but
 * "see for yourself".
 */

function buildPublicImageUrl(url) {
  if (!url) return "";
  const apiBase = process.env.NEXT_PUBLIC_AUTH_API_URL || "http://localhost:4000";
  if (url.startsWith("http")) return url;
  return `${apiBase}${url.replace("/api/editorial-stories/images/", "/api/editorial-stories/public/images/")}`;
}

/** Sentences of a passage, with the ones a claim rests on marked. */
function withEvidence(text, evidences) {
  const ev = (evidences || []).map((e) => String(e || "").toLowerCase().replace(/\s+/g, " ").trim()).filter(Boolean);
  return String(text || "").split(/(?<=[.!?])\s+/).map((sentence) => {
    const norm = sentence.toLowerCase().replace(/\s+/g, " ").trim();
    const hit = ev.some((e) => norm.includes(e) || e.includes(norm));
    return { sentence, hit };
  });
}

export default function ReaderBody({ story }) {
  const [showSources, setShowSources] = useState(false);
  const [passages, setPassages] = useState(null);
  const [open, setOpen] = useState(null); // { index, ids }
  const [level, setLevel] = useState(null);
  const levels = Array.isArray(story?.levels) ? story.levels : [];
  const own = normaliseAudience(story?.provenance?.audience);
  const shown = level ? levels.find((l) => l.audience === level) : null;
  const blocks = shown ? shown.blocks : story?.bodyBlocks || [];
  const drafted = blocks.some((b) => Array.isArray(b.sourceRefs) && b.sourceRefs.length);
  const alerts = story?.record?.alerts || [];

  useEffect(() => {
    if (!showSources || passages || !story?.slug) return;
    getPublicStoryPassages(story.slug).then((r) => setPassages(r.ok ? r.data.passages : []));
  }, [showSources, passages, story?.slug]);

  const byId = new Map((passages || []).map((p) => [p.id, p]));

  return (
    <>
      {alerts.length ? (
        <div className="reader-notice" role="alert">
          <b>A note on the source.</b> {story.record.headline}{" "}
          {alerts[0].noticeUrl ? <a href={alerts[0].noticeUrl} target="_blank" rel="noreferrer noopener">Read the notice</a> : null}
        </div>
      ) : null}
      {levels.length ? (
        <div className="reader-levels" role="tablist" aria-label="Reading age">
          <span className="reader-levels-label">Read this for</span>
          <button type="button" role="tab" aria-selected={!level} className={!level ? "reader-level on" : "reader-level"} onClick={() => { setLevel(null); setOpen(null); }}>{DRAFT_AUDIENCES.find((a) => a.value === own)?.label || "Adults"}</button>
          {levels.map((l) => (
            <button key={l.audience} type="button" role="tab" aria-selected={level === l.audience} className={level === l.audience ? "reader-level on" : "reader-level"} onClick={() => { setLevel(l.audience); setOpen(null); }}>{DRAFT_AUDIENCES.find((a) => a.value === l.audience)?.label || l.label}</button>
          ))}
        </div>
      ) : null}
      {drafted ? (
        <div className="reader-tools">
          <button type="button" className={showSources ? "reader-toggle on" : "reader-toggle"} aria-pressed={showSources} onClick={() => { setShowSources((v) => !v); setOpen(null); }}>
            <span className="reader-sw" aria-hidden /> Show sources
          </button>
        </div>
      ) : null}
      <div className="public-story-body">
        {blocks.map((block, index) => {
          if (block.type === "image") {
            return (
              <figure key={`img-${index}`} className={`reader-image-block reader-image-width-${block.width || "body"}`}>
                <img src={buildPublicImageUrl(block.url)} alt={block.alt || block.filename || "Story image"} className="reader-inline-image" />
                {block.caption ? <figcaption>{block.caption}</figcaption> : null}
              </figure>
            );
          }
          const Tag = block.type === "heading" ? "h2" : block.type === "subheading" ? "h3" : block.type === "quote" ? "blockquote" : "p";
          const cls = block.type === "heading" ? "reader-heading" : block.type === "subheading" ? "reader-subheading" : block.type === "quote" ? "reader-quote" : "reader-paragraph";
          const ids = Array.isArray(block.sourceRefs) ? block.sourceRefs.map((r) => r.passageId) : [];
          const marked = showSources && Tag === "p";
          return (
            <div key={`b-${index}`} className={marked ? "reader-block is-marked" : "reader-block"}>
              <Tag className={cls} dangerouslySetInnerHTML={{ __html: block.html || "" }} />
              {marked ? (
                ids.length && block.traceable !== false ? (
                  <button type="button" className={open?.index === index ? "reader-srcmark on" : "reader-srcmark"} onClick={() => setOpen(open?.index === index ? null : { index, ids })} aria-expanded={open?.index === index}>
                    {ids.join(", ")}
                  </button>
                ) : (
                  <span className="reader-srcmark is-author" title={block.ownView ? "The author's own view" : "Written by the author"}>author</span>
                )
              ) : null}
              {marked && open?.index === index ? (
                <div className="reader-pop">
                  <div className="reader-pop-head"><span className="sc-kicker">From the paper · {open.ids.join(", ")}</span><button type="button" className="reader-pop-close" aria-label="Close" onClick={() => setOpen(null)}>×</button></div>
                  {!passages ? <p className="st-muted">Loading…</p> : open.ids.map((id) => {
                    const claims = (block.fidelity?.claims || []).filter((c) => c.verdict === "supported" && (c.passageIds || []).includes(id));
                    const marked = withEvidence(byId.get(id)?.text, claims.map((c) => c.evidence));
                    return (
                      <div key={id} className="reader-pop-passage">
                        <b>{id}</b>
                        <p>{byId.get(id) ? marked.map((m, k) => (m.hit ? <mark key={k}>{m.sentence} </mark> : <span key={k}>{m.sentence} </span>)) : "This passage is no longer available."}</p>
                      </div>
                    );
                  })}
                  {block.fidelity?.claims?.length ? (
                    <div className="reader-pop-claims">
                      <b>What this paragraph claims</b>
                      <ul>
                        {block.fidelity.claims.map((c, k) => <li key={k} className={c.verdict === "supported" ? "" : "is-bad"}>{c.text}{c.verdict === "supported" ? "" : " — not found in the paper"}</li>)}
                      </ul>
                    </div>
                  ) : null}
                  {story?.provenance?.url ? <a href={story.provenance.url} target="_blank" rel="noreferrer noopener" className="reader-pop-link">Open in the paper</a> : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {story?.evidence?.signed || story?.evidence?.totals ? (
        <footer className="reader-evidence">
          <b>On the record.</b> {story.evidence.totals?.claims ? `${story.evidence.totals.claims} claim${story.evidence.totals.claims === 1 ? "" : "s"} in this article ${story.evidence.totals.claims === 1 ? "was" : "were"} checked against the paper, ${story.evidence.totals.supported} supported.` : "Every paragraph drawn from the paper was checked against it."}{" "}
          {story.evidence.signed ? "The full record is signed by the publisher and approved by the author." : "The full record is published with the article."}{" "}
          {story?.slug ? <a href={publicEvidenceUrl(story.slug)} target="_blank" rel="noreferrer noopener">Verify it</a> : null}
        </footer>
      ) : null}
    </>
  );
}
