import { Fraunces, Plus_Jakarta_Sans } from "next/font/google";
import { getSiteUrl } from "@/lib/site";
import "./globals.css";

/*
 * Archivyn type system: Plus Jakarta Sans for UI, Fraunces for editorial
 * headlines and reading surfaces.
 *
 * ── Why this changed ──────────────────────────────────────────────────────
 * This app loaded Geist and put it FIRST in `--sd-sans`, so the canonical
 * `--ark-font-ui` behind it — Plus Jakarta Sans, which the token sheet names
 * and the user dashboard loads — never applied. The two products rendered
 * every piece of interface text in different typefaces while appearing to
 * share a design system.
 *
 * The weight axis matches what the user dashboard requests (300..800), so a
 * component moved between the two apps renders identically rather than
 * snapping to the nearest available weight.
 */
const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
});

/* Variable font: one file covers the whole weight axis (400 body serif,
   600/700 headlines) instead of shipping separate static cuts. The user
   dashboard requests 600 and 700 on the same optical-size axis. */
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
});

export const metadata = {
  title: "Archivyn · Scholar Commons",
  description: "Where university scholars publish research, stories, and podcasts.",
  metadataBase: new URL(getSiteUrl()),
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${jakarta.variable} ${fraunces.variable}`}>
      <body>{children}</body>
    </html>
  );
}
