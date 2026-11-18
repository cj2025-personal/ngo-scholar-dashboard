"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { LuLayoutDashboard, LuUsers, LuUsersRound } from "react-icons/lu";

import { DRAFT_AUDIENCES } from "@/lib/drafting";

/*
 * Who joins, said at a high level (the platform has institutional and retail
 * users alike, so nothing here is tied to a school): users, by the reading
 * ages a circle is for, the youngest, the next and the oldest in the table.
 * Never anyone's name.
 */
const AGES = [DRAFT_AUDIENCES[0], DRAFT_AUDIENCES[1], DRAFT_AUDIENCES[DRAFT_AUDIENCES.length - 1]].filter(Boolean);
const JOIN = AGES.map((age, i) => ({ id: ["a", "b", "c"][i], icon: LuUsers, title: "Users", sub: age.label }));
/*
 * Where a circle is read: on the dashboard of each user in it, and in a
 * community's portal once a model has placed it there, for the reading ages
 * it is for (the learner app's CirclesCard and PortalCirclesCard).
 */
const READ = [
  { id: "d", icon: LuLayoutDashboard, title: "User dashboards", sub: "Everyone in it" },
  { id: "p", icon: LuUsersRound, title: "A community’s portal", sub: "For its reading ages", portal: true },
];

/* One beam's light takes this long to cross; each starts a little after the last. */
const BEAM_S = 3.6;
const DELAY = { a: 0, b: 0.45, c: 0.9, d: 1.8, p: 2.3 };

/**
 * A learning circle as a diagram of what joins it and where it is read, its
 * links drawn as beams of light (the "animated beam" pattern of integration
 * diagrams): light runs in from the users who join to the circle, and out
 * from the circle to the dashboards and the portal where it is read.
 *
 * The curves are measured from the cards themselves (so the diagram lays
 * itself out across a laptop or down a phone) and drawn once; the light is a
 * dash sliding along each (stroke-dashoffset on a path of length 1). It runs
 * only while on screen; asked for less motion, the links are plain lines.
 */
export default function CircleBeams() {
  const root = useRef(null);
  const [paths, setPaths] = useState([]);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [on, setOn] = useState(false);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return undefined;
    const measure = () => {
      const base = el.getBoundingClientRect();
      const rect = (sel) => {
        const r = el.querySelector(sel)?.getBoundingClientRect();
        return r ? { l: r.left - base.left, r: r.right - base.left, t: r.top - base.top, b: r.bottom - base.top, cx: r.left - base.left + r.width / 2, cy: r.top - base.top + r.height / 2 } : null;
      };
      const hub = rect("[data-beam-hub]");
      if (!hub) return;
      const curve = (a, b, across) => (across
        ? `M ${a.x} ${a.y} C ${(a.x + b.x) / 2} ${a.y}, ${(a.x + b.x) / 2} ${b.y}, ${b.x} ${b.y}`
        : `M ${a.x} ${a.y} C ${a.x} ${(a.y + b.y) / 2}, ${b.x} ${(a.y + b.y) / 2}, ${b.x} ${b.y}`);
      const next = [];
      JOIN.forEach((n) => {
        const r = rect(`[data-beam="${n.id}"]`);
        if (!r) return;
        const across = r.r <= hub.l;
        const a = across ? { x: r.r, y: r.cy } : { x: r.cx, y: r.b };
        const b = across ? { x: hub.l, y: hub.cy } : { x: hub.cx, y: hub.t };
        next.push({ id: n.id, dir: "in", d: curve(a, b, across), a, b });
      });
      READ.forEach((n) => {
        const r = rect(`[data-beam="${n.id}"]`);
        if (!r) return;
        const across = hub.r <= r.l;
        const a = across ? { x: hub.r, y: hub.cy } : { x: hub.cx, y: hub.b };
        const b = across ? { x: r.l, y: r.cy } : { x: r.cx, y: r.t };
        next.push({ id: n.id, dir: "out", d: curve(a, b, across), a, b, portal: n.portal });
      });
      setBox({ w: base.width, h: base.height });
      setPaths(next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = root.current;
    if (!el) return undefined;
    const io = new IntersectionObserver(([entry]) => setOn(entry.isIntersecting), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={root}
      className={on ? "pr-beams is-on" : "pr-beams"}
      role="img"
      aria-label="Users of every reading age join your circle. Its stories are read on the dashboards of the users in it, and in a community’s portal, for the reading ages it is for."
      style={{ "--beam-s": `${BEAM_S}s` }}
    >
      <svg className="pr-beams__svg" width={box.w} height={box.h} viewBox={`0 0 ${box.w || 1} ${box.h || 1}`} aria-hidden="true" focusable="false">
        <defs>
          {paths.map((p) => (
            <linearGradient key={p.id} id={`pr-beam-${p.id}`} gradientUnits="userSpaceOnUse" x1={p.a.x} y1={p.a.y} x2={p.b.x} y2={p.b.y}>
              <stop offset="0" stopColor={p.dir === "in" ? "#102a56" : "#b22234"} />
              <stop offset="1" stopColor={p.dir === "in" ? "#b22234" : p.portal ? "#b22234" : "#102a56"} />
            </linearGradient>
          ))}
        </defs>
        {paths.map((p) => (
          <g key={p.id} style={{ "--d": `${DELAY[p.id] || 0}s` }}>
            <path className="pr-beams__track" d={p.d} />
            <path className="pr-beams__glow" d={p.d} pathLength="1" stroke={`url(#pr-beam-${p.id})`} />
            <path className="pr-beams__light" d={p.d} pathLength="1" stroke={`url(#pr-beam-${p.id})`} />
          </g>
        ))}
      </svg>

      <div className="pr-beams__col pr-beams__col--in" aria-hidden="true">
        <p className="pr-beams__label">Users join</p>
        {JOIN.map((n) => {
          const Icon = n.icon;
          return (
            <div key={n.id} className="pr-beams__node" data-beam={n.id}>
              <span className="pr-beams__icon"><Icon /></span>
              <span className="pr-beams__text">
                <span className="pr-beams__title">{n.title}</span>
                <span className="pr-beams__sub">{n.sub}</span>
              </span>
            </div>
          );
        })}
      </div>

      <div className="pr-beams__col pr-beams__col--hub" aria-hidden="true">
        <p className="pr-beams__label">Your circle</p>
        <div className="pr-beams__hub" data-beam-hub>
          <span className="pr-beams__ripple" />
          <span className="pr-beams__ripple pr-beams__ripple--2" />
          <span className="pr-beams__covers"><i className="is-navy" /><i className="is-red" /><i className="is-slate" /></span>
          <span className="pr-beams__hub-t">Stories you choose</span>
          <span className="pr-beams__hub-s">For the ages you choose</span>
        </div>
      </div>

      <div className="pr-beams__col pr-beams__col--out" aria-hidden="true">
        <p className="pr-beams__label">Where it’s read</p>
        {READ.map((n) => {
          const Icon = n.icon;
          return (
            <div key={n.id} className={n.portal ? "pr-beams__node is-portal" : "pr-beams__node"} data-beam={n.id} style={{ "--d": `${DELAY[n.id] || 0}s` }}>
              <span className="pr-beams__icon"><Icon /></span>
              <span className="pr-beams__text">
                <span className="pr-beams__title">{n.title}</span>
                <span className="pr-beams__sub">{n.sub}</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
