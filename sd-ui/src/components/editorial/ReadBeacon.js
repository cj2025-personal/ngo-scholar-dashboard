"use client";

import { useEffect } from "react";

/**
 * Records that this article was read. Renders nothing.
 *
 * ── Why it is not a page-view counter ──────────────────────────────────────
 * A hit on load would tell the scholar that everyone who saw the headline and
 * left had read their work. That is the kind of number this product exists
 * not to produce: the whole publish check is an argument that nothing goes
 * out overstated, and it would be strange to hold the article to that standard
 * and then hand back an inflated figure about it.
 *
 * So a read is dwell plus movement. The reader has to still be here after
 * DWELL_MS, and to have either scrolled a quarter of the way in or been
 * given an article short enough that there was nothing to scroll. Neither
 * test is clever, and someone who leaves a tab open still counts — but it
 * separates a read from a bounce, which is the distinction the scholar cares
 * about.
 *
 * ── What it sends ──────────────────────────────────────────────────────────
 * The slug. Nothing else — no identifier is generated, kept or transmitted,
 * and the endpoint stores a per-story daily counter and nothing more. The
 * `sessionStorage` key below never leaves the reader's own browser; it is
 * there so a refresh or a jump back from another tab is not a second read.
 *
 * ── Known limits, since the number is shown to a scholar ───────────────────
 * The author reading their own published article counts, because the public
 * reader has no session to recognise them by. Tabs left open count once.
 * Scripted callers are held off by a throttle at the API and nothing more.
 * These are reads, and the dashboard says "reads" rather than "readers".
 */

const DWELL_MS = 10_000;
const SCROLL_FRACTION = 0.25;

export default function ReadBeacon({ slug }) {
  useEffect(() => {
    if (!slug) return undefined;

    const key = `sd:read:${slug}`;
    /* Private mode and blocked site data throw here rather than returning
       null, and a counter is never worth breaking someone's reading. */
    try {
      if (window.sessionStorage.getItem(key)) return undefined;
    } catch {
      /* No memory of an earlier read; at worst this counts twice. */
    }

    const api = process.env.NEXT_PUBLIC_AUTH_API_URL || "http://localhost:4000";
    const url = `${api}/api/editorial-stories/public/slug/${encodeURIComponent(slug)}/read`;

    let sent = false;
    let dwelled = false;
    let moved = false;

    function scrolledEnough() {
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - window.innerHeight;
      /* Nothing to scroll: the article fits, so staying is the whole signal. */
      if (scrollable <= 0) return true;
      return window.scrollY / scrollable >= SCROLL_FRACTION;
    }

    function send() {
      if (sent || !dwelled || !moved) return;
      sent = true;
      try {
        window.sessionStorage.setItem(key, "1");
      } catch {
        /* Fine. The API's own throttle catches the repeat. */
      }
      /* `sendBeacon` survives the reader navigating away mid-flight; `fetch`
         with `keepalive` is the fallback where it is missing. Failure is
         silent either way — a reader must never see a counter's problem. */
      if (navigator.sendBeacon?.(url)) return;
      fetch(url, { method: "POST", keepalive: true, mode: "no-cors" }).catch(() => {});
    }

    function onScroll() {
      if (moved || !scrolledEnough()) return;
      moved = true;
      send();
    }

    const timer = window.setTimeout(() => {
      dwelled = true;
      /* A short article read without scrolling would otherwise wait for a
         scroll event that never comes. */
      if (scrolledEnough()) moved = true;
      send();
    }, DWELL_MS);

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
    };
  }, [slug]);

  return null;
}
