"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import Kivyn from "@/components/kivyn/Kivyn";

/**
 * The draft being written, on the page, as it is written.
 *
 * The drafter works section by section on the server and sends each one
 * the moment it stands. Here each arrives and is typed onto the page, word
 * by word, in order, with the sections still to come named underneath, so
 * the scholar watches the article take shape rather than staring at "Drafting…"
 * and receiving it whole. What is typed is the section's own text; nothing
 * is invented for the animation, and when the finished draft lands it takes
 * the page over exactly as before.
 *
 * @param {object} p
 * @param {string} [p.title]
 * @param {{index:number, heading:string}[]} p.beats   the approved outline, in order
 * @param {{index:number, heading:string, blocks:{type:string, html:string}[]}[]} p.sections   the ones written so far
 */

const WORDS_PER_TICK = 2;
const TICK_MS = 45;

function plain(html) {
  return String(html || "").replace(/<[^>]+>/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
}

export default function DraftStream({ title = "", beats = [], sections = [] }) {
  /* Every unit of text to type, in the order it should appear. */
  const units = useMemo(() => {
    const out = [];
    const byIndex = new Map(sections.map((s) => [s.index, s]));
    for (const beat of beats) {
      const s = byIndex.get(beat.index);
      if (!s) break; // typed in order: nothing after a gap
      out.push({ key: `h-${beat.index}`, kind: "subheading", words: plain(beat.heading).split(" ") });
      s.blocks.forEach((b, i) => out.push({ key: `b-${beat.index}-${i}`, kind: b.type || "paragraph", words: plain(b.html).split(" ").filter(Boolean) }));
    }
    return out;
  }, [beats, sections]);
  const totalWords = units.reduce((n, u) => n + u.words.length, 0);

  const [typed, setTyped] = useState(0);
  const typedRef = useRef(0);
  useEffect(() => {
    if (typedRef.current >= totalWords) return undefined;
    const t = setInterval(() => {
      typedRef.current = Math.min(totalWords, typedRef.current + WORDS_PER_TICK);
      setTyped(typedRef.current);
      if (typedRef.current >= totalWords) clearInterval(t);
    }, TICK_MS);
    return () => clearInterval(t);
  }, [totalWords]);

  const done = new Set(sections.map((s) => s.index));
  const arrived = beats.filter((b) => done.has(b.index)).length;
  /* Writing while sections are still to come; once every one is in, the draft is being checked. */
  const allIn = arrived >= beats.length;
  let remaining = typed;
  return (
    <div className="ds-stream" aria-live="polite" aria-busy={arrived < beats.length}>
      {title ? <h1 className="ds-title">{title}</h1> : null}
      <p className="ds-status"><Kivyn pose={allIn ? "checking" : "writing"} size={40} live /> {allIn ? "Every section written · checking it against the paper and assembling the draft…" : `Writing section ${Math.min(arrived + 1, beats.length)} of ${beats.length}${arrived ? ` · ${arrived} written` : ""}`}</p>
      {units.map((u) => {
        if (remaining <= 0) return null;
        const show = u.words.slice(0, remaining);
        const partial = show.length < u.words.length;
        remaining -= u.words.length;
        const text = show.join(" ");
        const Tag = u.kind === "subheading" ? "h2" : u.kind === "quote" ? "blockquote" : "p";
        return (
          <Tag key={u.key} className={`ds-${u.kind === "subheading" ? "heading" : u.kind}${partial ? " is-typing" : ""}`}>
            {text}{partial ? <span className="ds-caret" aria-hidden /> : null}
          </Tag>
        );
      })}
      <ol className="ds-coming">
        {beats.filter((b) => !done.has(b.index)).map((b) => (
          <li key={b.index} className="ds-coming-item"><span className="st-dot is-navy" aria-hidden /> {b.heading}<span className="ds-coming-note">{b.index === beats.find((x) => !done.has(x.index))?.index ? " · being written" : ""}</span></li>
        ))}
      </ol>
    </div>
  );
}
