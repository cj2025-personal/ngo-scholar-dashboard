"use client";

import { useRef, useState } from "react";
import { LuShieldCheck } from "react-icons/lu";

/* The gauge's scale, in grades. */
const SCALE_MAX = 14;
const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * One reading age at a time, as Kivyn writes for it: who the readers are,
 * Kivyn's own brief for them, the band of reading levels an edition is
 * judged against, and, for the youngest, the suitability check. Every value
 * is the API's (lib/readingBands.js mirrors sd-api's audiences.js).
 *
 * Tabs in the ARIA pattern: arrows move between ages, Home and End jump.
 *
 * @param {object} p
 * @param {{value:string,name:string,label:string,grade:number,readers:string,rules:string,maxAbove:number,maxBelow:number|null,young:boolean}[]} p.bands
 */
export default function GradeLadder({ bands }) {
  const [at, setAt] = useState(0);
  const tabs = useRef([]);
  const band = bands[at] || bands[0];

  const lo = band.maxBelow == null ? null : band.grade - band.maxBelow;
  const hi = band.grade + band.maxAbove;
  const pct = (g) => `${Math.max(0, Math.min(100, (g / SCALE_MAX) * 100))}%`;

  const onKey = (event) => {
    const last = bands.length - 1;
    const next = { ArrowRight: at === last ? 0 : at + 1, ArrowLeft: at === 0 ? last : at - 1, Home: 0, End: last }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setAt(next);
    tabs.current[next]?.focus();
  };

  return (
    <div className="pr-kv-card pr-ladder">
      <p className="pr-mini pr-mini--red">Written to the grade</p>
      <div className="pr-ladder__tabs" role="tablist" aria-label="Reading ages" onKeyDown={onKey}>
        {bands.map((b, i) => (
          <button
            key={b.value}
            ref={(el) => { tabs.current[i] = el; }}
            type="button"
            role="tab"
            id={`pr-ladder-tab-${b.value}`}
            aria-selected={i === at}
            aria-controls="pr-ladder-panel"
            tabIndex={i === at ? 0 : -1}
            className={i === at ? "pr-ladder__tab is-on" : "pr-ladder__tab"}
            onClick={() => setAt(i)}
          >
            <span>{b.name}</span>
            <small>Grade {b.grade}</small>
          </button>
        ))}
      </div>

      <div id="pr-ladder-panel" role="tabpanel" aria-labelledby={`pr-ladder-tab-${band.value}`} className="pr-ladder__panel">
        <p className="pr-ladder__for">
          For <strong>{band.readers}</strong>
        </p>
        <figure className="pr-ladder__brief">
          <blockquote>{band.rules}</blockquote>
          <figcaption>Kivyn’s brief for {band.label.toLowerCase()}</figcaption>
        </figure>

        <div className="pr-gauge" aria-hidden="true">
          <span className="pr-gauge__band" style={{ left: lo == null ? "0%" : pct(lo), right: `calc(100% - ${pct(hi)})` }} />
          <span className="pr-gauge__target" style={{ left: pct(band.grade) }}>
            <span>Grade {band.grade}</span>
          </span>
          {[2, 4, 6, 8, 10, 12].map((g) => (
            <span key={g} className="pr-gauge__tick" style={{ left: pct(g) }}>{g}</span>
          ))}
        </div>
        <p className="pr-ladder__band">
          Written to grade {band.grade}. Its reading level is measured, and judged as an editor would against{" "}
          {lo == null ? `anything up to grade ${fmt(hi)}` : `grades ${fmt(lo)} to ${fmt(hi)}`}.
        </p>

        {band.young ? (
          <p className="pr-ladder__young">
            <LuShieldCheck size={16} aria-hidden="true" focusable="false" />
            Anything beyond your paper is also judged for suitability: nothing frightening, nothing beyond the reader’s world.
          </p>
        ) : null}
      </div>
    </div>
  );
}
