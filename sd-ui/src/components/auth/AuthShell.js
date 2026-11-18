import Link from "next/link";

import { BRAND_NAME, LOCKUP_ON_DARK, PUBLIC_SITE_URL } from "@/lib/brand";
import { publicFontClasses } from "@/lib/publicFonts";

import LegendWall from "./LegendWall";
import "./AuthShell.css";
import "./AuthShellStudio.css";

const year = new Date().getFullYear();

/* Copyright, legal links and the portrait credits, as the site shows them.
   The credits link is a licence condition: several portraits are CC BY or
   BY-SA. All three pages live on the public site. */
function LegalLinks() {
  return (
    <>
      <span>
        © {year} {BRAND_NAME}
      </span>
      <a href={`${PUBLIC_SITE_URL}/legal/privacy`}>Privacy</a>
      <a href={`${PUBLIC_SITE_URL}/legal/terms`}>Terms</a>
      <a href={`${PUBLIC_SITE_URL}/legal/portrait-credits`}>Portrait credits</a>
    </>
  );
}

/**
 * The sign-in layout, the public site's (ngo-web AuthShell): the wall of
 * legends under the site's own line on the left, the form on the right; on a
 * phone the wall is a band at the top. Same parts, same words, so a scholar
 * who signs in here or on projarch.org/for-researchers/login is in one place.
 *
 * @param {object} p
 * @param {string} [p.eyebrow]       a line above the title
 * @param {React.ReactNode} p.title
 * @param {React.ReactNode} [p.description]
 * @param {React.ReactNode} p.children   the form
 * @param {React.ReactNode} [p.footnote] below the card
 */
export default function AuthShell({ eyebrow, title, description, children, footnote }) {
  return (
    <main className={`authshell ${publicFontClasses}`}>
      <aside className="authshell-brand">
        {/* Decoration: the page's job is the form. */}
        <div className="authshell-wall" aria-hidden="true">
          <LegendWall still />
        </div>

        <Link href="/" className="authshell-brand-logo" aria-label={`${BRAND_NAME} home`}>
          {/* Vector, from the brand kit; next/image has nothing to optimise in an SVG. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={LOCKUP_ON_DARK.src} alt="" width={133} height={40} />
        </Link>

        <div className="authshell-brand-hero">
          {/* A paragraph, not a heading: this panel comes before the page <h1>. */}
          <p className="authshell-brand-tagline">
            Academia has always
            <br />
            <em>been for you.</em>
          </p>
          <p className="authshell-brand-sub">
            Academic profiles built from public records, the research behind them, and an AI that explains any of it
            in plain language.
          </p>
          <ul className="authshell-brand-bullets">
            <li>Built for schools: COPPA and FERPA safeguards</li>
            <li>Scholar profiles built from academic records, not AI-generated text</li>
            <li>Grade-aware AI tuned for every learner</li>
          </ul>
        </div>

        <div className="authshell-brand-foot">
          <LegalLinks />
        </div>
      </aside>

      <section className="authshell-panel">
        <div className="authshell-card">
          {eyebrow ? <span className="authshell-eyebrow">{eyebrow}</span> : null}
          <h1 className="authshell-title">{title}</h1>
          {description ? <p className="authshell-desc">{description}</p> : null}
          <div className="authshell-form">{children}</div>
        </div>

        {footnote ? <div className="authshell-footnote">{footnote}</div> : null}

        <div className="authshell-panel-foot">
          <LegalLinks />
        </div>
      </section>
    </main>
  );
}
