/**
 * The scholar's privacy and visibility settings, from the browser (sd-api
 * routes/profile.routes, /api/profile/consent). Every call answers
 * { ok, data, error }; `data` is the whole state again, history included, so
 * the panel always shows what the server holds rather than what it guessed.
 */
const AUTH_API_URL = process.env.NEXT_PUBLIC_AUTH_API_URL || "http://localhost:4100";
const UNREACHABLE = "Proj Arch could not be reached. Check your connection and try again.";

/**
 * One change to one layer: `photo`, `community` and `contact` take "grant" or
 * "withdraw"; `listing` takes "hide" or "unhide". `values` is the chosen
 * communities, for a community grant.
 */
export async function changeConsent(layer, action, values) {
  let response;
  try {
    response = await fetch(`${AUTH_API_URL}/api/profile/consent/${encodeURIComponent(layer)}`, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values ? { action, values } : { action }),
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
  if (!response.ok) return { ok: false, data: null, error: data?.error || data?.message || `That did not save (${response.status}).` };
  return { ok: true, data, error: null };
}

/** The scholar's own photo, as the panel shows it: private to them. */
export const consentPhotoUrl = () => `${AUTH_API_URL}/api/profile/consent/photo`;
