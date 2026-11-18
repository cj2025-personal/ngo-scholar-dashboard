"use client";

import { useState } from "react";

import Kivyn from "@/components/kivyn/Kivyn";

/**
 * The index: choose a step on the left, read it on the right.
 *
 * @param {object} p
 * @param {{label:string,text:string,pose:string}[]} p.steps   built on the server (PressLanding)
 * @param {string} p.aside   the line beside the section's label
 */
export default function HowItsMade({ steps, aside }) {
  const [step, setStep] = useState(0);
  const current = steps[step] || steps[0];

  return (
    <section id="how" className="pr-how" aria-labelledby="pr-how-title">
      <div className="pr-sect pr-mono">
        <h2 id="pr-how-title" className="pr-sect__title">[ How it’s made ]</h2>
        <span className="pr-sect__aside">{aside}</span>
      </div>
      <div className="pr-idx">
        <div className="pr-rows">
          {steps.map((s, i) => (
            <button
              key={s.label}
              type="button"
              className={i === step ? "pr-row is-on" : "pr-row"}
              aria-pressed={i === step}
              aria-controls="pr-step"
              onClick={() => setStep(i)}
            >
              <span aria-hidden="true">{i === step ? "[▸]" : `[${i + 1}]`}</span>
              <span>{s.label}</span>
            </button>
          ))}
        </div>
        <div id="pr-step" className="pr-read" aria-live="polite">
          <span className="pr-mono pr-read__count">Step {step + 1} of {steps.length}</span>
          <p>{current.text}</p>
          <Kivyn pose={current.pose} size={120} live className="pr-read__kv" />
        </div>
      </div>
    </section>
  );
}
