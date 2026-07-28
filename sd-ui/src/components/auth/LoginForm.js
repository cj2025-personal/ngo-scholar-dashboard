"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

const AUTH_API_URL =
  process.env.NEXT_PUBLIC_AUTH_API_URL || "http://localhost:4000";

export default function LoginForm({ nextPath }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    const response = await fetch(`${AUTH_API_URL}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({
        email,
        password,
      }),
    });

    if (!response.ok) {
      let message = "Unable to sign in.";

      try {
        const payload = await response.json();
        message = payload.error || message;
      } catch {
        message = "Unable to sign in.";
      }

      setError(message);
      return;
    }

    startTransition(() => {
      router.replace(nextPath || "/");
      router.refresh();
    });
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <label className="auth-field">
        <span>Email</span>
        <input
          type="email"
          name="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="scholar@archivyn.com"
          required
        />
      </label>

      <label className="auth-field">
        <span>Password</span>
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Enter your password"
          required
        />
      </label>

      {error ? <p className="auth-error">{error}</p> : null}

      <button type="submit" className="auth-submit" disabled={isPending}>
        {isPending ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
