import "server-only";

import { cookies } from "next/headers";

/**
 * Where a scholar stands against the Legacy benchmark.
 *
 * Null on any failure, so a page renders its empty state rather than a stack
 * trace — and so a scholar is never told they have not met something because
 * a request timed out.
 */

const AUTH_API_URL =
  process.env.AUTH_API_URL ||
  process.env.NEXT_PUBLIC_AUTH_API_URL ||
  "http://localhost:4000";

export async function getStanding() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();
  if (!cookieHeader) return null;
  try {
    const response = await fetch(`${AUTH_API_URL}/api/standing/me`, {
      headers: { Cookie: cookieHeader },
      cache: "no-store",
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data?.standing || null;
  } catch {
    return null;
  }
}

/** What each standing is called where a scholar reads it. */
export const STANDING_LABEL = {
  legacy: "Legacy",
  approaching: "Approaching Legacy",
  contemporary: "Contemporary",
  withdrawn: "Withdrawn",
};
