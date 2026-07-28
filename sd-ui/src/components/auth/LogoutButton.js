"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

const AUTH_API_URL =
  process.env.NEXT_PUBLIC_AUTH_API_URL || "http://localhost:4000";

export default function LogoutButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  async function handleLogout() {
    await fetch(`${AUTH_API_URL}/api/auth/logout`, {
      method: "POST",
      credentials: "include",
    });

    startTransition(() => {
      router.replace("/login");
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      className="logout-button"
      onClick={handleLogout}
      disabled={isPending}
    >
      {isPending ? "Signing out..." : "Sign out"}
    </button>
  );
}
