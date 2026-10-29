"use client";

import { useEffect, useState } from "react";

import { DRAFT_AUDIENCES, getPublicStoryPassages, publicEvidenceUrl } from "@/lib/drafting";
import { normaliseAudience } from "@/lib/readability";
import ReaderCompanion from "./ReaderCompanion";

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
  /* The paragraph the reader last touched, numbered the way the companion
     numbers text blocks: images skipped, 1-based. */
  const [focus, setFocus] = useState(null);
  const levels = Array.isArray(story?.levels) ? story.levels : [];
  const own = normaliseAudience(story?.provenance?.audience);
  const shown = level ? levels.find((l) => l.audience === level) : null;
  const blocks = shown ? shown.blocks : story?.bodyBlocks || [];
  const drafted = blocks.some((b) => Array.isArray(b.sourceRefs) && b.sourceRefs.length);
  const alerts = story?.record?.alerts || [];
  /* Text-block numbers, in the companion's terms, for every block index. */
  const textIndex = [];
  let textCount = 0;
  for (const b of blocks) textIndex.push(b.type === "image" ? null : ++textCount);
  const plainText = (html) => String(html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  /* The same blocks as the companion sees them, for its Ask and Sources tabs. */
  const companionBlocks = blocks.map((b, i) => (textIndex[i] ? { id: `b${textIndex[i]}`, index: textIndex[i], type: b.type, text: plainText(b.html), passageIds: Array.isArray(b.sourceRefs) ? b.sourceRefs.map((r) => r.passageId) : [] } : null)).filter(Boolean);

  /* What the reader has done on this page, for the companion's checklist.
     Which paragraphs have been on screen, whether a passage was opened,
     whether another reading age was tried. This browser only. */
  const progressKey = `sd:progress:${story?.slug || ""}`;
  const [readSet, setReadSet] = useState(() => {
    try { return new Set(JSON.parse(window.localStorage.getItem(progressKey) || "{}").read || []); } catch { return new Set(); }
  });
  const [marks, setMarks] = useState(() => {
    try { return JSON.parse(window.localStorage.getItem(progressKey) || "{}").marks || {}; } catch { return {}; }
  });
  useEffect(() => {
    try { window.localStorage.setItem(progressKey, JSON.stringify({ read: [...readSet], marks })); } catch { /* private mode: it lives for this page only */ }
  }, [progressKey, readSet, marks]);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return undefined;
    const els = Array.from(document.querySelectorAll(".reader-block[id^='rb-b']"));
    const io = new IntersectionObserver((entries) => {
      const hits = entries.filter((e) => e.isIntersecting).map((e) => Number(e.target.id.replace("rb-b", "")));
      if (!hits.length) return;
      setReadSet((prev) => {
        if (hits.every((n) => prev.has(n))) return prev;
        const next = new Set(prev);
        hits.forEach((n) => next.add(n));
        return next;
      });
    }, { threshold: 0.6 });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [blocks.length, level]);
  const mark = (key) => setMarks((m) => (m[key] ? m : { ...m, [key]: true }));

  /* A citation from the companion: scroll to the paragraph; for a passage of
     the paper, also turn the sources on and open that passage under the
     paragraph, the same popover the source mark opens. */
  function jumpTo({ blockId, passageId = null }) {
    const m = /^b(\d+)$/.exec(blockId || "");
    if (!m) return;
    const n = Number(m[1]);
    const el = document.getElementById(`rb-b${n}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("is-cited");
    setTimeout(() => el.classList.remove("is-cited"), 1800);
    if (passageId) {
      const index = textIndex.indexOf(n);
      if (index >= 0) {
        setShowSources(true);
        setOpen({ index, ids: [passageId] });
        mark("source");
      }
    }
  }

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
      {/* The reading controls, in one row between rules: who it is read
          for, and whether its sources show. */}
      {levels.length || drafted ? (
        <div className="reader-controls">
          {levels.length ? (
            <div className="reader-levels" role="tablist" aria-label="Reading age">
              <span className="reader-levels-label">Read this for</span>
              <button type="button" role="tab" aria-selected={!level} className={!level ? "reader-level on" : "reader-level"} onClick={() => { setLevel(null); setOpen(null); }}>{DRAFT_AUDIENCES.find((a) => a.value === own)?.label || "Adults"}</button>
              {levels.map((l) => (
                <button key={l.audience} type="button" role="tab" aria-selected={level === l.audience} className={level === l.audience ? "reader-level on" : "reader-level"} onClick={() => { setLevel(l.audience); setOpen(null); mark("level"); }}>{DRAFT_AUDIENCES.find((a) => a.value === l.audience)?.label || l.label}</button>
              ))}
            </div>
          ) : null}
          {drafted ? (
            <div className="reader-tools">
              <button type="button" className={showSources ? "reader-toggle on" : "reader-toggle"} aria-pressed={showSources} onClick={() => { setShowSources((v) => !v); setOpen(null); if (!showSources) mark("source"); }}>
                <span className="reader-sw" aria-hidden /> Show sources
              </button>
            </div>
          ) : null}
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
          const n = textIndex[index];
          const focused = focus?.index === n;
          return (
            <div key={`b-${index}`} id={n ? `rb-b${n}` : undefined} className={`reader-block${marked ? " is-marked" : ""}${focused ? " is-focus" : ""}`}>
              {/* A tap on a paragraph tells the companion which one the
                  reader means, and nothing else; there is no other selection
                  a public page could sensibly offer a child. */}
              <Tag className={cls} dangerouslySetInnerHTML={{ __html: block.html || "" }} onClick={n && Tag === "p" ? () => setFocus(focused ? null : { index: n, text: plainText(block.html).slice(0, 140) }) : undefined} />
              {marked ? (
                ids.length && block.traceable !== false ? (
                  <button type="button" className={`reader-srcmark${block.extension ? " is-reach" : ""}${open?.index === index ? " on" : ""}`} title={block.extension ? "Goes beyond the paper: what follows from these passages" : "From the paper"} onClick={() => setOpen(open?.index === index ? null : { index, ids })} aria-expanded={open?.index === index}>
                    {block.extension ? "↗ " : ""}{ids.join(", ")}
                  </button>
                ) : (
                  <span className="reader-srcmark is-author" title={block.context ? "The author's own context — not drawn from the paper; its particulars verified by the author" : block.ownView ? "The author's own view" : "Written by the author"}>author</span>
                )
              ) : null}
              {marked && open?.index === index ? (
                <div className="reader-pop">
                  <div className="reader-pop-head"><span className="sc-kicker">{block.extension ? "Builds on the paper" : "From the paper"} · {open.ids.join(", ")}</span><button type="button" className="reader-pop-close" aria-label="Close" onClick={() => setOpen(null)}>×</button></div>
                  {block.extension ? <p className="reader-pop-note">This paragraph says what follows from the paper for you, the reader. It was checked, claim by claim, to follow from the passages below and to add nothing from outside the paper.</p> : null}
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
                  ) : block.extension && block.reach?.claims?.length ? (
                    <div className="reader-pop-claims">
                      <b>What this paragraph draws from the paper</b>
                      <ul>
                        {block.reach.claims.map((c, k) => <li key={k} className={c.verdict === "follows" ? "" : "is-bad"}>{c.text}{c.verdict === "follows" ? ` — follows from ${(c.anchorIds || []).join(", ")}` : " — goes beyond the paper"}</li>)}
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
          {/* The sentence comes from the ledger, which knows that a claim
              beyond the paper is judged "follows" and can never be counted
              "supported". Counting it as neither made the footer report
              failures the article did not have. */}
          <b>On the record.</b> {story.evidence.summary || "Every paragraph drawn from the paper was checked against it."}{" "}
          {story.evidence.signed ? "The full record is signed by the publisher and approved by the author." : "The full record is published with the article."}{" "}
          {story?.slug ? <a href={publicEvidenceUrl(story.slug)} target="_blank" rel="noreferrer noopener">Verify it</a> : null}
        </footer>
      ) : null}
      {story?.slug ? <ReaderCompanion slug={story.slug} level={level} levelsAvailable={levels.length > 0} blocks={companionBlocks} readSet={readSet} marks={marks} focus={focus} onCite={jumpTo} /> : null}
    </>
  );
}
