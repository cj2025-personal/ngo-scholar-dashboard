// Small presentation helpers for the scholar workspace.

export function initials(name = "") {
  const cleaned = String(name)
    .replace(/^(Dr\.|Prof\.?|Sir|Mr\.|Ms\.|Mrs\.)\s*/i, "")
    .trim();
  if (!cleaned) return "SC";
  return cleaned
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
}

const AV = ["g1", "g2", "g3", "g4", "g5"];

/** Deterministic avatar gradient from a string seed. */
export function avatarClass(seed = "") {
  let hash = 0;
  for (let i = 0; i < String(seed).length; i += 1) {
    hash = (hash * 31 + String(seed).charCodeAt(i)) >>> 0;
  }
  return AV[hash % AV.length];
}
