import "server-only";

import { cookies } from "next/headers";

const AUTH_API_URL =
  process.env.AUTH_API_URL ||
  process.env.NEXT_PUBLIC_AUTH_API_URL ||
  "http://localhost:4000";

async function fetchEditorial(path) {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();

  if (!cookieHeader) {
    return null;
  }

  let response;

  try {
    response = await fetch(`${AUTH_API_URL}${path}`, {
      method: "GET",
      headers: {
        Cookie: cookieHeader,
      },
      cache: "no-store",
    });
  } catch {
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

export async function getEditorialStories(status = "all") {
  const suffix =
    status && status !== "all"
      ? `/api/editorial-stories?status=${encodeURIComponent(status)}`
      : "/api/editorial-stories";

  return (await fetchEditorial(suffix)) || { stories: [] };
}

export async function getEditorialStory(storyId) {
  if (!storyId) {
    return null;
  }

  return fetchEditorial(`/api/editorial-stories/${storyId}`);
}

export async function getPublishedStoryBySlug(slug) {
  if (!slug) {
    return null;
  }

  let response;

  try {
    response = await fetch(
      `${AUTH_API_URL}/api/editorial-stories/public/slug/${encodeURIComponent(slug)}`,
      {
        method: "GET",
        cache: "no-store",
      },
    );
  } catch {
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
