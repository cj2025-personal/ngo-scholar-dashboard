"use client";

/**
 * An agent's face: its chosen glyph on its chosen colour. Decorative.
 *
 * "mark" is the reading companion's own: an open book, drawn, on a rounded
 * square, where a grey "?" in a circle used to be.
 */
export function CompanionMark({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H2zM22 4h-7a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h8z" />
    </svg>
  );
}

export default function AgentFace({ persona, size = "", className = "" }) {
  const mark = persona.face === "mark";
  return (
    <span className={`ag-avatar rc-face is-${persona.tone}${mark ? " is-mark" : ""}${size ? ` is-${size}` : ""}${className ? ` ${className}` : ""}`} aria-hidden>
      {mark ? <CompanionMark size={size === "lg" ? 26 : size === "md" ? 18 : 14} /> : persona.face}
    </span>
  );
}
