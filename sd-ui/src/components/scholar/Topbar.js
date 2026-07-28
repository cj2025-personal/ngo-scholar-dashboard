"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  FaArrowRightFromBracket,
  FaMagnifyingGlass,
  FaPen,
  FaRegBell,
  FaRegUser,
} from "react-icons/fa6";

const AUTH_API_URL =
  process.env.NEXT_PUBLIC_AUTH_API_URL || "http://localhost:4100";

const NAV = [
  { label: "Home", href: "/" },
  { label: "Editorial", href: "/editorial" },
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
    <div className="sc-acct" ref={ref}>
      <button
        type="button"
        className="sc-me"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        onClick={() => setOpen((value) => !value)}
      >
        {me.initials}
      </button>

      {open ? (
        <div className="sc-menu" role="menu">
          <div className="sc-menu__head">
            <span className="sc-me sc-me--sm" aria-hidden>
              {me.initials}
            </span>
            <div className="sc-menu__id">
              <b>{me.name}</b>
              {me.institution ? <span>{me.institution}</span> : null}
            </div>
          </div>
          <Link href="/profile" className="sc-menu__item" role="menuitem" onClick={() => setOpen(false)}>
            <FaRegUser size={15} aria-hidden />
            Profile
          </Link>
          <button
            type="button"
            className="sc-menu__item sc-menu__item--danger"
            role="menuitem"
            onClick={handleLogout}
            disabled={pending}
          >
            <FaArrowRightFromBracket size={15} aria-hidden />
            {pending ? "Logging out…" : "Log out"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default function Topbar({ activeHref = "/", me = { initials: "SC", name: "Scholar" } }) {
  return (
    <header className="sc-topbar">
      <Link href="/" className="sc-brand">
        <Image
          src="/archivyn-logo.svg"
          alt="Archivyn"
          width={28}
          height={35}
          className="sc-logo"
          priority
        />
        <span className="wordmark">Archivyn</span>
      </Link>

      <nav className="sc-nav">
        {NAV.map((item) => (
          <Link key={item.href} href={item.href} className={item.href === activeHref ? "on" : ""}>
            {item.label}
          </Link>
        ))}
      </nav>

      <label className="sc-search">
        <FaMagnifyingGlass size={14} aria-hidden />
        <input placeholder="Search scholars, papers, topics…" aria-label="Search" />
      </label>

      <span className="sc-spacer" />

      <Link href="/editorial/new" className="sc-write">
        <FaPen size={14} aria-hidden />
        Write
      </Link>
      <button type="button" className="sc-iconbtn" aria-label="Notifications">
        <FaRegBell size={17} aria-hidden />
      </button>
      <AccountMenu me={me} />
    </header>
  );
}
