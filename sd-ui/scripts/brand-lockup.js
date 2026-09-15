/**
 * Derive the navbar lockup from the brand artwork.
 *
 *   node scripts/brand-lockup.js
 *
 * ── Why the shipped file is not the brand file ─────────────────────────────
 * `public/archivyn-full.png` is the artwork as the brand supplies it:
 * 2172x724, 889KB, RGB with no alpha — navy and red on opaque white, with
 * about 28% of the canvas as whitespace. Three things make it wrong to put
 * straight into the bar:
 *
 *   · No alpha. The navbar is a translucent glass pill, and an opaque white
 *     rectangle punches a hole through it. `mix-blend-mode: multiply` looks
 *     like the fix and is not: the bar's `backdrop-filter` isolates it, so
 *     there is only a translucent backdrop to multiply against. Measured
 *     rather than assumed — identical pixels with the blend on and off.
 *   · The whitespace. Sized to fit the bar, the artwork inside it is small
 *     and the padding pushes the navigation away from the brand.
 *   · 889KB, on every page, to draw something 150px wide.
 *
 * So this trims the canvas, turns white into alpha on a soft ramp — fully
 * transparent at white, fully opaque 22 levels darker, proportional between,
 * which keeps anti-aliased edges smooth where a hard threshold would leave a
 * jagged fringe — and writes it at three times the size it is drawn.
 *
 * Colours are never touched, so the navy and the red are exactly the brand's.
 *
 * Re-run this when the brand artwork changes; commit what it writes.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const PUBLIC = path.join(__dirname, "..", "public");
const SRC = path.join(PUBLIC, "archivyn-full.png");
const OUT = path.join(PUBLIC, "archivyn-full-nav.png");

/** Drawn 40px tall; 3x covers the densest screen anyone brings to it. */
const TARGET_HEIGHT = 138;
/** How far below white a pixel must sit to count as fully the logo. */
const RAMP = 22;

async function main() {
  if (!fs.existsSync(SRC)) throw new Error(`missing brand artwork: ${SRC}`);

  const trimmed = await sharp(SRC).trim({ threshold: 10 }).toBuffer();
  const { data, info } = await sharp(trimmed)
    .resize({ height: TARGET_HEIGHT, fit: "inside", withoutEnlargement: true, kernel: "lanczos3" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (let i = 0; i < info.width * info.height; i += 1) {
    const o = i * info.channels;
    const min = Math.min(data[o], data[o + 1], data[o + 2]);
    data[o + 3] = Math.max(0, Math.min(255, Math.round(((255 - min) / RAMP) * 255)));
  }

  await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(OUT);

  const kb = (p) => `${(fs.statSync(p).size / 1024).toFixed(0)}KB`;
  const out = await sharp(OUT).metadata();
  console.log(`source  ${path.basename(SRC)}  ${kb(SRC)}  (no alpha)`);
  console.log(`written ${path.basename(OUT)}  ${out.width}x${out.height}  ${kb(OUT)}  alpha=${out.hasAlpha}`);
  console.log("Set width/height on the <Image> in components/scholar/Topbar.js to match.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
