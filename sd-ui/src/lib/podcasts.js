import "server-only";

import { cookies } from "next/headers";

/**
 * The dialogues a scholar is named in.
 *
 * Server-side only, cookie forwarded the way `lib/drafting-server.js` does it.
 * Null or an empty list on any failure: the page renders its empty state
 * rather than a stack trace, and an episode list that cannot be fetched must
 * never look like an episode list that is empty — the pages say which.
 */

const AUTH_API_URL =
  process.env.AUTH_API_URL ||
  process.env.NEXT_PUBLIC_AUTH_API_URL ||
  "http://localhost:4000";

async function read(path) {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();
  if (!cookieHeader) return null;
  try {
    const response = await fetch(`${AUTH_API_URL}${path}`, { headers: { Cookie: cookieHeader }, cache: "no-store" });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/** Every episode this scholar is in, published or not, newest first. */
export async function getScholarEpisodes(limit = 50) {
  const data = await read(`/api/podcasts?limit=${limit}`);
  return data?.episodes || [];
}

/** One episode, with its transcript and the scholar's own passages. */
export async function getScholarEpisode(id) {
  const data = await read(`/api/podcasts/${encodeURIComponent(id)}`);
  return data?.episode || null;
}

/**
 * How long an episode runs, in words rather than a clock face.
 *
 * Shared by the list and the reader so one episode never reads "10 min" in
 * one place and "9:36" in the other.
 */
export function runtime(seconds) {
  if (!seconds || !Number.isFinite(seconds)) return "";
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return "under a minute";
  return `${minutes} min`;
}
