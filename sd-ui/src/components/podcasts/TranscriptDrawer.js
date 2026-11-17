"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { HiXMark } from "react-icons/hi2";

import { transcriptNav } from "@/lib/transcriptNav";

/**
 * An episode's transcript as a side panel over the Podcasts list.
 *
 * ── Why a panel, and how it behaves (2026-11-16) ───────────────────────────
 * Reading a transcript is long, read-mostly work tied to one row of a list,
 * which is what side panels (Carbon side panel, Atlassian drawer, Fluent
 * Drawer, Material side sheet) are for: the list stays in view behind it, and
 * closing it puts the scholar back where they were. It is modal (the list
 * behind cannot be used while it is open) because the panel has its own
 * player and actions and is wide enough to cover most of the row.
 *
 * Built on the native <dialog> opened with showModal(), which gives what the
 * WAI-ARIA dialog pattern asks for without re-implementing it: the rest of
 * the page inert, focus kept inside, Esc to close, role "dialog" with
 * aria-modal. On top of that:
 * - It is labelled by its title, and focus starts on that title, so a screen
 *   reader starts at the top of a long read instead of on the close button.
 * - Esc, the close button and a click on the dimmed page all close it, by
 *   changing the address (see transcriptNav): back to the list when it was
 *   opened from there, otherwise the list's address in place of this one.
 * - Closing returns focus to the "Read the transcript" that opened it, by
 *   hand: WebKit does not restore it for a dialog opened from a mouse click.
 * - The page behind does not scroll while it is open: scrolling is contained
 *   in the dialog (overscroll-behavior), not stopped by hiding the page's
 *   scrollbar, which would shift the list sideways under the panel.
 * - It slides in, unless the reader asked for less motion.
 * - Header (title, close) and footer (what to do if it is wrong) stay put;
 *   only the transcript between them scrolls.
 */
export default function TranscriptDrawer({ episodeId, title, meta, footer, children }) {
  const router = useRouter();
  const dialog = useRef(null);
  const heading = useRef(null);
  const closing = useRef(false);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    if (transcriptNav.fromList) {
      transcriptNav.fromList = false;
      router.back();
    } else {
      router.replace("/podcasts", { scroll: false });
    }
  }, [router]);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return undefined;
    closing.current = false;
    if (!el.open) el.showModal();
    heading.current?.focus();

    /* Esc: close by address, not by the dialog's own close, so the URL and the screen agree. */
    const onCancel = (event) => {
      event.preventDefault();
      close();
    };
    /* A click on the dimmed page lands on the dialog element itself, outside its panel. */
    const onClick = (event) => {
      if (event.target === el) close();
    };
    el.addEventListener("cancel", onCancel);
    el.addEventListener("click", onClick);
    return () => {
      el.removeEventListener("cancel", onCancel);
      el.removeEventListener("click", onClick);
      if (el.open) el.close();
      /* Hand focus back to the control that opened it, once the list has re-rendered. */
      requestAnimationFrame(() => {
        const trigger = document.querySelector(`[data-transcript-trigger="${CSS.escape(String(episodeId))}"]`);
        trigger?.focus();
      });
    };
  }, [episodeId, close]);

  return (
    <dialog ref={dialog} className="pod-panel" aria-labelledby="pod-panel-title">
      <div className="pod-panel__sheet">
        <header className="pod-panel__head">
          <div className="pod-panel__id">
            <p className="pod-panel__kicker">Transcript</p>
            <h2 id="pod-panel-title" ref={heading} tabIndex={-1} className="pod-panel__title">
              {title}
            </h2>
            {meta ? <p className="pod-panel__meta">{meta}</p> : null}
          </div>
          <button type="button" className="pod-panel__close" onClick={close} aria-label="Close the transcript">
            <HiXMark size={20} aria-hidden />
          </button>
        </header>
        <div className="pod-panel__body">{children}</div>
        {footer ? <footer className="pod-panel__foot">{footer}</footer> : null}
      </div>
    </dialog>
  );
}
