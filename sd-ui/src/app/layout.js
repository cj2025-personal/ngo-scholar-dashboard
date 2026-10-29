import { Inter } from "next/font/google";
import { getSiteUrl } from "@/lib/site";
import "./globals.css";
import "./redesign.css";

/*
 * Proj Arch type system: Inter, for every surface of the product.
 *
 * One family, loaded here once as `--font-inter` and read through
 * `--font-ui` / `--font-reading` in archivyn-tokens.css; the stack behind it
 * holds the layout until it arrives. The roles — page titles, sections, cards,
 * controls, the 16px reading register, AI responses — are the shared ones in
 * archivyn-tokens.css and archivyn-type.css, the same in every Proj Arch app.
 *
 * The variable class sits on <html> so that everything rendered into <body>,
 * portals and dialogs included, sees the variable.
 *
 * No `weight`: leaving it out fetches the variable font, one file for the
 * whole axis, rather than a static cut per weight the sheet uses.
 *
 * The Proj Arch logo is outlined vector (public/brand/, from scripts/brand/archivyn_logo.py) and needs no
 * face of its own: its letters are Figtree, already converted to shapes.
 */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata = {
  title: "Proj Arch · Scholar Commons",
  description: "Where university scholars publish research, stories, and podcasts.",
  metadataBase: new URL(getSiteUrl()),
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
