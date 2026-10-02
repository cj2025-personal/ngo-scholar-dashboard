/**
 * An episode's cover: the two people in it, and a waveform.
 *
 * Drawn, not fetched. There is no artwork for these episodes and inventing an
 * image would be decoration pretending to be content, so the cover says the
 * two true things a cover can: who is speaking, and that it is something to
 * listen to. The archive's scholar sits behind on navy, the scholar working
 * now in front on the brand's red; the waveform's shape is fixed by the
 * episode's id, so an episode always looks like itself and two never match.
 *
 * Decorative to a screen reader: the card beside it names both people.
 */

const PALETTES = [
  ["#1E3A8A", "#172554"],
  ["#1D4ED8", "#1E3A8A"],
  ["#0F2A5C", "#0A1A3A"],
  ["#274B9F", "#172554"],
];

function hash(text) {
  let h = 2166136261;
  for (const ch of String(text || "")) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function initials(name) {
  const parts = String(name || "").split(/\s+/).filter(Boolean);
  if (!parts.length) return "·";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export default function EpisodeArt({ id, withName, meName, size = 112, className = "" }) {
  const seed = hash(id);
  const [top, bottom] = PALETTES[seed % PALETTES.length];
  const gid = `pod-art-${String(id).replace(/[^\w-]/g, "")}`;
  /* Twenty-two bars, their heights from the seed: the episode's own shape. */
  const bars = Array.from({ length: 22 }, (_, i) => {
    const h = 6 + (((seed >>> (i % 24)) ^ (i * 2654435761)) >>> 0) % 22;
    return { x: 10 + i * 4.3, h };
  });
  return (
    <svg className={`pod-art${className ? ` ${className}` : ""}`} viewBox="0 0 112 112" width={size} height={size} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={top} />
          <stop offset="1" stopColor={bottom} />
        </linearGradient>
      </defs>
      <rect width="112" height="112" rx="18" fill={`url(#${gid})`} />
      <g fill="#FFFFFF" fillOpacity="0.16">
        {bars.map((b) => <rect key={b.x} x={b.x} y={100 - b.h} width="2.4" height={b.h} rx="1.2" />)}
      </g>
      {/* Two speakers side by side, just touching: both sets of initials whole. */}
      <circle cx="36" cy="45" r="20" fill="#FFFFFF" fillOpacity="0.14" stroke="#FFFFFF" strokeOpacity="0.5" strokeWidth="1.5" />
      <text x="36" y="50" textAnchor="middle" fontFamily="Inter, Arial, sans-serif" fontSize="13.5" fontWeight="700" fill="#FFFFFF">{initials(withName)}</text>
      <circle cx="76" cy="58" r="20" fill="#D52B3F" stroke="#FFFFFF" strokeWidth="2" />
      <text x="76" y="63" textAnchor="middle" fontFamily="Inter, Arial, sans-serif" fontSize="13.5" fontWeight="700" fill="#FFFFFF">{initials(meName)}</text>
    </svg>
  );
}
