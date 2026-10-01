/**
 * Write Kivyn's SVG files from the drawing the app renders.
 *
 *   npm run brand:kivyn
 *
 * `src/lib/kivyn/art.mjs` is the only drawing of Kivyn. The app draws it
 * inline; this writes the same trees to `public/brand/kivyn/` as standalone
 * SVG in the brand palette — a file per pose, the mark at both sizes, one
 * colour, and the app icon light and dark. Every part is a named group
 * (`page`, `fold`, `eye-left`, `pencil`…), so Figma and Rive import each as
 * its own layer, ready to adjust or rig.
 *
 * Re-run this when the drawing changes, and commit what it writes. The
 * browser suite compares these files with the drawing and fails when they
 * differ, so the files a designer is handed are always the character the
 * product shows. A file here that the drawing no longer makes is removed.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { brandFiles } from "../src/lib/kivyn/art.mjs";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "brand", "kivyn");

const files = brandFiles();
fs.mkdirSync(OUT, { recursive: true });
for (const name of fs.readdirSync(OUT)) {
  if (name.endsWith(".svg") && !(name in files)) {
    fs.rmSync(path.join(OUT, name));
    console.log(`removed ${name}`);
  }
}
for (const [name, svg] of Object.entries(files)) {
  fs.writeFileSync(path.join(OUT, name), svg);
  console.log(`wrote ${name} (${svg.length.toLocaleString()} bytes)`);
}
