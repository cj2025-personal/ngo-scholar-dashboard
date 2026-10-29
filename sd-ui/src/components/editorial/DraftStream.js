"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import KivynButton from "@/components/kivyn/KivynButton";

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

/* What the section being worked on is going through, in a word or two. */
const STEP_CHIP = {
  draft_blocks: "Writing…",
  judge_voice: "Reading whose voice it is in…",
  judge_fidelity: "Checking against the paper…",
  judge_reach: "Checking what it draws from the paper…",
  judge_context: "Checking what it claims…",
};

export default function DraftStream({ title = "", beats = [], sections = [], step = null }) {
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
  const current = beats.find((b) => !done.has(b.index))?.index ?? null;
  const share = beats.length ? Math.round((arrived / beats.length) * 100) : 0;
  /* The typed text, unit by unit, grouped under the section it belongs to. */
  let remaining = typed;
  const typedFor = new Map();
  for (const u of units) {
    const beatIndex = Number(u.key.split("-")[1]);
    if (remaining <= 0) break;
    const show = u.words.slice(0, remaining);
    const partial = show.length < u.words.length;
    remaining -= u.words.length;
    if (!typedFor.has(beatIndex)) typedFor.set(beatIndex, []);
    typedFor.get(beatIndex).push({ ...u, text: show.join(" "), partial });
  }
  const chipFor = (b) => {
    if (done.has(b.index)) {
      const s = sections.find((x) => x.index === b.index);
      const refs = [...new Set((s?.blocks || []).flatMap((bl) => (bl.sourceRefs || []).map((r) => r.passageId)).filter(Boolean))];
      return { cls: "is-done", text: refs.length ? `Checked against ${refs.slice(0, 3).join(", ")}` : "Written and checked" };
    }
    if (b.index === current) {
      const now = step && step.index === b.index ? STEP_CHIP[step.step] : null;
      return { cls: "is-now", text: now || "Writing…" };
    }
    return { cls: "is-waiting", text: "Waiting" };
  };
  return (
    <div className="ds-stream" aria-live="polite" aria-busy={!allIn}>
      <div className="ds-progress">
        <KivynButton pose={allIn ? "checking" : step?.step?.startsWith("judge") ? "checking" : "writing"} busy size={34} />
        <span className="ds-progress__text">{allIn ? "Every section written · reading the whole article as its reader would" : `Drafting · ${arrived} of ${beats.length} section${beats.length === 1 ? "" : "s"} done`}</span>
        <span className="ds-progress__bar" aria-hidden><i style={{ width: `${share}%` }} /></span>
        <span className="ds-progress__note">Read-only until the draft lands</span>
      </div>
      {title ? <h1 className="ds-title">{title}</h1> : null}
      {beats.map((b) => {
        const chip = chipFor(b);
        const typedUnits = (typedFor.get(b.index) || []).filter((u) => u.kind !== "subheading");
        return (
          <section key={b.index} className={`ds-section ${chip.cls}`}>
            <div className="ds-section__head">
              <h2 className="ds-heading">{b.heading}</h2>
              <span className={`ds-chip ${chip.cls}`}>{chip.text}</span>
            </div>
            {typedUnits.map((u) => {
              const Tag = u.kind === "quote" ? "blockquote" : "p";
              return (
                <Tag key={u.key} className={`ds-${u.kind}${u.partial ? " is-typing" : ""}`}>
                  {u.text}{u.partial ? <span className="ds-caret" aria-hidden /> : null}
                </Tag>
              );
            })}
            {b.index === current && !typedUnits.length ? (
              <div className="ds-skeleton" aria-hidden><i /><i /><i /></div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
