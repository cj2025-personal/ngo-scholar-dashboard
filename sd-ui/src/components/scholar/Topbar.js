"use client";

import Image from "next/image";
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

/**
 * The bar, matched to the learner dashboard's.
 *
 * ── What it is copied from ─────────────────────────────────────────────────
 * `user-dashboard/frontend`: `K12TopBar` + `PlatformIdentity` for the utility
 * row, `DashboardTopNav` for the navigation row, and the CSS behind them.
 * Both apps sit under one brand and a scholar who moves between them should
 * not feel they have changed product.
 *
 * Two rows, because the learner dashboard has two and they do different jobs.
 * The utility row is who you are and what you are looking for: the lockup, the
 * platform and the mode it is in, one search, and the account. The navigation
 * row is where you can go. Putting both in one strip is what makes a bar look
 * like a toolbar.
 *
 * Neither row is pinned. They scroll away with the page, as the reference's do
 * — on a reading and writing surface the header is chrome you pass on the way
 * in, not a permanent shelf over every card.
 *
 * ── Where it differs, and why it has to ────────────────────────────────────
 * The learner's bar names the platform and the mode it is running in beside
 * the lockup, because that mode decides what its search returns. A scholar
 * has no such scope, so there is nothing for it to say and it is not here:
 * the lockup stands alone.
 *
 * The learner's navigation row ends with Help. This one ends with the action
 * that starts work, because that is the thing a scholar comes here to do.
 *
 * ── The search ─────────────────────────────────────────────────────────────
 * Closed, it is a trigger. Opened, the trigger becomes a live field in the
 * same place and the results hang from it — a dropdown at the search bar, not
 * a palette floating in the middle of the screen, because it is a list of
 * what you are typing at rather than a separate place you have gone to.
 *
 * The reference searches the whole archive through its own service; this one
 * searches what this app can answer for without one: the places a scholar can
 * go, and it says so. It is deliberately not a box that looks like it searches
 * your papers and does nothing, which is what used to sit here.
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
  { label: "New story", href: "/editorial/new", icon: HiOutlinePencilSquare, hint: "Draft an article from one of your papers" },
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

export default function Topbar({ activeHref = "/", me = { initials: "SC", name: "Scholar" } }) {
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
    <>
      {/* ── Utility row: who you are, what you are looking for ── */}
      <header className="nb-utility">
        <div className="nb-utility__inner">
          <div className="nb-identity">
            <Link href="/" className="nb-brand" aria-label="Archivyn — home">
              <Image
                src="/archivyn-full-nav.png"
                alt="Archivyn"
                width={518}
                height={138}
                className="nb-lockup"
                priority
              />
            </Link>
          </div>

          <div className={searchOpen ? "nb-search is-open" : "nb-search"} ref={searchRef}>
            {searchOpen ? (
              <SearchOpen onClose={closeSearch} />
            ) : (
              <button type="button" className="nb-search__trigger" onClick={() => setSearchOpen(true)}>
                <HiOutlineMagnifyingGlass size={16} aria-hidden />
                <span>Search your work…</span>
                <kbd>Ctrl K</kbd>
              </button>
            )}
          </div>

          <div className="nb-actions">
            <button type="button" className="nb-iconbtn" aria-label="Notifications">
              <HiOutlineBell size={18} aria-hidden />
              <span className="nb-dot" aria-hidden />
            </button>
            <AccountMenu me={me} />
          </div>
        </div>
      </header>

      {/* ── Navigation row: where you can go ── */}
      <nav className="nb-nav" aria-label="Sections">
        <div className="nb-nav__inner">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={item.href === activeHref ? "nb-nav__link is-active" : "nb-nav__link"}
              aria-current={item.href === activeHref ? "page" : undefined}
            >
              <item.icon size={17} aria-hidden />
              {item.label}
            </Link>
          ))}
          <div className="nb-nav__end">
            <Link href="/editorial/new" className="nb-nav__cta">
              <HiOutlinePencilSquare size={16} aria-hidden />
              New story
            </Link>
          </div>
        </div>
      </nav>

    </>
  );
}
