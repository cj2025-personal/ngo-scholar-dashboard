import { Fraunces, Geist } from "next/font/google";
import { getSiteUrl } from "@/lib/site";
import "./globals.css";

// Archivyn type system: Geist for UI, Fraunces for editorial headlines
// and reading surfaces (see archivyn-tokens.css).
const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
});

// Variable font: one file covers the whole weight axis (400 body serif,
// 600/700 headlines) instead of shipping separate 600/700 static cuts.
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
    <html lang="en" className={`${geist.variable} ${fraunces.variable}`}>
      <body>{children}</body>
    </html>
  );
}
