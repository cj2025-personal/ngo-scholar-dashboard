"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HiCheck, HiOutlinePencilSquare, HiXMark } from "react-icons/hi2";

const AUTH_API_URL =
  process.env.NEXT_PUBLIC_AUTH_API_URL || "http://localhost:4100";

const KINDS = [
  { value: "correction", label: "Correction" },
  { value: "outdated", label: "Outdated / needs update" },
  { value: "issue", label: "Issue with this text" },
  { value: "addition", label: "Something to add" },
  { value: "other", label: "Other" },
];

// Module-level, reference-counted body scroll lock shared by every modal
// instance so overlapping opens can never leave the page permanently locked.
let scrollLockCount = 0;
let scrollLockPrev = "";
function lockScroll() {
  if (scrollLockCount === 0) {
    scrollLockPrev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  scrollLockCount += 1;
}
function unlockScroll() {
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount === 0) {
    document.body.style.overflow = scrollLockPrev;
  }
}

/**
 * "Suggest an edit": a scholar telling us something about them is wrong.
 *
 * The trigger says what it does in words. It used to be a pencil alone, and
 * a pencil on someone's own profile reads as "edit this yourself", which is
 * not what happens: the request goes to a person, and its answer appears
 * under Corrections.
 *
 * @param {object} p
 * @param {string} p.sectionKey   which part of the record this is about
 * @param {string} p.label        that part, for the dialog and the screen reader
 * @param {string} [p.currentText] what the record says now, quoted back in the request
 * @param {string} [p.text]       the visible words on the trigger
 */
export default function SuggestButton({ sectionKey, label, currentText = "", text = "Suggest an edit" }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("correction");
  const [message, setMessage] = useState("");
  const [state, setState] = useState("idle"); // idle | submitting | success | error
  const [error, setError] = useState("");

  const textareaRef = useRef(null);
  const modalRef = useRef(null);
  const triggerRef = useRef(null);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  function resetForm() {
    setKind("correction");
    setMessage("");
    setState("idle");
    setError("");
  }

  function close() {
    // Never discard an in-flight submission (matches the disabled buttons).
    if (stateRef.current === "submitting") return;
    resetForm();
    setOpen(false);
  }

  // Focus, keyboard (Escape + Tab trap), scroll lock, and focus restore all
  // live together so they set up and tear down as one unit.
  useEffect(() => {
    if (!open) return undefined;

    const timer = setTimeout(() => textareaRef.current?.focus(), 40);

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        close();
        return;
      }
      if (event.key !== "Tab") return;

      const modal = modalRef.current;
      if (!modal) return;
      const focusables = modal.querySelectorAll(
        'a[href], button:not([disabled]), textarea:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    lockScroll();

    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", onKeyDown);
      unlockScroll();
      // Return focus to the pencil that opened the modal.
      triggerRef.current?.focus();
    };
    // close/resetForm rely only on stable setters + refs, so [open] is correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handleSubmit(event) {
    event.preventDefault();
    const trimmed = message.trim();
    if (!trimmed) {
      setError("Please describe the change or issue.");
      return;
    }

    setState("submitting");
    setError("");

    try {
      const response = await fetch(`${AUTH_API_URL}/api/profile/suggestions`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sectionKey,
          fieldLabel: label,
          currentText,
          kind,
          message: trimmed,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || "We couldn't submit your suggestion.");
      }

      setState("success");
    } catch (submitError) {
      setState("error");
      setError(submitError.message || "Something went wrong. Please try again.");
    }
  }

  const submitting = state === "submitting";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="dash-btn is-ghost prof-suggest"
        aria-label={`${text}: ${label}`}
        onClick={() => setOpen(true)}
      >
        <HiOutlinePencilSquare size={15} aria-hidden />
        <span>{text}</span>
      </button>

      {open
        ? createPortal(
            <div
              className="sc-sg-overlay"
              role="presentation"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) close();
              }}
            >
              <div
                className="sc-sg-modal"
                role="dialog"
                aria-modal="true"
                aria-label={`Suggest an edit to ${label}`}
                ref={modalRef}
              >
                <header className="sc-sg-head">
                  <div>
                    <span className="sc-sg-kicker">Suggest an edit</span>
                    <h3>{label}</h3>
                  </div>
                  <button
                    type="button"
                    className="sc-sg-close"
                    aria-label="Close"
                    onClick={close}
                    disabled={submitting}
                  >
                    <HiXMark size={18} aria-hidden />
                  </button>
                </header>

                {state === "success" ? (
                  <div className="sc-sg-success">
                    <span className="sc-sg-success-ic" aria-hidden>
                      <HiCheck size={26} />
                    </span>
                    <h4>Suggestion submitted</h4>
                    <p>
                      Thank you — our editorial team will review your requested
                      change to <strong>{label}</strong>.
                    </p>
                    <button type="button" className="sc-sg-submit" onClick={close}>
                      Done
                    </button>
                  </div>
                ) : (
                  <form className="sc-sg-body" onSubmit={handleSubmit}>
                    {currentText ? (
                      <div className="sc-sg-field">
                        <span className="sc-sg-label">Current text</span>
                        <div className="sc-sg-current">{currentText}</div>
                      </div>
                    ) : null}

                    <label className="sc-sg-field">
                      <span className="sc-sg-label">Type of change</span>
                      <select
                        className="sc-sg-select"
                        value={kind}
                        onChange={(event) => setKind(event.target.value)}
                        disabled={submitting}
                      >
                        {KINDS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="sc-sg-field">
                      <span className="sc-sg-label">
                        What should change? <span className="sc-sg-req">*</span>
                      </span>
                      <textarea
                        ref={textareaRef}
                        className="sc-sg-textarea"
                        rows={5}
                        maxLength={4000}
                        placeholder="Describe the correction, the issue, or what you'd like this to say instead…"
                        value={message}
                        onChange={(event) => setMessage(event.target.value)}
                        disabled={submitting}
                      />
                    </label>

                    {error ? <p className="sc-sg-error">{error}</p> : null}

                    <div className="sc-sg-actions">
                      <button
                        type="button"
                        className="sc-sg-cancel"
                        onClick={close}
                        disabled={submitting}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="sc-sg-submit"
                        disabled={submitting}
                      >
                        {submitting ? "Submitting…" : "Submit suggestion"}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
