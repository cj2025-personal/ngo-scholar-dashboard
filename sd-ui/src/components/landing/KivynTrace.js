"use client";

import { useEffect, useRef, useState } from "react";
import { LuCheck } from "react-icons/lu";

import Kivyn from "@/components/kivyn/Kivyn";
import { STEP_POSES } from "@/lib/kivyn/pose.mjs";

/*
 * Kivyn's work on a paper, as the drafting pipeline reports it: each step is
 * one the pipeline streams (sd-api draftGraph.js; STEP_POSES in
 * lib/kivyn/pose.mjs, which draws each), in its order, said in plain words.
 * The last is the scholar's, not Kivyn's: nothing goes further without them.
 */
const STEPS = [
  { key: "pick_source", label: "Reads your paper" },
  { key: "plan_outline", label: "Plans the outline, and waits for your yes" },
  { key: "draft_blocks", label: "Writes each section" },
  { key: "judge_fidelity", label: "Checks every claim against your paper" },
  { key: "judge_reach", label: "Judges anything that goes beyond it" },
  { key: "judge_voice", label: "Keeps to your voice" },
  { key: "check_reading_level", label: "Measures the reading level" },
  { key: "draft_levels", label: "Writes the other reading ages" },
  { key: null, label: "Hands it to you to approve", pose: "done" },
];

const STEP_MS = 1600;
const HOLD_MS = 2600;

/**
 * A window onto Kivyn at work: the steps tick through, Kivyn drawn doing the
 * one under way. It plays only while on screen and not under the pointer or
 * keyboard; asked for less motion, it is the finished run, still. The list
 * is plain text either way, so a screen reader reads the steps, not the
 * animation.
 */
export default function KivynTrace() {
  const [at, setAt] = useState(0);
  const [still, setStill] = useState(false);
  const [held, setHeld] = useState(false);
  const [seen, setSeen] = useState(false);
  const root = useRef(null);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setStill(query.matches);
    apply();
    query.addEventListener("change", apply);
    const io = new IntersectionObserver(([entry]) => setSeen(entry.isIntersecting), { threshold: 0.25 });
    if (root.current) io.observe(root.current);
    return () => { query.removeEventListener("change", apply); io.disconnect(); };
  }, []);

  useEffect(() => {
    if (still || held || !seen) return undefined;
    const last = STEPS.length - 1;
    const timer = setTimeout(() => setAt((n) => (n >= last ? 0 : n + 1)), at >= last ? HOLD_MS : STEP_MS);
    return () => clearTimeout(timer);
  }, [at, still, held, seen]);

  const current = still ? STEPS.length - 1 : at;
  const step = STEPS[current];
  const pose = step.pose || STEP_POSES[step.key] || "neutral";
  const progress = Math.round(((current + 1) / STEPS.length) * 100);

  return (
    <div
      ref={root}
      className="pr-kv-card pr-trace"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <div className="pr-trace__chrome" aria-hidden="true">
        <i /><i /><i />
        <span>Kivyn · at work on your paper</span>
      </div>
      <div className="pr-trace__body">
        <div className="pr-trace__who">
          <Kivyn pose={pose} size={64} live={!still} />
          <div>
            <p className="pr-trace__name">Kivyn</p>
            <p className="pr-trace__now" aria-hidden="true">{step.label}</p>
          </div>
        </div>
        <ol className="pr-trace__steps">
          {STEPS.map((s, i) => {
            const state = i < current || (still && i <= current) ? "is-done" : i === current ? "is-now" : "is-next";
            return (
              <li key={s.label} className={`pr-trace__step ${state}`} aria-current={i === current && !still ? "step" : undefined}>
                <span className="pr-trace__dot" aria-hidden="true">{state === "is-done" ? <LuCheck size={12} /> : null}</span>
                <span>{s.label}</span>
              </li>
            );
          })}
        </ol>
        <div className="pr-trace__foot" aria-hidden="true">
          <span>Step {current + 1} of {STEPS.length}</span>
          <span>Nothing is published without you</span>
        </div>
        <div className="pr-trace__bar" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>
      </div>
    </div>
  );
}
