/**
 * Kivyn, drawn: one body, a pose for each thing the agent really does.
 *
 * This file is the only drawing of Kivyn there is. The app renders it as
 * inline SVG (`components/kivyn/Kivyn.js`), so CSS can colour it from the
 * theme and move its parts; `scripts/kivyn-assets.mjs` writes the same trees
 * out as the SVG files in `public/brand/kivyn/` that go into Figma and Rive.
 * Change the drawing here and re-run that script; the browser suite fails if
 * the files and this module disagree.
 *
 * ── Shape of a drawing ──────────────────────────────────────────────────────
 * A node is `[tag, attrs, children]`. Attributes are SVG's, in React's
 * camelCase, plus two of our own:
 *   · `k`    the paint: which of Kivyn's colours a shape takes, and how
 *            (`line`, `page`, `fold`…). A role, never a colour, so the app
 *            can theme it and the files can be written in the brand palette.
 *   · `part` the layer: a name the animation and the design tools address
 *            (`fold`, `eye-left`, `pencil`…). In the files it is the group's
 *            id, which Figma and Rive show as the layer's name.
 *
 * ── The construction ────────────────────────────────────────────────────────
 * A white page on a 400 × 400 grid, one navy line of weight 6, round ends,
 * flat colour. Its top-right corner is dog-eared; faint creases down the
 * page spell K (a spine, an arm up to the fold, a leg down to the foot); a
 * red bookmark is the only red anywhere. Between poses only the eyes, the
 * arms and what Kivyn holds change; the page never does.
 */

export const PALETTE = { line: "#1E3A8A", page: "#FFFFFF", fold: "#EEF3FB", accent: "#B22234", ink: "#172554" };

/** Each paint role, as SVG attributes in a given palette. The app's CSS says the same with theme variables. */
export const PAINTS = {
  line: (p) => ({ fill: "none", stroke: p.line, strokeLinecap: "round", strokeLinejoin: "round" }),
  crease: (p) => ({ fill: "none", stroke: p.line, strokeLinecap: "round", opacity: 0.3 }),
  faint: (p) => ({ fill: "none", stroke: p.line, strokeLinecap: "round", opacity: 0.3 }),
  outline: (p) => ({ fill: "none", stroke: p.line, strokeLinejoin: "round" }),
  page: (p) => ({ fill: p.page }),
  card: (p) => ({ fill: p.page, stroke: p.line, strokeLinejoin: "round" }),
  fold: (p) => ({ fill: p.fold, stroke: p.line, strokeLinejoin: "round" }),
  tint: (p) => ({ fill: p.fold }),
  ink: (p) => ({ fill: p.line }),
  shine: (p) => ({ fill: p.page }),
  accent: (p) => ({ fill: p.accent }),
  ground: (p) => ({ fill: p.line, opacity: 0.1 }),
  glass: (p) => ({ fill: p.page, opacity: 0.6 }),
};

export const POSES = ["neutral", "reading", "searching", "writing", "checking", "tracing", "cant-answer", "done"];

/** The whole figure, cropped to what any pose draws; and the files' full grid. */
export const FIGURE_BOX = "24 40 368 304";
export const GRID_BOX = "0 0 400 400";
/** The mark: the page and its face, square. */
export const MARK_BOX = "68 45 264 264";

const SW = 6;
const n = (tag, attrs = {}, children = []) => [tag, attrs, children];
const g = (part, children, attrs = {}) => n("g", { part, ...attrs }, children);
const path = (d, k, attrs = {}) => n("path", { d, k, ...attrs });
const line = (d, w = SW, attrs = {}) => path(d, "line", { strokeWidth: w, ...attrs });
const dot = (cx, cy, r, k = "ink") => n("circle", { cx, cy, r, k });

/* ── the body ─────────────────────────────────────────────────────────────── */

const PAGE = "M123 80 H239 L295 136 V282 A18 18 0 0 1 277 300 H123 A18 18 0 0 1 105 282 V98 A18 18 0 0 1 123 80 Z";
const SHEET = "M123 80 H277 A18 18 0 0 1 295 98 V282 A18 18 0 0 1 277 300 H123 A18 18 0 0 1 105 282 V98 A18 18 0 0 1 123 80 Z";
const FLAP_FOLDED = "M239 80 V128 A8 8 0 0 0 247 136 H295 Z";
const FLAP_LIFTING = "M239 80 L282 93 L295 136 Z";
const BOOKMARK = "M121 88 V54 L129 61 L137 54 V88 Z";

const shadow = () => g("shadow", [n("ellipse", { cx: 200, cy: 330, rx: 74, ry: 6, k: "ground" })]);
const bookmark = () => g("bookmark", [path(BOOKMARK, "accent")]);
const creases = () => g("creases", [
  path("M150 80 V300", "crease", { strokeWidth: 4 }),
  path("M150 190 L267 108", "crease", { strokeWidth: 4 }),
  path("M150 190 L272 300", "crease", { strokeWidth: 4 }),
]);
const page = ({ withCreases = true, w = SW } = {}) => g("page", [
  path(PAGE, "page"),
  ...(withCreases ? [creases()] : []),
  path(PAGE, "outline", { strokeWidth: w }),
]);
const fold = (flap = FLAP_FOLDED, w = SW) => g("fold", [path(flap, "fold", { strokeWidth: w })]);
const legs = () => g("legs", [line("M172 292 V323 H161"), line("M228 292 V323 H239")]);
const hand = (x, y, r = 5.5) => dot(x, y, r);
const armsDown = () => g("arms", [line("M112 226 Q90 234 84 256"), hand(84, 257), line("M288 226 Q310 234 316 256"), hand(316, 257)]);
const armLeftDown = () => g("arm-left", [line("M112 226 Q90 234 84 256"), hand(84, 257)]);

/* ── faces ────────────────────────────────────────────────────────────────── */

const openEye = (part, x, y, r = 12) => g(part, [dot(x, y, r), dot(x - r / 3, y - r / 3, +(r * 0.3).toFixed(2), "shine")]);
/* Lidded: a flat top, for reading and writing — attention, not sleep. */
const liddedEye = (part, x, y) => g(part, [path(`M${x - 11.6} ${y - 3} A12 12 0 1 0 ${x + 11.6} ${y - 3} Z`, "ink"), dot(x - 4.5, y + 1, 3.2, "shine")]);
const happyEye = (part, x, y, w = SW) => g(part, [line(`M${x - 11} ${y + 4} Q${x} ${y - 10} ${x + 11} ${y + 4}`, w)]);
const smile = (x, y, w = 8, d = 7) => g("mouth", [line(`M${x - w} ${y} Q${x} ${y + d} ${x + w} ${y}`, 5)]);
const face = (children) => g("face", children);

/* ── the poses ────────────────────────────────────────────────────────────── */

/* Everything but the ground, so a pose can move the figure without its shadow. */
const standing = ({ back = armsDown(), flap, faceParts, front = [] }) => [shadow(), g("figure", [legs(), back, bookmark(), page(), fold(flap), face(faceParts), ...front])];

const POSE_ART = {
  neutral: () => standing({ faceParts: [openEye("eye-left", 198, 188), openEye("eye-right", 250, 188), smile(224, 210)] }),

  /* An open book held by its outer edges, so the arms stay short and never band the body. */
  reading: () => standing({
    back: n("g", {}, []),
    faceParts: [liddedEye("eye-left", 198, 194), liddedEye("eye-right", 250, 194), smile(224, 216, 6, 5)],
    front: [g("prop", [
      g("book", [
        path("M200 262 L128 248 V284 L200 298 Z", "card", { strokeWidth: 5 }),
        path("M200 262 L272 248 V284 L200 298 Z", "card", { strokeWidth: 5 }),
        g("lines", [
          path("M138 260 L190 270", "faint", { strokeWidth: 3.5 }), path("M138 270 L190 280", "faint", { strokeWidth: 3.5 }),
          path("M210 270 L262 260", "faint", { strokeWidth: 3.5 }), path("M210 280 L262 270", "faint", { strokeWidth: 3.5 }),
        ]),
      ]),
      g("arms", [line("M105 234 Q110 256 126 263"), hand(127, 264), line("M295 234 Q290 256 274 263"), hand(273, 264)]),
    ])],
  }),

  /* Leafing: pages fanned out behind, one hand at the farthest. */
  searching: () => [
    shadow(),
    g("figure", [
      g("prop", [
        g("sheet-2", [path(SHEET, "card", { strokeWidth: SW, transform: "rotate(-18 105 300)" })]),
        g("sheet-1", [path(SHEET, "card", { strokeWidth: SW, transform: "rotate(-9 105 300)" })]),
      ]),
      legs(),
      g("arms", [line("M112 216 Q88 206 74 186"), hand(73, 185), line("M288 226 Q310 234 316 256"), hand(316, 257)]),
      bookmark(), page(), fold(),
      face([openEye("eye-left", 193, 184), openEye("eye-right", 245, 184), g("mouth", [n("ellipse", { cx: 219, cy: 211, rx: 4, ry: 5, k: "ink" })])]),
    ]),
  ],

  writing: () => standing({
    back: armLeftDown(),
    faceParts: [liddedEye("eye-left", 203, 192), liddedEye("eye-right", 255, 192), smile(229, 214, 6, 5)],
    front: [g("prop", [
      g("card", [
        n("rect", { x: 304, y: 272, width: 72, height: 46, rx: 6, k: "card", strokeWidth: 5 }),
        path("M314 286 H364", "faint", { strokeWidth: 4 }),
        g("script", [line("M314 302 q6 -7 12 0 t12 0 t12 0", 4, { pathLength: 1 })]),
      ]),
      g("pencil", [n("g", { transform: "translate(351 302) rotate(20)" }, [
        n("rect", { x: -7, y: -62, width: 14, height: 44, k: "ink" }),
        path("M0 0 L-7 -18 H7 Z", "card", { strokeWidth: 4 }),
        path("M0 0 L-2.8 -7 H2.8 Z", "ink"),
        n("rect", { x: -7, y: -72, width: 14, height: 11, rx: 3, k: "fold", strokeWidth: 4 }),
      ])]),
      g("arms", [line("M295 224 Q332 226 364 256"), hand(366, 258, 6)]),
    ])],
  }),

  /* A magnifier over the near eye, which it makes larger; the other narrows. */
  checking: () => standing({
    back: armLeftDown(),
    faceParts: [liddedEye("eye-left", 198, 190), g("mouth", [line("M215 215 H228", 5)])],
    front: [g("prop", [
      g("magnifier", [
        line("M271 205 L304 238", 10),
        n("circle", { cx: 252, cy: 186, r: 27, k: "glass" }),
        openEye("eye-right", 252, 188, 17),
        n("circle", { cx: 252, cy: 186, r: 27, k: "outline", strokeWidth: 7 }),
      ]),
      g("arms", [line("M295 228 Q307 230 306 240"), hand(306, 241, 6)]),
    ])],
  }),

  /* The signature: a thread from Kivyn's hand to the passage a sentence came from, the corner lifting. */
  tracing: () => [
    g("source", [
      path("M314 112 H368 L380 124 V196 A8 8 0 0 1 372 204 H314 A8 8 0 0 1 306 196 V120 A8 8 0 0 1 314 112 Z", "card", { strokeWidth: 5 }),
      path("M318 132 H352", "faint", { strokeWidth: 4 }), path("M318 146 H366", "faint", { strokeWidth: 4 }),
      g("passage", [n("rect", { x: 314, y: 153, width: 58, height: 14, rx: 4, k: "tint" }), line("M319 160 H366", 5)]),
      path("M318 174 H362", "faint", { strokeWidth: 4 }), path("M318 188 H344", "faint", { strokeWidth: 4 }),
    ]),
    g("thread", [line("M286 201 C304 198 294 162 312 160", 4, { strokeDasharray: "0.5 9" })]),
    n("g", { transform: "translate(-48 0)" }, [
      shadow(),
      g("figure", [
        legs(), armLeftDown(), bookmark(), page(), fold(FLAP_LIFTING),
        g("lift", [line("M300 70 Q312 76 316 90", 4, { opacity: 0.5 }), line("M289 62 Q306 64 316 74", 4, { opacity: 0.35 })]),
        face([openEye("eye-left", 204, 186), openEye("eye-right", 256, 186), smile(230, 209, 7, 6)]),
        g("arms", [line("M295 222 Q316 214 330 203"), hand(332, 202)]),
      ]),
    ]),
  ],

  /* Open hands, calm. Never sad, never an error. */
  "cant-answer": () => standing({
    back: g("arms", [line("M112 222 Q90 216 74 196"), line("M64 189 Q74 204 84 189"), line("M288 222 Q310 216 326 196"), line("M316 189 Q326 204 336 189")]),
    faceParts: [openEye("eye-left", 198, 186), openEye("eye-right", 250, 186), g("mouth", [line("M217 211 Q224 214 231 211", 5)])],
  }),

  done: () => standing({
    back: g("arms", [line("M112 224 Q92 222 80 204"), hand(79, 202), line("M288 224 Q308 222 320 204"), hand(321, 202)]),
    faceParts: [happyEye("eye-left", 198, 188), happyEye("eye-right", 250, 188), smile(224, 208, 10, 9)],
    front: [g("fold-back", [line("M276 64 Q300 64 310 88", 4, { opacity: 0.5 }), line("M290 54 Q314 56 322 78", 4, { opacity: 0.35 })])],
  }),
};

const known = (pose) => (POSES.includes(pose) ? pose : "neutral");

/* Every line heavier by `factor`, fills untouched: what a small figure needs
   to stay a drawing rather than a sketch. Hands grow with the arms. */
function weighted([tag, attrs, children], factor) {
  const next = { ...attrs };
  if (typeof next.strokeWidth === "number") next.strokeWidth = +(next.strokeWidth * factor).toFixed(2);
  if (tag === "circle" && next.k === "ink" && next.r <= 6) next.r = +(next.r * factor).toFixed(2);
  return [tag, next, children.map((c) => weighted(c, factor))];
}

/**
 * The whole figure in a pose. `weight` above 1 thickens the lines for small
 * sizes; the files are always drawn at 1, the construction's own weight.
 */
export function figure(pose, { weight = 1 } = {}) {
  const art = POSE_ART[known(pose)]();
  return weight === 1 ? art : art.map((node) => weighted(node, weight));
}

/* The mark's eyes in each pose: where they look, and how. */
const MARK_EYES = {
  neutral: (e) => [e("eye-left", 198, 188), e("eye-right", 250, 188)],
  reading: (e) => [liddedEye("eye-left", 198, 194), liddedEye("eye-right", 250, 194)],
  searching: (e) => [e("eye-left", 193, 183), e("eye-right", 245, 183)],
  writing: (e) => [liddedEye("eye-left", 203, 192), liddedEye("eye-right", 255, 192)],
  checking: (e) => [liddedEye("eye-left", 198, 190), e("eye-right", 250, 188)],
  tracing: (e) => [e("eye-left", 204, 186), e("eye-right", 256, 186)],
  "cant-answer": (e) => [e("eye-left", 198, 186), e("eye-right", 250, 186)],
  done: () => [happyEye("eye-left", 198, 188, 8), happyEye("eye-right", 250, 188, 8)],
};

/** The page and its face, for 40 px and up: no limbs, no props; the eyes still say the pose. */
export function mark(pose) {
  const eye = (part, x, y) => openEye(part, x, y, 13);
  return [bookmark(), page({ w: 8 }), fold(FLAP_FOLDED, 8), face(MARK_EYES[known(pose)](eye))];
}

/* At 32 px and under: a heavier line, a deeper fold, bigger eyes, no creases. */
const PAGE_SMALL = "M123 80 H225 L295 150 V282 A18 18 0 0 1 277 300 H123 A18 18 0 0 1 105 282 V98 A18 18 0 0 1 123 80 Z";
const FLAP_SMALL = "M225 80 V142 A8 8 0 0 0 233 150 H295 Z";

/** The mark for 32 px and under. Only "done" changes its face; anything finer would not survive the size. */
export function smallMark(pose) {
  const eyes = known(pose) === "done"
    ? [happyEye("eye-left", 192, 202, 16), happyEye("eye-right", 254, 202, 16)]
    : [g("eye-left", [dot(192, 200, 19)]), g("eye-right", [dot(254, 200, 19)])];
  return [
    g("bookmark", [path("M114 92 V50 L128 60 L142 50 V92 Z", "accent")]),
    g("page", [path(PAGE_SMALL, "card", { strokeWidth: 16 })]),
    g("fold", [path(FLAP_SMALL, "fold", { strokeWidth: 16 })]),
    face(eyes),
  ];
}

/** One colour, for print and stamps: navy only, white is the paper showing through. */
export function monoMark() {
  return [
    g("bookmark", [n("path", { d: BOOKMARK, fill: PALETTE.line })]),
    g("page", [n("path", { d: PAGE, fill: PALETTE.line, stroke: PALETTE.line, strokeWidth: 8, strokeLinejoin: "round" })]),
    g("fold", [n("path", { d: FLAP_FOLDED, fill: PALETTE.line, stroke: PALETTE.page, strokeWidth: 8, strokeLinejoin: "round" })]),
    g("face", [n("circle", { cx: 198, cy: 188, r: 13, fill: PALETTE.page }), n("circle", { cx: 250, cy: 188, r: 13, fill: PALETTE.page })]),
  ];
}

/** An app icon: the mark on a rounded tile. */
export function iconTile({ dark = false } = {}) {
  return [
    n("rect", { x: 0, y: 0, width: 400, height: 400, rx: 88, fill: dark ? PALETTE.line : PALETTE.fold }),
    n("g", { transform: "translate(200 200) scale(1.15) translate(-200 -177)" }, mark("neutral")),
  ];
}

/* ── as a file ────────────────────────────────────────────────────────────── */

const KEBAB = /[A-Z]/g;
const attrName = (key) => (key === "viewBox" ? key : key.replace(KEBAB, (c) => `-${c.toLowerCase()}`));
const escapeAttr = (v) => String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function nodeToString([tag, attrs, children], palette, ids) {
  const { k, part, ...rest } = attrs;
  const out = { ...(part ? { id: uniqueId(part, ids) } : {}), ...(k ? PAINTS[k](palette) : {}), ...rest };
  const attrText = Object.entries(out).map(([key, v]) => ` ${attrName(key)}="${escapeAttr(v)}"`).join("");
  const inner = children.map((c) => nodeToString(c, palette, ids)).join("");
  return inner ? `<${tag}${attrText}>${inner}</${tag}>` : `<${tag}${attrText}/>`;
}

/* A layer name is used once per file; a second "arms" becomes "arms-2". */
function uniqueId(part, ids) {
  const seen = ids.get(part) || 0;
  ids.set(part, seen + 1);
  return seen ? `${part}-${seen + 1}` : part;
}

/** A drawing as a standalone SVG file, in the brand palette. */
export function toSvg(children, { viewBox = GRID_BOX, title = "Kivyn", palette = PALETTE } = {}) {
  const [, , w, h] = viewBox.split(" ");
  const ids = new Map();
  const body = children.map((c) => nodeToString(c, palette, ids)).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${w}" height="${h}"><title>${escapeAttr(title)}</title>${body}</svg>\n`;
}

/** Every file in `public/brand/kivyn/`, by name, as the export script writes them. */
export function brandFiles() {
  const titles = {
    neutral: "Kivyn", reading: "Kivyn reading", searching: "Kivyn searching", writing: "Kivyn writing",
    checking: "Kivyn checking", tracing: "Kivyn tracing a sentence to its passage", "cant-answer": "Kivyn: the paper does not say", done: "Kivyn, done",
  };
  const files = {};
  for (const pose of POSES) files[`kivyn-${pose}.svg`] = toSvg(figure(pose), { title: titles[pose] });
  files["kivyn-mark.svg"] = toSvg(mark("neutral"), { viewBox: MARK_BOX, title: "Kivyn mark" });
  files["kivyn-mark-small.svg"] = toSvg(smallMark("neutral"), { viewBox: MARK_BOX, title: "Kivyn mark, small sizes" });
  files["kivyn-mono.svg"] = toSvg(monoMark(), { viewBox: MARK_BOX, title: "Kivyn mark, one colour" });
  files["kivyn-icon-light.svg"] = toSvg(iconTile(), { title: "Kivyn app icon, light" });
  files["kivyn-icon-dark.svg"] = toSvg(iconTile({ dark: true }), { title: "Kivyn app icon, dark" });
  return files;
}
