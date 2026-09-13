import "server-only";

import { cookies } from "next/headers";

const AUTH_API_URL =
  process.env.AUTH_API_URL ||
  process.env.NEXT_PUBLIC_AUTH_API_URL ||
  "http://localhost:4000";

/**
 * The corrections this scholar has asked for, and what happened to each.
 *
 * ── Why this page exists at all ────────────────────────────────────────────
 * Archivyn publishes claims about named individuals curated from public
 * sources. A scholar who reports that something about them is wrong is
 * exercising a right of reply, and a right of reply nobody answers visibly is
 * not one. Until this view existed, a request went in and the person who made
 * it had no way to learn the outcome.
 *
 * Never cached: the whole value is that the status shown is the current one.
 */
export async function getScholarCorrections() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();

  if (!cookieHeader) {
    return null;
  }

  let response;

  try {
    response = await fetch(`${AUTH_API_URL}/api/profile/suggestions`, {
      method: "GET",
      headers: { Cookie: cookieHeader },
      cache: "no-store",
    });
  } catch {
    /* Unreachable is not the same as "you have never asked for anything". */
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
