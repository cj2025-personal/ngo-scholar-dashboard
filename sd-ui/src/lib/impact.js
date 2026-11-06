/**
 * A scholar's signed impact record, from the browser: their own, and the
 * share links they make for it (sd-api routes/impact.routes). Every call
 * answers { ok, data, error }.
 */
const AUTH_API_URL = process.env.NEXT_PUBLIC_AUTH_API_URL || "http://localhost:4000";
const UNREACHABLE = "Proj Arch could not be reached. Check your connection and try again.";

async function request(path, init = {}) {
  let response;
  try {
    response = await fetch(`${AUTH_API_URL}${path}`, {
      credentials: "include",
      cache: "no-store",
      ...init,
      headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers || {}) },
    });
  } catch {
    return { ok: false, data: null, error: UNREACHABLE };
  }
  let data = null;
  try {
    data = await response.json();
  } catch {
    /* An error with no JSON body is still an error. */
  }
  if (!response.ok) return { ok: false, data: null, error: data?.error || data?.message || `Request failed (${response.status}).` };
  return { ok: true, data, error: null };
}

/** The scholar's own record, signed now: { record, signature, keyId, signed }. */
export const getImpact = () => request("/api/impact");

export const listShares = () => request("/api/impact/shares");

/** A new link; `token` is in the answer once and never again. */
export const createShare = (label) => request("/api/impact/shares", { method: "POST", body: JSON.stringify({ label }) });

export const revokeShare = (shareId) => request(`/api/impact/shares/${encodeURIComponent(shareId)}`, { method: "DELETE" });

/** The address a share link opens, on this studio. */
export const shareUrl = (token) => `${typeof window === "undefined" ? "" : window.location.origin}/record/${token}`;

export const BAND_LABELS = { ages_8_11: "Ages 8–11", ages_12_14: "Ages 12–14", ages_15_18: "Ages 15–18", adults: "Adults" };

export const CONTRIBUTION_LABELS = {
  story_published: ["story published", "stories published"],
  level_approved: ["reading age approved", "reading ages approved"],
  circle_created: ["circle started", "circles started"],
  class_joined_circle: ["class joined a circle", "classes joined a circle"],
  passage_clarified: ["passage made clearer for readers", "passages made clearer for readers"],
};

/** A count as said to a person: the number, or "fewer than N" under the floor. */
export const countOrFloor = (value, floor) => (typeof value === "number" ? value.toLocaleString() : `fewer than ${floor}`);
