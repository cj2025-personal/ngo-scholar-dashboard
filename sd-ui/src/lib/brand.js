/**
 * The brand, in one place: the public name, this product's name, where
 * people write to, and the public site it belongs to. Read on the server;
 * an environment can point the two addresses elsewhere without a code change.
 *
 * The logo files are the brand kit's (public/brand/, from
 * scripts/brand/archivyn_logo.py): the mark and the words "Proj Arch" drawn
 * as one outlined SVG, the same lockup the public site's bar shows. Width and
 * height are each file's viewBox, so the box is reserved before it loads.
 */
export const BRAND_NAME = "Proj Arch";
/* This product's name, the same on the public site (projarch.org/for-
   researchers). Chosen 2026-11-17 to sit with Archivyn and Kivyn; it was
   "Scholar Dashboard". A proper name: no "the" before it. */
export const PRODUCT_NAME = "Inkvyn";

export const CONTACT_EMAIL = process.env.CONTACT_EMAIL || "hello@projarch.org";
export const PUBLIC_SITE_URL = (process.env.PUBLIC_SITE_URL || "https://www.projarch.org").replace(/\/+$/, "");

export const LOCKUP = { src: "/brand/archivyn-lockup-compact.svg", width: 752.59, height: 226.22 };
export const LOCKUP_ON_DARK = { src: "/brand/archivyn-lockup-compact-on-dark.svg", width: 752.59, height: 226.22 };
