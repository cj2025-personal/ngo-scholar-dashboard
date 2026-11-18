"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import InkvynMark from "@/components/brand/InkvynMark";
import { BRAND_NAME, LOCKUP, PRODUCT_NAME } from "@/lib/brand";

/* The page's own sections, in order; each id is on its section. */
const SECTIONS = [
  { id: "editions", label: "Editions" },
  { id: "kivyn", label: "Meet Kivyn" },
  { id: "circles", label: "Circles" },
  { id: "podcasts", label: "AI podcasts" },
  { id: "joining", label: "Joining" },
];

/**
 * The front page's header, in the public site's bar (GlobalNavbar): the
 * lockup, the product's name, the page's sections and one action, Sign in.
 *
 * It stays at the top while the page scrolls, kept slim so it never takes
 * the page's room, and once the page has moved it turns to frosted glass
 * with a shadow, so it reads as lifted over what passes beneath. The section
 * being read is marked as the site marks the page you are on. Both are
 * watched with IntersectionObserver (a sentinel at the top; a band across
 * the middle of the screen), not a scroll listener.
 */
export default function PressHeader() {
  const [stuck, setStuck] = useState(false);
  const [active, setActive] = useState("");

  useEffect(() => {
    const observers = [];
    const sentinel = document.getElementById("pr-top-sentinel");
    if (sentinel) {
      const io = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting));
      io.observe(sentinel);
      observers.push(io);
    }
    const spy = new IntersectionObserver(
      (entries) => entries.forEach((entry) => { if (entry.isIntersecting) setActive(entry.target.id); }),
      { rootMargin: "-40% 0px -55% 0px" },
    );
    SECTIONS.forEach(({ id }) => { const el = document.getElementById(id); if (el) spy.observe(el); });
    observers.push(spy);
    return () => observers.forEach((io) => io.disconnect());
  }, []);

  return (
    <header className={stuck ? "pr-top is-stuck" : "pr-top"}>
      <div className="pr-top__in">
        {/* The product's own brand, endorsed by its maker's: Proj Arch, a rule,
            then Inkvyn's mark and name. One link home. */}
        <Link href="/" className="pr-brand" aria-label={`${BRAND_NAME} ${PRODUCT_NAME}, home`}>
          {/* Vector, from the brand kit: a plain <img>, as next/image has nothing to optimise in an SVG. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={LOCKUP.src} alt={BRAND_NAME} width={LOCKUP.width} height={LOCKUP.height} className="pr-brand__lockup" />
          <span className="pr-brand__product">
            <InkvynMark className="pr-brand__mark" />
            <span className="pr-brand__name">{PRODUCT_NAME}</span>
          </span>
        </Link>
        <nav className="pr-nav" aria-label="On this page">
          {SECTIONS.map(({ id, label }) => (
            <a key={id} href={`#${id}`} className={active === id ? "pr-nav__link is-on" : "pr-nav__link"} aria-current={active === id ? "true" : undefined}>
              {label}
            </a>
          ))}
        </nav>
        <Link className="pr-top__signin" href="/login">Sign in</Link>
      </div>
    </header>
  );
}
