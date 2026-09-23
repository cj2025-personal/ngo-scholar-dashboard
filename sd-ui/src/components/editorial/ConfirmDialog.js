"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

/**
 * The one way this product asks "are you sure".
 *
 * It used to ask in place: the row's buttons were replaced by a red-tinted
 * strip carrying the question, the confirm and the way out. That strip was
 * wider than the space it appeared in, so it wrapped, pushed the row's own
 * controls around and moved the rest of the list down the page — a layout
 * shift at the exact moment the scholar is about to click something
 * irreversible, with the new Delete landing near where the old one was.
 *
 * A modal is the honest shape for this. It stops the page, states the
 * consequence in a sentence, and offers two ways out of equal size. It is a
 * native <dialog> opened with showModal(), which is what makes the rest of
 * the page inert, traps the tab ring, closes on Escape and paints in the top
 * layer — none of which a div can be made to do reliably, and all of which a
 * confirmation needs.
 *
 * Mounted only while it is asking: the parent renders it, it opens itself.
 *
 * It renders through a portal to <body>, which is not a detail. The buttons
 * that open it sit in row toolbars, and one of those — the editorial list's —
 * is `pointer-events: none` until its row is hovered. A dialog nested inside
 * that toolbar inherits the rule, and opening the dialog moves the pointer
 * off the row: the panel drew correctly, in the top layer, and every click on
 * it went through to the page behind. Painting in the top layer does not
 * exempt an element from what its DOM ancestors say about it. A portal does.
 *
 * @param {string}   title         the question, as a heading
 * @param {node}     children      what happens if they say yes, in a sentence
 * @param {string}   confirmLabel  the destructive verb, never "OK"
 * @param {string}   busyLabel     the same verb, in progress
 * @param {boolean}  busy          a request is in flight
 * @param {string}   error         a refusal from the server, shown in place
 * @param {Function} onConfirm
 * @param {Function} onCancel
 */
export default function ConfirmDialog({
  title,
  children,
  confirmLabel = "Delete",
  busyLabel = "Deleting…",
  busy = false,
  error = "",
  onConfirm,
  onCancel,
}) {
  const ref = useRef(null);
  const id = useId();
  /* `busy` is read inside the cancel handler, which is attached once; a ref
     keeps that handler looking at the current value rather than the one it
     closed over. Written in an effect, never during a render. */
  const busyRef = useRef(busy);
  useEffect(() => { busyRef.current = busy; }, [busy]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (!el.open) el.showModal();

    /* Escape, and the close button no browser draws. Refused while a delete
       is in flight: the request is already gone, and closing the dialog
       would leave the scholar watching a row that is about to vanish with
       no idea why. */
    const onCancelEvent = (e) => {
      e.preventDefault();
      if (!busyRef.current) onCancel();
    };
    el.addEventListener("cancel", onCancelEvent);
    return () => {
      el.removeEventListener("cancel", onCancelEvent);
      if (el.open) el.close();
    };
  }, [onCancel]);

  /* The backdrop is part of the dialog element, so a click that lands on the
     dialog itself rather than on the panel inside it is a click outside. */
  const onBackdrop = (e) => {
    if (e.target === ref.current && !busy) onCancel();
  };

  /* Never rendered on the server — the parent mounts it from a click — so the
     guard is for safety, not for a render that happens. */
  if (typeof document === "undefined") return null;

  return createPortal(
    /* `alertdialog`, not the element's own implicit `dialog`: this interrupts
       to say something is about to be destroyed, which is the distinction the
       two roles exist to draw. */
    <dialog
      ref={ref}
      className="cf-dialog"
      onClick={onBackdrop}
      role="alertdialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-body`}
    >
      <div className="cf-panel">
        <h2 id={`${id}-title`} className="cf-title">{title}</h2>
        <div id={`${id}-body`} className="cf-body">{children}</div>
        {error ? <p className="cf-error" role="alert">{error}</p> : null}
        <div className="cf-actions">
          {/* The way out holds the focus. A dialog that opens with the
              destructive button under the return key is a trap for anyone
              who answered it with the keyboard. */}
          <button type="button" className="cf-btn" disabled={busy} onClick={onCancel} autoFocus>
            Cancel
          </button>
          <button type="button" className="cf-btn is-danger" disabled={busy} onClick={onConfirm}>
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
