"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

const AUTH_API_URL =
  process.env.NEXT_PUBLIC_AUTH_API_URL || "http://localhost:4000";

/**
 * The password rules, stated before they are broken.
 *
 * The API enforces these and returns a clear message, so duplicating them is a
 * small correctness risk — the two could drift. It is worth it: a researcher
 * typing a password, submitting, and being told after the round trip that it
 * needed a number will type a second guess rather than read the rule. Showing
 * the requirements up front costs one duplicated list and removes that loop.
 *
 * The server remains the authority. Nothing here decides anything.
 */
const RULES = [
  { label: "at least 12 characters", test: (v) => v.length >= 12 },
  { label: "a lowercase letter", test: (v) => /[a-z]/.test(v) },
  { label: "an uppercase letter", test: (v) => /[A-Z]/.test(v) },
  { label: "a number", test: (v) => /[0-9]/.test(v) },
  { label: "a special character", test: (v) => /[^A-Za-z0-9]/.test(v) },
];

export default function ClaimForm({ token, scholarName }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [isPending, startTransition] = useTransition();

  const unmet = RULES.filter((rule) => !rule.test(password));
  const mismatch = confirm.length > 0 && password !== confirm;
  const ready = password.length > 0 && unmet.length === 0 && !mismatch && confirm.length > 0;

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    /* Guarded rather than merely disabled. A disabled button is a hint, not a
       control — the form can still be submitted by keyboard in some browsers,
       and re-entering this handler mid-flight would redeem a single-use
       invitation twice and show the second failure as an error. */
    if (!ready || submitting) return;
    setSubmitting(true);

    let response;

    try {
      response = await fetch(
        `${AUTH_API_URL}/api/invites/${encodeURIComponent(token)}/redeem`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        },
      );
    } catch {
      setError("We couldn't reach Archivyn. Check your connection and try again.");
      setSubmitting(false);
      return;
    }

    if (!response.ok) {
      let message = "We couldn't finish setting up your account.";
      try {
        const payload = await response.json();
        message = payload.message || payload.error || message;
      } catch {
        /* Keep the fallback. */
      }
      setError(message);
      /* Not re-enabled on 409 — the invitation is spent, and letting someone
         press the button again just produces the same refusal. */
      setSubmitting(response.status === 409);
      return;
    }

    setDone(true);
    startTransition(() => {
      router.replace("/login");
      router.refresh();
    });
  }

  if (done) {
    return (
      <div className="auth-card auth-card--single">
        <h1 className="auth-card__title">Your account is ready</h1>
        <p className="auth-card__lede">
          Sign in with the password you just chose.
        </p>
      </div>
    );
  }

  return (
    <form className="auth-card auth-card--single" onSubmit={handleSubmit} noValidate>
      <h1 className="auth-card__title">Set your password</h1>
      <p className="auth-card__lede">
        You&rsquo;re setting up the Archivyn account for{" "}
        <strong>{scholarName || "your scholar profile"}</strong>.
      </p>

      <label className="auth-field">
        <span className="auth-field__label">Password</span>
        <input
          type="password"
          name="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={submitting}
          required
        />
      </label>

      <ul className="auth-rules" aria-live="polite">
        {RULES.map((rule) => {
          const met = rule.test(password);
          return (
            <li
              key={rule.label}
              className={met ? "auth-rules__item is-met" : "auth-rules__item"}
            >
              <span aria-hidden="true">{met ? "✓" : "•"}</span> {rule.label}
            </li>
          );
        })}
      </ul>

      <label className="auth-field">
        <span className="auth-field__label">Confirm password</span>
        <input
          type="password"
          name="confirmPassword"
          autoComplete="new-password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          disabled={submitting}
          required
        />
      </label>

      {mismatch ? (
        <p className="auth-error" role="alert">
          The two passwords don&rsquo;t match.
        </p>
      ) : null}

      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}

      <button type="submit" className="auth-submit" disabled={!ready || submitting || isPending}>
        {submitting ? "Setting up…" : "Create my account"}
      </button>
    </form>
  );
}
