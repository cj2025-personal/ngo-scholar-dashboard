/**
 * Inkvyn's mark: a pen nib, split down its slit as the Proj Arch mark's "A"
 * is split down its middle, navy on the left and red on the right, with the
 * nib's breather hole and slit cut in white. The same two colours and the
 * same faceted, flat geometry, so the product reads as one of the family
 * (public/brand/archivyn-mark.svg; the file twin is public/brand/inkvyn-mark.svg).
 *
 * Decorative wherever the name is written beside it; pass `label` where the
 * mark stands alone.
 *
 * @param {object} p
 * @param {string} [p.className]
 * @param {string} [p.label]   an accessible name, when nothing beside it says "Inkvyn"
 */
export default function InkvynMark({ className = "", label = "" }) {
  const named = Boolean(label);
  return (
    <svg
      className={className}
      viewBox="0 0 100 120"
      role={named ? "img" : undefined}
      aria-label={named ? label : undefined}
      aria-hidden={named ? undefined : true}
      focusable="false"
    >
      {/* The two halves: navy left, red right, meeting at the tip. */}
      <path d="M50 4 L24 4 L8 44 L50 116 Z" fill="#102a56" />
      <path d="M50 4 L76 4 L92 44 L50 116 Z" fill="#b22234" />
      {/* The shoulder facets, a shade lighter, as the mark's feet are. */}
      <path d="M24 4 L8 44 L20 44 Z" fill="#1a3a6e" />
      <path d="M76 4 L92 44 L80 44 Z" fill="#e85060" />
      {/* The breather hole and the slit to the tip. */}
      <circle cx="50" cy="54" r="7" fill="#ffffff" />
      <path d="M50 61 L50 108" stroke="#ffffff" strokeWidth="3.2" strokeLinecap="round" />
    </svg>
  );
}
