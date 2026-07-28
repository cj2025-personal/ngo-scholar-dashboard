import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const AUTH_API_URL =
  process.env.AUTH_API_URL ||
  process.env.NEXT_PUBLIC_AUTH_API_URL ||
  "http://localhost:4000";

export async function getServerSession() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();

  if (!cookieHeader) {
    return null;
  }

  let response;

  try {
    response = await fetch(`${AUTH_API_URL}/api/auth/me`, {
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

export async function requireServerSession() {
  const session = await getServerSession();

  if (!session?.authenticated) {
    redirect("/login");
  }

  return session;
}
