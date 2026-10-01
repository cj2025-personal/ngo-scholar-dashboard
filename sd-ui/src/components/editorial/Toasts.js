"use client";

import { useEffect, useRef, useState } from "react";
import { FaCheck, FaCircleInfo, FaTriangleExclamation, FaXmark } from "react-icons/fa6";

/**
 * Messages from the page, floating above it instead of pushing it down.
 *
 * A save, a publish, a check coming back: said in a card at the top right,
 * where the eye goes after pressing a button, and gone again on its own once
 * it has been read — longer messages stay longer, and a pointer resting on
 * one holds it. Anything that went wrong stays until it is dismissed, and
 * anything that is still happening stays until it is done.
 *
 * The cards keep the `sc-write-msg is-ok` / `is-error` classes the page has
 * always used, so everything that looks for them still finds them.
 */

const ICON = { ok: <FaCheck size={12} />, error: <FaTriangleExclamation size={12} />, info: <FaCircleInfo size={12} /> };

/** Long enough to read: a second per twelve words or so, between four and fourteen seconds. */
const readingTime = (text) => Math.min(14000, Math.max(4000, String(text || "").split(/\s+/).length * 450));

export function Toast({ kind = "ok", text, children = null, onDismiss = null, autoHide = false, busy = false, role = null }) {
  const [held, setHeld] = useState(false);
  const left = useRef(null);
  useEffect(() => {
    if (!autoHide || !onDismiss || held) return undefined;
    const ms = left.current ?? readingTime(text);
    const started = Date.now();
    const t = setTimeout(onDismiss, ms);
    return () => { clearTimeout(t); left.current = Math.max(1500, ms - (Date.now() - started)); };
  }, [autoHide, onDismiss, held, text]);
  useEffect(() => { left.current = null; }, [text]);
  return (
    <div
      className={`sc-write-msg is-${kind === "error" ? "error" : "ok"} ws-toast is-${kind}`}
      role={role || (kind === "error" ? "alert" : "status")}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
    >
      <span className="ws-toast-ic" aria-hidden>{busy ? <span className="ag-spinner" /> : ICON[kind] || ICON.info}</span>
      <div className="ws-toast-body">{text}{children}</div>
      {onDismiss ? <button type="button" className="ws-toast-x" aria-label="Dismiss" onClick={onDismiss}><FaXmark size={12} aria-hidden /></button> : null}
    </div>
  );
}

export function ToastStack({ children }) {
  return <div className="ws-toasts" aria-live="polite">{children}</div>;
}
