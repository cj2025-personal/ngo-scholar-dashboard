import "server-only";

import { cookies } from "next/headers";

const AUTH_API_URL =
  process.env.AUTH_API_URL ||
  process.env.NEXT_PUBLIC_AUTH_API_URL ||
  "http://localhost:4000";

/**
 * Everything this platform publishes under the signed-in scholar's name.
 *
 * ── Never cached ───────────────────────────────────────────────────────────
 * The list includes unpublished drafts and content pending the scholar's
 * consent. A cached page is a page that can be served to the wrong session, and
 * the thing being cached here is private material about a named individual.
 *
 * ── The profile id is never a parameter ────────────────────────────────────
 * It comes from the session cookie, resolved by the API. This function takes no
 * scholar argument on purpose: a signature that accepted one would eventually
 * be called with a value from a URL, and that is how one scholar reads another
 * scholar's drafts.
 */
export async function getScholarContent() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();

  if (!cookieHeader) {
    return null;
  }

  let response;

  try {
    response = await fetch(`${AUTH_API_URL}/api/content`, {
      method: "GET",
      headers: { Cookie: cookieHeader },
      cache: "no-store",
    });
  } catch {
    /* Unreachable is not the same as empty. Returning null lets the page say
       "we can't load this" rather than "nothing is published about you", which
       would be a false and alarming statement to make to a researcher. */
    return null;
  }

  if (!response.ok) {
    return null;
  }

  try {
    return await response.json();
  } catch {
    return null;
  }
}
