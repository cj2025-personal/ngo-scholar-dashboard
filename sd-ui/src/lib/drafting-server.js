import "server-only";

import { cookies } from "next/headers";

/**
 * Server-side reads for the Studio and Papers pages, cookie forwarded the
 * same way `lib/editorial.js` does it. Null on any failure: a page renders
 * its empty state rather than a stack trace.
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

/** What of the scholar's work may be drafted from, cited, or neither. */
export async function getDraftSourcesServer() {
  return read("/api/drafting/sources");
}

/** The scholar's draft jobs, newest first. */
export async function getDraftJobsServer(limit = 20) {
  return (await read(`/api/drafting/jobs?limit=${limit}`)) || { jobs: [] };
}
