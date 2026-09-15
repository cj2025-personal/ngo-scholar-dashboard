/**
 * @type {import('next').NextConfig}
 *
 * ── Headers ────────────────────────────────────────────────────────────────
 * The four below are the ones that can be set without knowing anything about
 * a page's contents, so they are set on everything.
 *
 * A Content-Security-Policy is deliberately NOT here. Next's App Router emits
 * inline scripts to hydrate, so a CSP without per-request nonces would have to
 * allow `unsafe-inline` for scripts — which is the one thing a CSP is for, and
 * would leave a header that reads like protection while providing none. Doing
 * it properly means generating a nonce in middleware and threading it through
 * the document; that is a change worth making on its own, not a line here.
 */
const nextConfig = {
  /* The framework and its version are not a visitor's business. */
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          /* Browsers must not second-guess a declared content type: that is
             how a stored upload becomes a script. */
          { key: "X-Content-Type-Options", value: "nosniff" },
          /* Nothing here is meant to be framed, and the scholar portal holds
             a session — clickjacking has something to steal. */
          { key: "X-Frame-Options", value: "DENY" },
          /* Send the full URL within the site, only the origin when leaving
             it: a story slug or a draft id should not ride along to a
             third party in a Referer header. */
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          /* Nothing in this app uses these, so nothing may ask. */
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
