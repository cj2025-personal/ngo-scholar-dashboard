import "server-only";

const AUTH_API_URL =
  process.env.AUTH_API_URL ||
  process.env.NEXT_PUBLIC_AUTH_API_URL ||
  "http://localhost:4000";

/**
 * What an invitation is for, without spending it.
 *
 * ── Fetched on the server, and deliberately not cached ─────────────────────
 * An invitation's state changes the moment anyone redeems it. A cached "valid"
 * response would let a second person open a forwarded link and be shown a
 * working form for an invitation that is already gone — they would fill it in
 * and be refused at submit, which reads as a broken product rather than as a
 * spent link.
 *
 * The token is in the URL, so it reaches the server either way. Resolving here
 * rather than in the browser means a revoked or expired link never renders a
 * password field at all.
 */
export async function describeInvite(token) {
  if (!token || typeof token !== "string") {
    return { ok: false, reason: "unknown", message: "This invitation link is not valid." };
  }

  let response;

  try {
    response = await fetch(
      `${AUTH_API_URL}/api/invites/${encodeURIComponent(token)}`,
      { method: "GET", cache: "no-store" },
    );
  } catch {
    /* The API being unreachable is not the same as the invitation being bad,
       and telling someone their link is invalid when the service is down sends
       them to support for a problem that will fix itself. */
    return {
      ok: false,
      reason: "unavailable",
      message: "We can't check this invitation right now. Please try again shortly.",
    };
  }

  try {
    return await response.json();
  } catch {
    return { ok: false, reason: "unknown", message: "This invitation link is not valid." };
  }
}
