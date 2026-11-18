"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FiAlertCircle, FiLock, FiMail } from "react-icons/fi";

import { PRODUCT_NAME } from "@/lib/brand";

const AUTH_API_URL =
  process.env.NEXT_PUBLIC_AUTH_API_URL || "http://localhost:4000";

/**
 * The scholar's sign-in, in the public site's form (its researcher sign-in at
 * projarch.org/for-researchers/login): the same fields, words and messages.
 * Signs in against this studio's API and lands on `nextPath` inside it.
 */
export default function LoginForm({ nextPath }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [isPending, startTransition] = useTransition();
  const busy = submitting || isPending;

  async function handleSubmit(event) {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (!email.trim() || !password) {
      setError("Enter the email and password of your scholar account.");
      return;
    }
    setSubmitting(true);

    let response;
    try {
      response = await fetch(`${AUTH_API_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: email.trim(), password }),
      });
    } catch {
      setError(`${PRODUCT_NAME} could not be reached. Please try again in a moment.`);
      setSubmitting(false);
      return;
    }

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setError(
        typeof payload?.error === "string" && payload.error
          ? payload.error
          : "That email and password don’t match a scholar account."
      );
      setSubmitting(false);
      return;
    }

    startTransition(() => {
      router.replace(nextPath || "/");
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      {error ? (
        <div className="authshell-banner is-error" role="alert">
          <FiAlertCircle size={18} aria-hidden="true" className="authshell-banner-icon" />
          <div>
            <strong>We couldn’t sign you in.</strong>
            <div className="authshell-banner-detail">{error}</div>
          </div>
        </div>
      ) : null}

      <div className="authshell-field">
        <label htmlFor="scholar-email" className="authshell-label">
          Email
        </label>
        <div className="authshell-input-wrap">
          <FiMail size={16} className="authshell-input-icon" aria-hidden="true" />
          <input
            id="scholar-email"
            type="email"
            name="email"
            autoComplete="email"
            placeholder="you@university.edu"
            className="authshell-input authshell-input-with-icon"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            required
          />
        </div>
      </div>

      <div className="authshell-field">
        <label htmlFor="scholar-password" className="authshell-label">
          Password
        </label>
        <div className="authshell-input-wrap">
          <FiLock size={16} className="authshell-input-icon" aria-hidden="true" />
          <input
            id="scholar-password"
            type={showPassword ? "text" : "password"}
            name="password"
            autoComplete="current-password"
            placeholder="Your password"
            className="authshell-input authshell-input-with-icon authshell-input-with-trailing"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            required
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="authshell-input-trailing"
            aria-pressed={showPassword}
            aria-controls="scholar-password"
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>
      </div>

      <div className="authshell-actions is-stacked">
        <button type="submit" className="authshell-btn authshell-btn-primary is-block" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </div>

      <p className="authshell-switch">
        Joining is by invitation. <Link href="/">About {PRODUCT_NAME}</Link>
      </p>
    </form>
  );
}
