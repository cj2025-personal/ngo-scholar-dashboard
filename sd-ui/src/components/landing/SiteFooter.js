import { LuInstagram, LuLinkedin, LuYoutube } from "react-icons/lu";

import { BRAND_NAME, LOCKUP_ON_DARK, PUBLIC_SITE_URL } from "@/lib/brand";
import { SITE_SECTIONS, SOCIAL_ACCOUNTS } from "@/lib/siteLinks";

import NewsletterForm from "./NewsletterForm";
import "./SiteFooter.css";

/* Lucide has no X mark; this is X's own, drawn on the same 24-unit square
   (as the site's footer draws it). */
const XMark = (props) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
  </svg>
);

const SOCIAL_ICONS = { instagram: LuInstagram, x: XMark, youtube: LuYoutube, linkedin: LuLinkedin };

const site = (path) => `${PUBLIC_SITE_URL}${path}`;

/**
 * The public site's footer (ngo-web GlobalFooter.js), the same markup and
 * words, so a page of the studio ends exactly as a page of projarch.org does.
 * Every link is the site's page. Without its call-to-action band, as the
 * site's own For Researchers page shows it: the page above has its own way
 * in. Change it together with the site's.
 */
export default function SiteFooter() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="site-footer">
      <div className="footer-main">
        <div className="footer-main-inner">
          <div className="footer-brand">
            <div className="footer-brand-top">
              {/* Vector, from the brand kit: a plain <img>, as next/image has nothing to optimise in an SVG. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={LOCKUP_ON_DARK.src} alt={BRAND_NAME} width={133} height={40} className="footer-lockup" />
              <span className="footer-brand-tagline">
                The people behind <em>the research</em>
              </span>
            </div>
            <p className="footer-brand-desc">
              Connecting <strong>K-14 students</strong> with university research through <strong>AI-powered insights</strong>. Built for learners, educators, and institutions that believe every student deserves access to world-class knowledge.
            </p>
            <ul className="footer-social" aria-label="Follow us">
              {SOCIAL_ACCOUNTS.map((account) => {
                const Icon = SOCIAL_ICONS[account.id];
                return (
                  <li key={account.id}>
                    <a
                      href={account.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${account.label}, ${account.handle} (opens in a new tab)`}
                      title={`${account.label} · ${account.handle}`}
                    >
                      <Icon size={18} width={18} height={18} aria-hidden="true" focusable="false" />
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="footer-links-grid">
            {SITE_SECTIONS.map((section) => (
              <div className="footer-link-col" key={section.title}>
                <h3>{section.title}</h3>
                {section.links.filter((link) => link.footer !== false).map((link) => (
                  <a key={link.href} href={site(link.href)}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {link.mark ? <img src="/brand/alyno/alyno-mark-small-on-dark.svg" alt="" width={16} height={16} /> : null}
                    {link.label}
                    {link.tag ? <> <span className="footer-tag new">{link.tag}</span></> : null}
                  </a>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="footer-newsletter">
        <div className="footer-newsletter-inner">
          <div className="footer-newsletter-left">
            <div className="footer-newsletter-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#EF3340" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <path d="M2 5l10 7 10-7" />
              </svg>
            </div>
            <div>
              <span className="footer-newsletter-title">Stay ahead in EdTech &amp; AI learning</span>
              <span className="footer-newsletter-desc">Get the latest scholar spotlights, new episode drops, and K-14 AI research, straight to your inbox.</span>
            </div>
          </div>
          <NewsletterForm />
        </div>
      </div>

      <div className="footer-bottom-bar">
        <div className="footer-bottom-inner">
          <span className="footer-copyright">&copy; {currentYear} {BRAND_NAME} All rights reserved.</span>
          <div className="footer-bottom-links">
            <span className="footer-bottom-sep">|</span>
            <a href={site("/legal/privacy")}>Privacy</a>
            <a href={site("/legal/terms")}>Terms</a>
            <a href={site("/legal/cookies")}>Cookies</a>
            <a href={site("/sitemap")}>Sitemap</a>
            {/* The wall's CC BY and BY-SA portraits need a credit line. */}
            <a href={site("/legal/portrait-credits")}>Portrait credits</a>
          </div>
          <span className="footer-made">Made with <span className="footer-heart">&hearts;</span> for learners everywhere</span>
        </div>
      </div>
    </footer>
  );
}
