"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { HiOutlineArrowRight } from "react-icons/hi2";

import Kivyn, { draw } from "@/components/kivyn/Kivyn";
import { EMOTE_BOX, emote } from "@/lib/kivyn/art.mjs";
import { AGENT_NAME, REACTION_MS } from "@/lib/kivyn/pose.mjs";

/**
 * Where stories are written: one control, "Write a story with Kivyn".
 *
 * There used to be two — "New story" in the bar and "Ask Kivyn" on the
 * Studio — and they went to the same place, the editor with Kivyn beside it.
 * Two names for one door made it look like two ways of working, when writing
 * a story here is writing it with Kivyn. So it is one thing, and it says so.
 *
 * It has two forms and only one is ever on a screen. On the Studio it is a
 * nudge at the head of the page, over the numbers, saying in words that this
 * is where articles are written; the bar leaves its own out there. Everywhere
 * else it sits at the end of the bar.
 *
 * ── The motion ──────────────────────────────────────────────────────────────
 * At rest Kivyn blinks. Pointed at or focused, it picks up the pencil — the
 * writing pose it takes in the editor when it really is drafting — and a
 * sparkle rises over it: a preview of what happens behind the door, played
 * once per approach rather than looped at someone who is reading the page.
 * The first time it appears in a visit it plays once by itself, so the
 * connection between Kivyn and writing is made without anyone hunting for
 * it; after that it waits to be asked. With reduced motion the pose and the
 * bubble still change, without the movement.
 *
 * On a narrow bar the words become screen-reader text, and Kivyn alone is
 * the button; the link's name stays "Write a story with Kivyn".
 *
 * @param {object} p
 * @param {"bar"|"nudge"} [p.variant]
 */
const GREETED_KEY = "kivyn_write_greeted";
const GREET_AFTER_MS = 900;

export default function WriteWithKivyn({ variant = "bar", className = "" }) {
  const [writing, setWriting] = useState(false);
  const [bubble, setBubble] = useState(0);
  const seq = useRef(0);
  const timer = useRef(null);
  const hovered = useRef(false);

  /* One sparkle per approach, keyed so a second approach replays it. */
  function spark() {
    seq.current += 1;
    setBubble(seq.current);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setBubble(0);
      if (!hovered.current) setWriting(false);
    }, REACTION_MS);
  }

  useEffect(() => {
    let seen = true;
    try {
      seen = window.sessionStorage.getItem(GREETED_KEY) === "1";
      if (!seen) window.sessionStorage.setItem(GREETED_KEY, "1");
    } catch {
      seen = true;
    }
    if (seen) return () => clearTimeout(timer.current);
    const greet = setTimeout(() => { setWriting(true); spark(); }, GREET_AFTER_MS);
    return () => { clearTimeout(greet); clearTimeout(timer.current); };
  }, []);

  function approach() {
    hovered.current = true;
    setWriting(true);
    spark();
  }
  function leave() {
    hovered.current = false;
    if (!bubble) setWriting(false);
  }

  const nudge = variant === "nudge";
  const base = nudge ? "kw-nudge" : "nb-write";
  return (
    <Link
      href="/editorial/new"
      className={`${base}${writing ? " is-writing" : ""}${className ? ` ${className}` : ""}`}
      title={`Every story is written here, with ${AGENT_NAME} beside you`}
      onPointerEnter={approach}
      onPointerLeave={leave}
      onFocus={approach}
      onBlur={leave}
    >
      <span className={`${base}__kv`} aria-hidden>
        <Kivyn pose={writing ? "writing" : "neutral"} size={nudge ? 38 : 34} live />
        {bubble ? (
          <svg key={bubble} className={`kv-emote kv-emote-sparkle ${base}__emote`} viewBox={EMOTE_BOX} aria-hidden="true" focusable="false">
            {emote("sparkle").map((node, i) => draw(node, i))}
          </svg>
        ) : null}
      </span>
      <span className={`${base}__text`}>
        <span className={`${base}__lead`}>{nudge ? `Write a story with ${AGENT_NAME}` : "Write a story"}</span>{" "}
        <span className={`${base}__sub`}>{nudge ? "This is where your articles are written" : `with ${AGENT_NAME}`}</span>
      </span>
      {nudge ? <span className="kw-nudge__go" aria-hidden><HiOutlineArrowRight size={15} /></span> : null}
    </Link>
  );
}
