import Image from "next/image";

import legends from "@/data/legendPortraits.json";

import "./LegendWall.css";

/**
 * The wall of legends, as the public site draws it behind its sign-in
 * (ngo-web frontend src/components/MissionHeroWall.js): seven columns of
 * small portraits, neighbours drifting in opposite directions at different
 * speeds. `still` holds every column in place.
 *
 * The portraits and their record (src/data/legendPortraits.json) are copies
 * of the site's, fetched there by scripts/fetchLegendPortraits.mjs from
 * Wikimedia Commons (public domain and CC only). Several are CC BY or BY-SA,
 * so any page showing the wall links to the site's portrait credits.
 */
const COLUMNS = [
  { key: "a", direction: "down", secondsPerTile: 6 },
  { key: "b", direction: "up", secondsPerTile: 4.8 },
  { key: "c", direction: "down", secondsPerTile: 6.9 },
  { key: "d", direction: "up", secondsPerTile: 6.4 },
  { key: "e", direction: "down", secondsPerTile: 6.7 },
  { key: "f", direction: "up", secondsPerTile: 5.3 },
  { key: "g", direction: "down", secondsPerTile: 5.7 },
];

/* Each track holds its set three times and drifts by one set, so the seam
   never reaches the screen. */
const COPIES = 3;

/* Dealt round-robin, not sliced: the record is ordered roughly by region. */
const DEALT = COLUMNS.map((_, c) => legends.filter((_, i) => i % COLUMNS.length === c));

export default function LegendWall({ still = false }) {
  return (
    <div className={`mission-wall${still ? " is-still" : ""}`}>
      {DEALT.map((column, c) => {
        const config = COLUMNS[c];
        return (
          <div className="mission-col" key={config.key}>
            <ul
              className={`mission-track mission-track-${config.direction}`}
              style={{ "--mission-duration": `${config.secondsPerTile * column.length}s` }}
            >
              {Array.from({ length: COPIES }, () => column).flat().map((legend, index) => (
                <li className="mission-tile" key={`${legend.name}-${index}`}>
                  <Image
                    src={legend.image}
                    alt=""
                    width={200}
                    height={200}
                    className="mission-portrait"
                    loading="eager"
                    sizes="(max-width: 900px) 25vw, 130px"
                  />
                  <span className="mission-tile-caption">
                    <span className="mission-tile-name">{legend.name}</span>
                    <span className="mission-tile-meta">{legend.field}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
