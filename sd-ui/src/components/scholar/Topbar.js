"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { HiChevronDown, HiOutlineBell } from "react-icons/hi2";
import { FaPen } from "react-icons/fa6";

/**
 * The bar, matched to the user dashboard's.
 *
 * ── Why this looks the way it does ─────────────────────────────────────────
 * `user-dashboard/frontend/src/components/navigation/GlobalNavbar.tsx` is the
 * design the platform settled on, and the two apps sit behind one brand: a
 * scholar who moves between them should not feel they have changed product.
 * So the shell here is that one — a floating glass pill on the page rather
 * than a bar fixed to the top of the window, the same 22px radius, the same
 * white-over-white gradient and blur, the same entrance, the same brand
 * sizing, and the same single grouped control holding the bell and the
 * avatar. The dropdown copies its measurements too.
 *
 * ── Where it deliberately differs, and why it has to ───────────────────────
 * That navbar carries a brand and an account menu and nothing else, because
 * the learner app navigates from the page body. A scholar navigates from the
 * bar: five areas and the one action that starts work. Those are kept, and
 * dressed in the same vocabulary the reference defines — the pill it uses for
 * "Back to dashboard" is the pill used here for links and for New story.
 * Removing them would match the reference and break the product.
 *
 * The search field that used to sit here is gone. It had no handler of any
 * kind: an input that looks like a promise and does nothing.
 *
 * ── Two constraints worth knowing before editing ───────────────────────────
 * The whole thing is 68px tall, recorded as `--sc-nav-height` beside the CSS,
 * because the composer sizes itself with `calc(100vh - that)`. It is not the
 * shared `--ark-topbar-height`: that token says 64px, this design measures 68
 * in both apps, and the shared sheet is changed in every repo or not at all.
 * And it scrolls away with the page, as the reference does, so nothing may
 * assume a bar is still on screen further down.
 */

const AUTH_API_URL =
  process.env.NEXT_PUBLIC_AUTH_API_URL || "http://localhost:4100";

/* Five areas, in the order a scholar meets them: what needs me, what we hold
   of my work, what I have written, what has been recorded, who I am. "What
   this platform already says about me" (/content) is reached from Studio and
   Profile rather than the bar, so the bar stays about the work. */
const NAV = [
  { label: "Studio", href: "/" },
  { label: "Papers", href: "/papers" },
  { label: "Stories", href: "/editorial" },
  { label: "Podcasts", href: "/podcasts" },
  { label: "Profile", href: "/profile" },
];

function AccountMenu({ me }) {
  const router = useRouter();
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function handleLogout() {
    setPending(true);
    try {
      await fetch(`${AUTH_API_URL}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
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
        className="nb-avatar-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Open profile menu"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="nb-avatar" aria-hidden>
          {me.initials}
        </span>
        <HiChevronDown className="nb-chev" aria-hidden />
      </button>

      {open ? (
        <div className="nb-menu" role="menu">
          <div className="nb-menu__id">
            <p>{me.name}</p>
            {me.institution ? <span>{me.institution}</span> : null}
          </div>
          <div className="nb-menu__rule" />
          <Link href="/profile" className="nb-menu__item" role="menuitem" onClick={() => setOpen(false)}>
            Profile
          </Link>
          <div className="nb-menu__rule" />
          <button
            type="button"
            className="nb-menu__item nb-menu__item--danger"
            role="menuitem"
            onClick={handleLogout}
            disabled={pending}
          >
            {pending ? "Logging out…" : "Logout"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default function Topbar({ activeHref = "/", me = { initials: "SC", name: "Scholar" } }) {
  return (
    <header className="nb-header">
      <div className="nb-container">
        <div className="nb-bar">
          <Link href="/" className="nb-brand">
            <span className="nb-logo" aria-hidden>
              {/* A plain <img>, not next/image: the mark is an SVG and
                  next/image rejects SVG unless dangerouslyAllowSVG is on,
                  which it is not. The user dashboard renders it this way for
                  the same reason. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/archivyn-logo.svg" alt="" width={64} height={64} />
            </span>
            <span className="nb-wordmark">Archivyn</span>
          </Link>

          <nav className="nb-nav" aria-label="Sections">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={item.href === activeHref ? "nb-link on" : "nb-link"}
                aria-current={item.href === activeHref ? "page" : undefined}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="nb-right">
            <Link href="/editorial/new" className="nb-cta">
              <FaPen size={12} aria-hidden />
              New story
            </Link>

            {/* Bell and avatar share one control, as in the reference. */}
            <div className="nb-cluster">
              <button type="button" className="nb-bell" aria-label="Notifications">
                <HiOutlineBell aria-hidden />
                <span className="nb-dot" aria-hidden />
              </button>
              <AccountMenu me={me} />
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
