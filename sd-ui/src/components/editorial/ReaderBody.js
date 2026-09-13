"use client";

import { useEffect, useState } from "react";

import { getPublicStoryPassages } from "@/lib/drafting";

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

export default function ReaderBody({ story }) {
  const [showSources, setShowSources] = useState(false);
  const [passages, setPassages] = useState(null);
  const [open, setOpen] = useState(null); // { index, ids }
  const drafted = (story?.bodyBlocks || []).some((b) => Array.isArray(b.sourceRefs) && b.sourceRefs.length);

  useEffect(() => {
    if (!showSources || passages || !story?.slug) return;
    getPublicStoryPassages(story.slug).then((r) => setPassages(r.ok ? r.data.passages : []));
  }, [showSources, passages, story?.slug]);

  const byId = new Map((passages || []).map((p) => [p.id, p]));

  return (
    <>
      {drafted ? (
        <div className="reader-tools">
          <button type="button" className={showSources ? "reader-toggle on" : "reader-toggle"} aria-pressed={showSources} onClick={() => { setShowSources((v) => !v); setOpen(null); }}>
            <span className="reader-sw" aria-hidden /> Show sources
          </button>
        </div>
      ) : null}
      <div className="public-story-body">
        {(story?.bodyBlocks || []).map((block, index) => {
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
                  {!passages ? <p className="st-muted">Loading…</p> : open.ids.map((id) => (
                    <div key={id} className="reader-pop-passage"><b>{id}</b><p>{byId.get(id)?.text || "This passage is no longer available."}</p></div>
                  ))}
                  {story?.provenance?.url ? <a href={story.provenance.url} target="_blank" rel="noreferrer noopener" className="reader-pop-link">Open in the paper</a> : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </>
  );
}
