"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FiAlertCircle, FiCheckCircle, FiLock } from "react-icons/fi";

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

/** Setting the password of an invited scholar's account, in the sign-in shell's form. */
export default function ClaimForm({ token }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
      setError("We couldn't reach Proj Arch. Check your connection and try again.");
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
      <div className="authshell-banner is-success" role="status">
        <FiCheckCircle size={18} aria-hidden="true" className="authshell-banner-icon" />
        <div>
          <h2 className="authshell-done-title">Your account is ready</h2>
          <div className="authshell-banner-detail">Sign in with the password you just chose.</div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      {error ? (
        <div className="authshell-banner is-error" role="alert">
          <FiAlertCircle size={18} aria-hidden="true" className="authshell-banner-icon" />
          <div>
            <strong>We couldn’t set up your account.</strong>
            <div className="authshell-banner-detail">{error}</div>
          </div>
        </div>
      ) : null}

      <div className="authshell-field">
        <label htmlFor="claim-password" className="authshell-label">
          Password
        </label>
        <div className="authshell-input-wrap">
          <FiLock size={16} className="authshell-input-icon" aria-hidden="true" />
          <input
            id="claim-password"
            type={showPassword ? "text" : "password"}
            name="password"
            autoComplete="new-password"
            className="authshell-input authshell-input-with-icon authshell-input-with-trailing"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={submitting}
            required
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="authshell-input-trailing"
            aria-pressed={showPassword}
            aria-controls="claim-password claim-confirm"
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>
      </div>

      <ul className="authshell-rules" aria-live="polite">
        {RULES.map((rule) => {
          const met = rule.test(password);
          return (
            <li key={rule.label} className={met ? "is-met" : undefined}>
              <span aria-hidden="true">{met ? "✓" : "•"}</span> {rule.label}
            </li>
          );
        })}
      </ul>

      <div className="authshell-field">
        <label htmlFor="claim-confirm" className="authshell-label">
          Confirm password
        </label>
        <div className="authshell-input-wrap">
          <FiLock size={16} className="authshell-input-icon" aria-hidden="true" />
          <input
            id="claim-confirm"
            type={showPassword ? "text" : "password"}
            name="confirmPassword"
            autoComplete="new-password"
            className="authshell-input authshell-input-with-icon"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            disabled={submitting}
            required
          />
        </div>
        {mismatch ? (
          <p className="authshell-error" role="alert">
            The two passwords don&rsquo;t match.
          </p>
        ) : null}
      </div>

      <div className="authshell-actions is-stacked">
        <button
          type="submit"
          className="authshell-btn authshell-btn-primary is-block"
          disabled={!ready || submitting || isPending}
        >
          {submitting ? "Setting up…" : "Create my account"}
        </button>
      </div>
    </form>
  );
}
