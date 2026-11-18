/*
 * The public site's pages and accounts, as its footer lists them. Copied from
 * ngo-web frontend src/components/siteLinks.js and socialAccounts.js; change
 * them together. Paths are the site's: the footer joins them to
 * PUBLIC_SITE_URL, since none of these pages is the studio's.
 *
 * `footer: false` keeps a page on the site's sitemap only. `cookiePreferences`
 * marks the cookie page, which the site's footer opens in place; the studio
 * has no cookie panel of its own, so here it is a link to that page.
 */
export const SITE_SECTIONS = [
  {
    title: "Platform",
    links: [
      { href: "/scholars", label: "Scholar Directory" },
      { href: "/alyno-ai", label: "Alyno AI", mark: true },
      { href: "/podcasts", label: "Podcasts", tag: "NEW" },
      { href: "/publications", label: "Publications" },
      { href: "/atlas/global", label: "Global Mode", footer: false },
      { href: "/atlas/community", label: "Communities" },
      { href: "/for-researchers", label: "For Researchers" },
    ],
  },
  {
    title: "For Schools",
    links: [
      { href: "/schools/plans", label: "K-14 Plans" },
      { href: "/schools/teacher-tools", label: "Teacher Tools" },
      { href: "/schools/parent-portal", label: "Parent Portal" },
      { href: "/schools/curriculum", label: "Reading Standards" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/about", label: "About Us" },
      { href: "/mission", label: "Mission & Impact" },
      { href: "/careers", label: "Careers" },
      { href: "/blog", label: "Blog" },
      { href: "/contact", label: "Contact Us" },
    ],
  },
  {
    title: "Legal & Safety",
    links: [
      { href: "/legal/privacy", label: "Privacy Policy" },
      { href: "/legal/children", label: "Children's Privacy" },
      { href: "/legal/ai", label: "How We Use AI" },
      { href: "/legal/terms", label: "Terms of Service" },
      { href: "/legal/security", label: "Security" },
      { href: "/legal/cookies", label: "Cookie Settings", cookiePreferences: true },
      { href: "/legal/accessibility", label: "Accessibility" },
      { href: "/legal/portrait-credits", label: "Portrait Credits", footer: false },
      { href: "/scholars/request", label: "Scholar Corrections & Removals", footer: false },
    ],
  },
];

export const SOCIAL_ACCOUNTS = [
  { id: "instagram", label: "Instagram", handle: "@archivynai", href: "https://www.instagram.com/archivynai/" },
  { id: "x", label: "X", handle: "@archivyn", href: "https://x.com/archivyn" },
  { id: "youtube", label: "YouTube", handle: "@archivynai", href: "https://www.youtube.com/@archivynai" },
  { id: "linkedin", label: "LinkedIn", handle: "Archivyn", href: "https://www.linkedin.com/company/archivyn" },
];
