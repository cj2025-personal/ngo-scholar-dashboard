import { Figtree, JetBrains_Mono, Newsreader } from "next/font/google";

/*
 * The public site's faces, for the studio's pages that someone sees before
 * signing in: the front page, sign-in, and the invitation. They match
 * projarch.org (Figtree for text, Newsreader for headings), so arriving here
 * from the site is arriving in the same place. Signed in, the studio is a
 * product like the learner app and admin, and keeps their one face, Inter
 * (archivyn-tokens.css).
 *
 * Loaded here, once, and applied by each public page's root through
 * `publicFontClasses`, so the signed-in studio never downloads them.
 */
export const figtree = Figtree({ subsets: ["latin"], variable: "--font-figtree", display: "swap" });

export const newsreader = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  variable: "--font-newsreader",
  display: "swap",
});

/* The front page's labels only. */
export const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

export const publicFontClasses = `${figtree.variable} ${newsreader.variable} ${jetbrainsMono.variable}`;
