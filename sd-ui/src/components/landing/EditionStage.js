"use client";

import { useState } from "react";

import Kivyn from "@/components/kivyn/Kivyn";
import { BRAND_NAME, PRODUCT_NAME } from "@/lib/brand";


/* The page of the paper: its lines, three of them the passages Kivyn marks. */
const PAPER_LINES = [92, 100, 84, 96, 100, 72, 94, 100, 64];
const PASSAGES = { 1: 1, 4: 2, 7: 3 };
/* The article's lines, and which passage each marked one rests on. */
const ARTICLE_LINES = [100, 88, 96, 100, 78, 60];
const MARKS = { 0: 1, 2: 2, 4: 3 };

/**
 * The opening: the page's headline beside a picture of the product at work.
 * (The moving edition titles that once ran above it were removed at review on
 * 2026-11-18; the picture now chooses its own edition.)
 *
 * The picture plays what the studio does, on a loop: the scholar's paper
 * opens, its passages are marked, and Kivyn writes an edition beside it, each
 * line carrying the number of the passage it rests on, until it is approved.
 * Each run writes the next reading age in the table, youngest first. Lines
 * are bars, not invented words: the picture shows the shape of the work, as
 * the public site's product pictures do. It holds still under the pointer;
 * with reduced motion it is the first age's last frame, still.
 *
 * @param {object} p
 * @param {{key:string,label:string,kind:string,age?:string,tone:string,kicker:string,title:string,by:string,grade?:number}[]} p.editions
 *   the paper, then one per reading age (built from the reading-age table)
 * @param {import("react").ReactNode} p.children   the headline, beside the picture
 */
export default function EditionStage({ editions, children }) {
  const paper = editions[0];
  const ages = editions.slice(1);
  const [at, setAt] = useState(0);
  const edition = ages[at] || paper;
  const writes = edition.key !== paper.key;

  /* The next reading age at the end of each run, told by the picture's own
     loop (the cover's opening): it holds with the picture under the pointer,
     and with reduced motion there is no loop, so no change. */
  const onLoop = (event) => {
    if (event.animationName === "pr-sim-open" && ages.length > 1) setAt((n) => (n + 1) % ages.length);
  };

  const label = writes
    ? `Your paper opens, its passages are marked, and Kivyn writes the edition for ${edition.label.toLowerCase()} (${edition.age}) from it, every line numbered with the passage it rests on, until you approve it.`
    : "Your paper, the original, open at the passages Kivyn marks.";

  return (
    <div className="pr-hero">
      <div className="pr-wrap pr-hero__grid">
        <div className="pr-hero__copy">{children}</div>

        <div className="pr-stage">
          {/* Keyed by the edition, so each new one plays from the start. */}
          <div key={edition.key} className={writes ? "pr-sim" : "pr-sim is-paper"} role="img" aria-label={label} onAnimationIteration={onLoop}>
            <div className="pr-sim__scene">
              <div className="pr-sim__book">
                <div className="pr-sim__page">
                  <span className="pr-sim__mini">{paper.title}</span>
                  {PAPER_LINES.map((w, i) => (
                    <span key={i} className="pr-sim__pl" style={{ width: `${w}%` }}>
                      {PASSAGES[i] ? (
                        <>
                          <span className={`pr-sim__hl pr-sim__hl--${PASSAGES[i]}`} />
                          <span className={`pr-sim__num pr-sim__num--p${PASSAGES[i]}`}>{PASSAGES[i]}</span>
                        </>
                      ) : null}
                    </span>
                  ))}
                </div>
                <div className="pr-sim__cover">
                  <div className="pr-sim__face pr-sim__face--front">
                    <span className="pr-sim__k">{paper.kicker}</span>
                    <span className="pr-sim__band" />
                    <span className="pr-sim__t">{paper.title}</span>
                    <span className="pr-sim__k pr-sim__by">{paper.by}</span>
                    <span className="pr-sim__foot">
                      {BRAND_NAME}
                      <br />
                      {PRODUCT_NAME}
                    </span>
                  </div>
                  {/* Open, the cover's inside is the spread's left page. */}
                  <div className="pr-sim__face pr-sim__face--back">
                    {PAPER_LINES.slice(0, 8).map((w, i) => (
                      <span key={i} className="pr-sim__pl" style={{ width: `${100 - (w % 23)}%` }} />
                    ))}
                  </div>
                </div>
              </div>

              {writes ? (
                <div className={`pr-sim__art ${edition.tone}`}>
                  <span className="pr-sim__art-band" />
                  <span className="pr-sim__k pr-sim__art-k">{edition.kicker}</span>
                  <span className="pr-sim__art-t">{edition.title}</span>
                  <span className="pr-sim__k pr-sim__art-by">Written to grade {edition.grade}</span>
                  <span className="pr-sim__lines">
                    {ARTICLE_LINES.map((w, i) => (
                      <span key={i} className={`pr-sim__al pr-sim__al--${i + 1}`} style={{ width: `${w}%` }}>
                        {MARKS[i] ? <span className={`pr-sim__mark pr-sim__mark--${i + 1}`}>{MARKS[i]}</span> : null}
                      </span>
                    ))}
                  </span>
                  <span className="pr-sim__stamp">✓ Approved by you</span>
                </div>
              ) : null}

              <span className="pr-sim__kv">
                <Kivyn pose="reading" size={52} className="pr-sim__kv-1" />
                {writes ? <Kivyn pose="writing" size={52} className="pr-sim__kv-2" /> : null}
                {writes ? <Kivyn pose="done" size={52} className="pr-sim__kv-3" /> : null}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
