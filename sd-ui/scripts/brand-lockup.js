/**
 * Derive the navbar lockup from the brand artwork.
 *
 *   node scripts/brand-lockup.js
 *
 * ── Why the shipped files are not the brand file ───────────────────────────
 * `public/archivyn-full-logo.png` is the artwork as the brand supplies it:
 * 2000x600, transparent, with the lockup — the mark, the wordmark and the
 * line beneath it — in the middle quarter and the rest empty canvas. Put
 * straight into the bar it would either be drawn tiny inside its own margins
 * or need a box three times wider than the logo, pushing the navigation away
 * from the brand; and it is tens of kilobytes, on every page, to draw
 * something 127px wide.
 *
 * ── Why three files, each the exact size ───────────────────────────────────
 * The lockup is drawn 40px tall. It used to ship as one file at three times
 * that, through Next's image optimizer, and it looked soft: the optimizer
 * re-encoded it lossy at quality 75, and a 1x laptop screen got a 384px-wide
 * image that the browser then shrank about 3:1 on the fly — a fast, blurry
 * resample of fine red and navy edges. So this writes the lockup at exactly
 * 1x, 2x and 3x of its drawn size (127x40, 254x80, 381x120), each resized
 * once, directly from the brand artwork, with a high-quality filter and a
 * light sharpen, as lossless PNG. The bar serves them as they are, by pixel
 * density, so every screen maps one image pixel to one screen pixel.
 *
 * Artwork that arrives on opaque white instead (the older `archivyn-full.png`
 * did) has its white turned into alpha on a soft ramp — fully transparent at
 * white, fully opaque 22 levels darker, proportional between — which keeps
 * anti-aliased edges smooth where a hard threshold would leave a jagged
 * fringe. Colours are never shifted, so the navy and the red are the brand's.
 *
 * Re-run this when the brand artwork changes; commit what it writes, and set
 * LOCKUP in components/scholar/Topbar.js to the 1x size it prints.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const PUBLIC = path.join(__dirname, "..", "public");
const SRC = path.join(PUBLIC, "archivyn-full-logo.png");
const out = (density) => path.join(PUBLIC, `archivyn-full-logo-nav@${density}x.png`);

/** The height the bar draws the lockup at, in CSS pixels. */
const DRAWN_HEIGHT = 40;
const DENSITIES = [1, 2, 3];
/** How far below white a pixel must sit to count as fully the logo. */
const RAMP = 22;
/** A light unsharp mask after the downscale: crisp edges without halos. */
const SHARPEN = { sigma: 0.55, m1: 0.6, m2: 1.4 };

/** Whether the artwork already sits on transparency: its corners are clear. */
async function isTransparent(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alphaAt = (x, y) => data[(y * info.width + x) * info.channels + 3];
  const w = info.width - 1;
  const h = info.height - 1;
  return [alphaAt(0, 0), alphaAt(w, 0), alphaAt(0, h), alphaAt(w, h)].every((a) => a === 0);
}

/** White to alpha, on the ramp above, for artwork that arrives on white. */
async function whiteToAlpha(buffer) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < info.width * info.height; i += 1) {
    const o = i * info.channels;
    const min = Math.min(data[o], data[o + 1], data[o + 2]);
    data[o + 3] = Math.max(0, Math.min(255, Math.round(((255 - min) / RAMP) * 255)));
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

async function main() {
  if (!fs.existsSync(SRC)) throw new Error(`missing brand artwork: ${SRC}`);

  const transparent = await isTransparent(SRC);
  let lockup = await sharp(SRC).trim({ threshold: 10 }).png().toBuffer();
  if (!transparent) lockup = await whiteToAlpha(lockup);
  const meta = await sharp(lockup).metadata();

  /* One width for all three, so 2x and 3x are exact multiples of 1x. */
  const width1x = Math.round((meta.width * DRAWN_HEIGHT) / meta.height);
  if (meta.height < DRAWN_HEIGHT * Math.max(...DENSITIES)) {
    throw new Error(`the artwork's lockup is ${meta.height}px tall; ${DRAWN_HEIGHT * Math.max(...DENSITIES)}px is needed for ${Math.max(...DENSITIES)}x`);
  }

  const kb = (p) => `${(fs.statSync(p).size / 1024).toFixed(1)}KB`;
  console.log(`source  ${path.basename(SRC)}  ${meta.width}x${meta.height} lockup  ${kb(SRC)}  (${transparent ? "transparent" : "on white"})`);
  for (const d of DENSITIES) {
    const file = out(d);
    await sharp(lockup)
      .resize({ width: width1x * d, height: DRAWN_HEIGHT * d, fit: "fill", kernel: "lanczos3" })
      .sharpen(SHARPEN)
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toFile(file);
    console.log(`written ${path.basename(file)}  ${width1x * d}x${DRAWN_HEIGHT * d}  ${kb(file)}`);
  }
  console.log(`LOCKUP = { width: ${width1x}, height: ${DRAWN_HEIGHT} }`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
