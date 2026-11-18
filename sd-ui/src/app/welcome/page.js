import PressLanding from "@/components/landing/PressLanding";
import { BRAND_NAME, PRODUCT_NAME } from "@/lib/brand";
import { publicFontClasses } from "@/lib/publicFonts";
import "./press.css";

/*
 * The studio's front page, for someone with no session. The proxy shows it
 * at "/" (and it answers at /welcome too); signed in, "/" is the Studio.
 *
 * It wears the public site's faces (lib/publicFonts): Figtree for text,
 * Newsreader for the editions and the long lines, and a mono for the labels.
 */
const DESCRIPTION = `The researchers’ studio of ${BRAND_NAME}: Kivyn writes your research for every reading age, you approve every version, and classes read them in circles.`;

export const metadata = {
  title: `${BRAND_NAME} · ${PRODUCT_NAME}`,
  description: DESCRIPTION,
  openGraph: {
    title: `${BRAND_NAME} · ${PRODUCT_NAME}`,
    description: DESCRIPTION,
    siteName: BRAND_NAME,
    type: "website",
  },
};

export default function WelcomePage() {
  return <PressLanding className={publicFontClasses} />;
}
