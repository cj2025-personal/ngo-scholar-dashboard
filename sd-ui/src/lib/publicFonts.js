import { Figtree, Newsreader } from "next/font/google";

/*
 * The public site's faces, for all of Inkvyn. Loaded exactly as projarch.org
 * loads them (ngo-web src/app/layout.js): Figtree for every word, Newsreader
 * at 500 and 600, upright and italic, for headings. Same files, same cuts, so
 * the type renders the same on both. Change them together.
 *
 * Applied once on <html> by the root layout (app/layout.js); site-theme.css
 * points the studio's --font-ui and --font-display at them.
 */
export const figtree = Figtree({ subsets: ["latin", "latin-ext"], variable: "--font-figtree", display: "swap" });

export const newsreader = Newsreader({
  subsets: ["latin"],
  weight: ["500", "600"],
  style: ["normal", "italic"],
  variable: "--font-newsreader",
  display: "swap",
});

export const publicFontClasses = `${figtree.variable} ${newsreader.variable}`;
