"use client";

import { useEffect, useRef, useState } from "react";

/**
 * An agent's reply, typed onto the screen the way a chat model's reply
 * streams in: a few characters at a time, a caret at the end while it is
 * still coming, and the thread following it down.
 *
 * What is typed is the reply the agent already sent, whole; nothing is
 * invented for the animation and nothing is held back once it is done.
 * A reply the scholar has seen before (one loaded with the page, or picked
 * up from the record) is shown at once: only what arrives while they watch
 * is typed. Under "reduce motion" everything is shown at once.
 *
 * The element is `aria-busy` while it types, so a screen reader announces
 * the reply once, finished, rather than every few characters of it.
 */

/** About 160 characters a second, and never more than about 2.4 seconds for a long reply. */
const FRAME_MS = 16;
const MIN_STEP = 3;
const MAX_FRAMES = 150;

function prefersStill() {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

/** The thread around a reply, if the reader is at (or near) its bottom: kept there as it grows. */
function follow(el) {
  const thread = el?.closest?.(".ch-thread, .ag-thread, .rc-thread");
  if (!thread) return;
  const fromBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight;
  if (fromBottom < 160) thread.scrollTop = thread.scrollHeight;
}

/**
 * @param {string} text
 * @param {boolean} animate   type it (a reply that just arrived) or show it whole (one seen before)
 * @returns {{shown: string, done: boolean}}
 */
export function useTyped(text, animate = true) {
  const full = String(text ?? "");
  /* Shown whole, never typed: a reply seen before, or a reader who asked for less motion. */
  const [still] = useState(prefersStill);
  const instant = !animate || still;
  const [count, setCount] = useState(0);
  const countRef = useRef(0);

  useEffect(() => {
    if (instant || countRef.current >= full.length) return undefined;
    const step = Math.max(MIN_STEP, Math.ceil(full.length / MAX_FRAMES));
    const t = setInterval(() => {
      /* End on a word where one is near, so a word is never left half-drawn between frames. */
      let next = Math.min(full.length, countRef.current + step);
      const space = full.indexOf(" ", next);
      if (space > 0 && space - next <= 4) next = space;
      countRef.current = next;
      setCount(next);
      if (next >= full.length) clearInterval(t);
    }, FRAME_MS);
    return () => clearInterval(t);
  }, [full, instant]);

  const shown = instant ? full : full.slice(0, Math.min(count, full.length));
  return { shown, done: shown.length >= full.length };
}

/**
 * @param {object} p
 * @param {string} p.text
 * @param {boolean} [p.animate]
 * @param {string} [p.as]          the element to render: span by default
 * @param {string} [p.className]
 * @param {(done: boolean) => void} [p.onDone]   told once the whole reply is on screen
 */
export default function TypedText({ text, animate = true, as: Tag = "span", className = "", onDone }) {
  const ref = useRef(null);
  const { shown, done } = useTyped(text, animate);

  useEffect(() => { follow(ref.current); }, [shown]);
  const told = useRef(false);
  useEffect(() => {
    if (done && !told.current) { told.current = true; onDone?.(true); }
  }, [done, onDone]);

  return (
    <Tag ref={ref} className={`tt${done ? "" : " is-typing"}${className ? ` ${className}` : ""}`} aria-busy={done ? undefined : "true"}>
      {shown}
      {done ? null : <span className="tt-caret" aria-hidden="true" />}
    </Tag>
  );
}

/** "Thinking": three dots that pulse, beside whatever the agent says it is doing. */
export function TypingDots({ label = "" }) {
  return (
    <span className="tt-dots" role="img" aria-label={label || "Working"}>
      <i /><i /><i />
    </span>
  );
}
