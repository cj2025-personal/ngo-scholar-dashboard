"use client";

import { useState } from "react";

import Kivyn from "@/components/kivyn/Kivyn";
import { BRAND_NAME, PRODUCT_NAME } from "@/lib/brand";

/**
 * The opening: the editions running across as titles (a second, hidden copy
 * makes the loop seamless) and the chosen edition's cover on the stage. The
 * titles move, so they can be paused; with reduced motion they sit still and
 * wrap.
 *
 * @param {object} p
 * @param {{key:string,label:string,kind:string,tone:string,kicker:string,title:string,by:string}[]} p.editions
 *   the paper, then one per reading age (built from the reading-age table)
 * @param {string} p.heading   the label above the titles
 */
export default function EditionStage({ editions, heading }) {
  const [chosen, setChosen] = useState(editions.length > 1 ? 1 : 0);
  const [paused, setPaused] = useState(false);
  const edition = editions[chosen] || editions[0];

  const titles = (copy) =>
    editions.map((e, i) => (
      <button
        key={`${copy ? "copy" : "own"}-${e.key}`}
        type="button"
        className={i === chosen ? "pr-ed is-on" : "pr-ed"}
        onClick={() => setChosen(i)}
        {...(copy ? { "aria-hidden": true, tabIndex: -1 } : { "aria-pressed": i === chosen })}
      >
        {e.label}
        <sup>({e.kind})</sup>
      </button>
    ));

  return (
    <div className={paused ? "pr-hero is-paused" : "pr-hero"}>
      <div className="pr-sub pr-mono">
        <span>{heading}</span>
        <button type="button" className="pr-pause" onClick={() => setPaused((p) => !p)}>
          {paused ? "[ Play titles ]" : "[ Pause titles ]"}
        </button>
      </div>

      <div className="pr-mq" role="group" aria-label="Editions">
        <div className="pr-mq__track">
          {titles(false)}
          {titles(true)}
        </div>
      </div>

      <div className="pr-stage">
        <div className="pr-books">
          <span className="pr-ghost" aria-hidden="true" />
          <div className="pr-book" role="img" aria-label={`Cover: ${edition.title}, ${edition.kicker}`}>
            <div className={`pr-cover ${edition.tone}`}>
              <span className="pr-cover__k">{edition.kicker}</span>
              <span className="pr-cover__band" />
              <span className="pr-cover__t">{edition.title}</span>
              <span className="pr-cover__k pr-cover__by">{edition.by}</span>
              <span className="pr-cover__foot">
                <span>
                  {BRAND_NAME}
                  <br />
                  {PRODUCT_NAME}
                </span>
                <Kivyn pose="reading" size={40} tone={edition.tone === "is-paper" ? "light" : "on-dark"} />
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
