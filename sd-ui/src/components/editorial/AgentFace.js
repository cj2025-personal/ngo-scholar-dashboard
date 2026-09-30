"use client";

/** An agent's face: its chosen glyph on its chosen colour. Decorative. */
export default function AgentFace({ persona, size = "", className = "" }) {
  return <span className={`ag-avatar rc-face is-${persona.tone}${size ? ` is-${size}` : ""}${className ? ` ${className}` : ""}`} aria-hidden>{persona.face}</span>;
}
