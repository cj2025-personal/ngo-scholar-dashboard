"use client";

import { useState } from "react";

/**
 * "Go to it": scroll the panel to a flagged turn and move focus there, so a
 * keyboard or screen-reader user lands on the turn too, not just sees it.
 * With more than one, each press goes to the next and comes round again. A
 * button, not a #hash link: a hash would add a history entry, and the back
 * button here means "close the transcript".
 */
export default function JumpToTurn({ turnIds }) {
  const [next, setNext] = useState(0);
  if (!turnIds?.length) return null;
  const many = turnIds.length > 1;

  return (
    <button
      type="button"
      className="pod-jump"
      onClick={() => {
        const turn = document.getElementById(turnIds[next]);
        setNext((next + 1) % turnIds.length);
        if (!turn) return;
        const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        turn.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" });
        turn.focus({ preventScroll: true });
      }}
    >
      {many ? `Go to the next (${next + 1} of ${turnIds.length})` : "Go to it"}
    </button>
  );
}
