"use client";

import { useEffect, useRef, useState } from "react";

import Kivyn, { draw } from "@/components/kivyn/Kivyn";
import { EMOTE_BOX, emote } from "@/lib/kivyn/art.mjs";
import { AGENT_NAME, BUSY_REACTION, REACTION_MS, reactionAt } from "@/lib/kivyn/pose.mjs";

/**
 * Kivyn, answering a tap.
 *
 * At rest, each tap gets a reaction in turn — a wave and a hello first, then
 * a wink, a hop, a tilt of the head, a start, a page-turn — with a bubble
 * rising over it, and after a moment Kivyn is back as it was. While the
 * agent is working the tap is acknowledged, not obeyed: the pose stays the
 * step under way, because a drawing of the work must never be replaced by a
 * drawing of something else, and a bubble of dots says Kivyn is still on it.
 *
 * A real button, so a keyboard reaches it and Enter or Space taps it; what
 * Kivyn did is said in a polite live region. With reduced motion the
 * reaction's pose and bubble still show, without the movement.
 *
 * @param {object} p
 * @param {string} [p.pose]     what Kivyn is drawn doing when no one has tapped it
 * @param {boolean} [p.busy]    the agent is working: a tap gets the "still on it" bubble
 * @param {number} [p.size]
 * @param {"figure"|"mark"} [p.variant]
 */
export default function KivynButton({ pose = "neutral", busy = false, size = 52, variant = "figure", tone = "light", className = "" }) {
  const [reaction, setReaction] = useState(null);
  const taps = useRef(0);
  const seq = useRef(0);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  function tap() {
    const next = busy ? BUSY_REACTION : reactionAt(taps.current++);
    seq.current += 1;
    setReaction({ ...next, key: seq.current });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setReaction(null), REACTION_MS);
  }

  const reacting = Boolean(reaction?.name);
  return (
    <button
      type="button"
      className={`kv-actor${className ? ` ${className}` : ""}`}
      onClick={tap}
      aria-label={busy ? `${AGENT_NAME}, working` : `Say hello to ${AGENT_NAME}`}
      title={busy ? `${AGENT_NAME} is working` : `Say hello to ${AGENT_NAME}`}
    >
      {/* Keyed by the tap, so a second tap restarts the motion rather than joining it. */}
      <Kivyn
        key={reacting ? `r${reaction.key}` : "rest"}
        pose={reacting ? reaction.name : pose}
        size={size}
        variant={variant}
        tone={tone}
        live
        className={reacting ? `kv-react kv-react-${reaction.name}` : ""}
      />
      {reaction ? (
        <svg key={`e${reaction.key}`} className={`kv-emote kv-emote-${reaction.emote}`} data-emote={reaction.emote} viewBox={EMOTE_BOX} aria-hidden="true" focusable="false">
          {emote(reaction.emote).map((node, i) => draw(node, i))}
        </svg>
      ) : null}
      <span className="sr-only" aria-live="polite">{reaction?.said || ""}</span>
    </button>
  );
}
