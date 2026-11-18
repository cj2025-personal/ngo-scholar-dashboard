import { BRAND_NAME, PRODUCT_NAME } from "@/lib/brand";
import { publicFontClasses } from "@/lib/publicFonts";
import { getSiteUrl } from "@/lib/site";
import "./globals.css";
import "./redesign.css";
import "./site-theme.css";

/*
 * Inkvyn wears the public site's type: Figtree for every word, Newsreader for
 * titles, loaded once here exactly as projarch.org loads them
 * (lib/publicFonts.js) and read through `--font-ui` / `--font-display`, which
 * site-theme.css points at them. The roles (page titles, sections, cards,
 * controls, the 16px reading register) are the shared ones in
 * archivyn-tokens.css and archivyn-type.css; site-theme.css gives them the
 * site's faces and colours, loaded last so it wins.
 *
 * The variable classes sit on <html> so that everything rendered into <body>,
 * portals and dialogs included, sees the variables.
 *
 * The Proj Arch logo is outlined vector (public/brand/, from
 * scripts/brand/archivyn_logo.py) and needs no face of its own: its letters
 * are Figtree, already converted to shapes.
 */

export const metadata = {
  title: `${BRAND_NAME} · ${PRODUCT_NAME}`,
  description: "Where university scholars publish research, stories, and podcasts.",
  metadataBase: new URL(getSiteUrl()),
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={publicFontClasses}>
      <body>{children}</body>
    </html>
  );
}
