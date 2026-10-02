"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  HiOutlineBell,
  HiOutlineBookOpen,
  HiOutlineDocumentText,
  HiOutlineHome,
  HiOutlineMagnifyingGlass,
  HiOutlineMicrophone,
  HiOutlinePencilSquare,
  HiOutlineUser,
} from "react-icons/hi2";

import WriteWithKivyn from "@/components/kivyn/WriteWithKivyn";
import { AGENT_NAME } from "@/lib/kivyn/pose.mjs";

/**
 * The bar: one row, 64px, the brand on the left and the work on the right.
 *
 * ── Why one row ────────────────────────────────────────────────────────────
 * It used to be two stacked rows, 112px together — a utility row for the
 * lockup, search and account, and a navigation row under it. On a laptop the
 * page shows about 600px without scrolling, and a fifth of that went to
 * chrome before a single card. One row holds the same things: the lockup,
 * the five places a scholar goes as pills, and at the end the search and the
 * account. On a phone the pills move to a second, swipeable row of their own.
 *
 * ── The door to writing ────────────────────────────────────────────────────
 * "Write a story with Kivyn" (WriteWithKivyn) is in the bar only where a page
 * passes `write`, which today is Stories alone: the list of what you have
 * written has no other way to start the next one. Everywhere else it would
 * be in the way. The Studio carries it as a nudge in the page; the new story
 * and a story's own page are already the editor; Papers starts a story from
 * each paper's row; Podcasts, Profile, what Archivyn says about you and Where
 * you stand are not about writing.
 *
 * It is not pinned. It scrolls away with the page — on a reading and writing
 * surface the header is chrome you pass on the way in, and the editor's own
 * bar is the one that stays.
 *
 * ── The search ─────────────────────────────────────────────────────────────
 * Closed, it is a compact trigger (just the glass on a narrow screen).
 * Opened, a field and its results drop from it over the page, so nothing in
 * the bar moves under the pointer. It searches the places a scholar can go
 * and says so: it is deliberately not a box that looks like it searches your
 * papers and does nothing.
 *
 * ── The bell ───────────────────────────────────────────────────────────────
 * There are no notifications yet, so it carries no unread dot. A dot that is
 * always lit says "something is waiting" when nothing is.
 */

const AUTH_API_URL =
  process.env.NEXT_PUBLIC_AUTH_API_URL || "http://localhost:4100";

/* Five areas, in the order a scholar meets them: what needs me, what we hold
   of my work, what I have written, what has been recorded, who I am. "What
   this platform already says about me" (/content) is reached from Studio and
   Profile rather than the bar, so the bar stays about the work. */
const NAV = [
  { label: "Studio", href: "/", icon: HiOutlineHome, hint: "What needs you today" },
  { label: "Papers", href: "/papers", icon: HiOutlineDocumentText, hint: "The work we hold of yours" },
  { label: "Stories", href: "/editorial", icon: HiOutlineBookOpen, hint: "What you have written" },
  { label: "Podcasts", href: "/podcasts", icon: HiOutlineMicrophone, hint: "What has been recorded" },
  { label: "Profile", href: "/profile", icon: HiOutlineUser, hint: "Who you are here" },
];

const ACTIONS = [
  /* The same door as the Studio's nudge and the bar's button, by the same name. */
  { label: `Write a story with ${AGENT_NAME}`, href: "/editorial/new", icon: HiOutlinePencilSquare, hint: "This is where your articles are written" },
];

/** Close on outside pointer and on Escape. Both bars need it; neither owns it. */
function useDismiss(ref, open, close) {
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (ref.current && !ref.current.contains(event.target)) close();
    };
    const onKey = (event) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, open, close]);
}

/**
 * The open state of the search: the trigger has become a live field, and the
 * results hang from it.
 *
 * Mounted only while it is open, so each opening starts empty without an
 * effect resetting state after the fact — which React now rightly treats as
 * an error, because it renders once with the old query before clearing it.
 */
function SearchOpen({ onClose }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);

  const results = useMemo(() => {
    const all = [...NAV, ...ACTIONS];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((r) => `${r.label} ${r.hint}`.toLowerCase().includes(q));
  }, [query]);

  const go = useCallback(
    (href) => {
      onClose();
      router.push(href);
    },
    [onClose, router],
  );

  return (
    <>
      {/* The trigger's twin: same height, border and radius, so opening the
          search does not move the thing you clicked. */}
      <label className="nb-search__field">
        <HiOutlineMagnifyingGlass size={16} aria-hidden />
        <input
          /* eslint-disable-next-line jsx-a11y/no-autofocus -- the scholar just
             opened a search, by click or by Ctrl-K; the caret belongs here and
             nowhere else. */
          autoFocus
          value={query}
          placeholder="Search your work…"
          aria-label="Search"
          role="combobox"
          aria-expanded="true"
          aria-controls="nb-search-results"
          aria-autocomplete="list"
          onChange={(e) => { setQuery(e.target.value); setCursor(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
            if (e.key === "Enter" && results[cursor]) { e.preventDefault(); go(results[cursor].href); }
          }}
        />
        <kbd>Esc</kbd>
      </label>

      {/* Hangs from the field rather than floating in the middle of the
          screen: it is a list of what you are typing at, not a separate
          place you have gone to. */}
      <div className="nb-search__panel">
        {results.length ? (
          <ul className="nb-search__list" id="nb-search-results" role="listbox" aria-label="Results">
            {results.map((r, i) => (
              <li key={r.href}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === cursor}
                  className={i === cursor ? "nb-search__row on" : "nb-search__row"}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => go(r.href)}
                >
                  <r.icon size={16} aria-hidden />
                  <span><b>{r.label}</b><em>{r.hint}</em></span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="nb-search__empty">Nothing here by that name.</p>
        )}
        {/* Said plainly rather than left to be discovered by typing a paper's
            title and getting nothing back. */}
        <p className="nb-search__note">Searches the places you can go. Your papers and stories are not searched from here yet.</p>
      </div>
    </>
  );
}

function AccountMenu({ me }) {
  const router = useRouter();
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);

  async function handleLogout() {
    setPending(true);
    try {
      await fetch(`${AUTH_API_URL}/api/auth/logout`, { method: "POST", credentials: "include" });
    } catch {
      // proceed to login regardless
    }
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="nb-acct" ref={ref}>
      <button
        type="button"
        className="nb-avatar"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        onClick={() => setOpen((v) => !v)}
      >
        {me.initials}
      </button>
      {open ? (
        <div className="nb-menu" role="menu">
          <div className="nb-menu__id">
            <p>{me.name}</p>
            {me.institution ? <span>{me.institution}</span> : null}
          </div>
          <div className="nb-menu__rule" />
          <Link href="/profile" className="nb-menu__item" role="menuitem" onClick={close}>Profile</Link>
          <div className="nb-menu__rule" />
          <button
            type="button"
            className="nb-menu__item nb-menu__item--danger"
            role="menuitem"
            onClick={handleLogout}
            disabled={pending}
          >
            {pending ? "Logging out…" : "Log out"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/* The compact lockup (the mark and the word, no tagline: at bar size the
   tagline would be 5px tall). Width and height are the file's viewBox, so the
   box is reserved before it loads; CSS sets the drawn height. */
const LOCKUP = { src: "/brand/archivyn-lockup-compact.svg", width: 748.5, height: 225.83 };

export default function Topbar({ activeHref = "/", me = { initials: "SC", name: "Scholar" }, write = false }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef(null);
  const closeSearch = useCallback(() => setSearchOpen(false), []);
  /* The wrapper holds the dismiss, not the open subtree, so clicking the field
     itself does not count as clicking outside it. */
  useDismiss(searchRef, searchOpen, closeSearch);

  /* The reference offers Ctrl-K and says so on the trigger, so this does too
     rather than printing a shortcut that does nothing. */
  useEffect(() => {
    const onKey = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="nb-bar">
      <div className="nb-bar__inner">
        <Link href="/" className="nb-brand" aria-label="Archivyn — home">
          {/* Vector, from scripts/brand/archivyn_logo.py: sharp at every size
              and density. A plain <img>, because next/image has nothing to
              optimise in an SVG. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={LOCKUP.src}
            alt="Archivyn"
            width={LOCKUP.width}
            height={LOCKUP.height}
            className="nb-lockup"
            fetchPriority="high"
          />
        </Link>

        <nav className="nb-nav" aria-label="Sections">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={item.href === activeHref ? "nb-nav__link is-active" : "nb-nav__link"}
              aria-current={item.href === activeHref ? "page" : undefined}
            >
              <item.icon size={16} aria-hidden />
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="nb-end">
          <div className={searchOpen ? "nb-search is-open" : "nb-search"} ref={searchRef}>
            <button type="button" className="nb-search__trigger" onClick={() => setSearchOpen(true)} aria-label="Search" aria-expanded={searchOpen}>
              <HiOutlineMagnifyingGlass size={16} aria-hidden />
              <span className="nb-search__label">Search</span>
              <kbd>Ctrl K</kbd>
            </button>
            {searchOpen ? (
              <div className="nb-search__pop">
                <SearchOpen onClose={closeSearch} />
              </div>
            ) : null}
          </div>
          <button type="button" className="nb-iconbtn" aria-label="Notifications">
            <HiOutlineBell size={18} aria-hidden />
          </button>
          {/* Only where a page asks for it: see `write` above. */}
          {write ? <WriteWithKivyn /> : null}
          <AccountMenu me={me} />
        </div>
      </div>
    </header>
  );
}
