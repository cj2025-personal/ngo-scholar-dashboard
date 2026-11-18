"use client";

import { useState } from "react";

/**
 * The footer's newsletter sign-up, as the public site's (ngo-web
 * GlobalFooter.js): the same field, button and messages. It posts to this
 * app's /api/newsletter, which hands the address to the site's own endpoint,
 * so a sign-up here lands where the site's do.
 */
export default function NewsletterForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("idle"); // 'idle' | 'sending' | 'done' | 'error'
  const [message, setMessage] = useState("");

  const handleSubscribe = async (event) => {
    event.preventDefault();
    if (status === "sending") return;

    setStatus("sending");
    setMessage("");

    try {
      const response = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setStatus("error");
        setMessage(data.error || "We couldn't sign you up just now. Please try again.");
        return;
      }

      setStatus("done");
      setMessage(data.message || "You're on the list.");
      setEmail("");
    } catch {
      setStatus("error");
      setMessage("We couldn't reach the server. Please try again.");
    }
  };

  return (
    <div className="footer-newsletter-right">
      <form className="footer-newsletter-form" onSubmit={handleSubscribe} noValidate>
        <label className="footer-sr-only" htmlFor="footer-newsletter-email">
          Email address
        </label>
        <input
          id="footer-newsletter-email"
          type="email"
          name="email"
          autoComplete="email"
          placeholder="your@school.edu"
          className="footer-newsletter-input"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={status === "sending"}
        />
        <button type="submit" className="footer-newsletter-btn" disabled={status === "sending"}>
          {status === "sending" ? "Subscribing..." : <>Subscribe &rarr;</>}
        </button>
      </form>
      <span
        className={`footer-newsletter-note${status === "error" ? " is-error" : ""}${status === "done" ? " is-done" : ""}`}
        role="status"
        aria-live="polite"
      >
        {message || "No spam · Unsubscribe anytime"}
      </span>
    </div>
  );
}
