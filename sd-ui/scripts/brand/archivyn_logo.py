"""
The Archivyn logo, as outlined SVG: the mark, the wordmark and the tagline.

    python scripts/brand/archivyn_logo.py            # writes public/brand/
    python scripts/brand/archivyn_logo.py --out DIR  # writes somewhere else, to try a change

Needs Python 3 with `pip install fonttools uharfbuzz`. Run it only when the
logo changes; the SVGs it writes are committed, and nothing at runtime needs
Python, the font, or this script.

-- Why outlines, and why Figtree ---------------------------------------------
The logo was set in Avenir in Canva, and shipped as a 2000x600 PNG. A bitmap
cannot be sharp at every size, and Avenir is a commercial face that cannot be
put in a file the whole platform loads. So the letters are Figtree (SIL Open
Font License 1.1, scripts/brand/fonts/OFL.txt): of the open faces set against
the PNG at its own cap height and stroke weight, Figtree is the one with
Avenir's tells, the round dot on the i, the hooked tail of the y, the flat
apex of the A and the open c, and it sits well beside Inter, the platform's
UI face. The text is shaped by HarfBuzz with the font's own kerning and then
converted to outlines, so the files need no font to draw and look the same in
a browser, an email, a PDF or a design tool.

-- What is matched to the PNG ------------------------------------------------
The composition is the PNG's, measured in its own pixels (the lockup is
720x227 there, and those are the design units here): the mark 223 tall; the
wordmark's cap height 72 on a baseline 169 down, starting 11 past the mark and
423 wide; the tagline's cap height 20 on a baseline 219 down, 520 wide. Only
tracking moves to hold those widths, and the script prints it.

The mark is public/archivyn-logo.svg, the brand's own vector, with one
change: the white crossbar is a cut, not white paint, so the background shows
through it on any surface, as it appears to on white.

-- What it writes -------------------------------------------------------------
    archivyn-lockup.svg / -on-dark       mark, wordmark, tagline: 100px tall and up
    archivyn-lockup-compact.svg / -dark  mark and wordmark: interface chrome, under 100px
    archivyn-wordmark.svg / -on-dark     the word alone
    archivyn-mark.svg / -on-dark         the A alone: icons, favicons, tight spaces
Usage rules (which file where, minimum sizes, colour) are in README.md here.
"""

import argparse
import os

import uharfbuzz as hb
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONT = os.path.join(HERE, "fonts", "Figtree[wght].ttf")
DEFAULT_OUT = os.path.join(HERE, "..", "..", "public", "brand")

# -- Colour ------------------------------------------------------------------
NAVY = "#102A56"        # the wordmark, sampled from the PNG
RED = "#D52B3F"         # the tagline, sampled from the PNG
ON_DARK_WORD = "#FFFFFF"
ON_DARK_TAG = "#FF7A88"  # the tagline's red, lifted to read on navy (6.5:1 on #0B1F44)

# -- Type --------------------------------------------------------------------
WORD = "Archivyn"
TAGLINE = "From Archives to You, accelerated by AI"
WORD_WEIGHT = 800       # Figtree ExtraBold: the named weight nearest the PNG's stroke
TAG_WEIGHT = 600        # Figtree SemiBold

# -- Composition, in the PNG's pixels -----------------------------------------
MARK_H = 223
FULL = {"word_cap": 72, "word_x": 198, "word_base": 169, "word_w": 423,
        "tag_cap": 20, "tag_x": 200, "tag_base": 219, "tag_w": 520}
# Without the tagline the word is drawn larger and sits on the mark's lower
# half, where the A carries its weight; its tracking is the full lockup's.
COMPACT = {"word_cap": 92, "word_x": 206, "word_base": 196}

# -- The mark, in archivyn-logo.svg's own units (viewBox 0 0 160 200) ---------
MARK_BOX = (8, 8, 152, 180)   # x0, y0, x1, y1 of the A
BAR = (126, 135)              # the crossbar, cut through the facets
FACETS = {
    "left": [(80, 8), (8, 180), (80, 130)],
    "right": [(80, 8), (152, 180), (80, 130)],
    "foot-left": [(8, 180), (80, 130), (44, 180)],
    "foot-right": [(152, 180), (80, 130), (116, 180)],
}
# The brand file's gradients, as user-space lines so a cut piece keeps its colour.
GRADIENTS = {
    "light": {
        "left": ((80, 8), (80, 180), "#0E2756", "#0A1A3A"),
        "right": ((80, 8), (152, 180), "#D4313C", "#B22234"),
        "foot-left": ((8, 130), (8, 180), "#1A3A6E", "#0E2756"),
        "foot-right": ((80, 130), (152, 180), "#E85060", "#B22234"),
        "dot": "#FFFFFF",
    },
    # On navy the navy half would vanish, so it turns to paper; the red holds.
    "dark": {
        "left": ((80, 8), (80, 180), "#FFFFFF", "#DCE3F1"),
        "right": ((80, 8), (152, 180), "#E5404C", "#C42739"),
        "foot-left": ((8, 130), (8, 180), "#C9D4E8", "#AEBCD6"),
        "foot-right": ((80, 130), (152, 180), "#F0606F", "#C42739"),
        "dot": NAVY,
    },
}
GLINT = [(80, 8), (88, 32), (80, 26), (72, 32)]


def num(v):
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


# -- Text to outlines ----------------------------------------------------------
class Face:
    """Figtree at one weight: HarfBuzz to shape, fontTools for the outlines."""

    def __init__(self, weight):
        self.weight = weight
        self.tt = instantiateVariableFont(TTFont(FONT), {"wght": weight}, inplace=False)
        self.glyphs = self.tt.getGlyphSet()
        self.order = self.tt.getGlyphOrder()
        blob = hb.Blob.from_file_path(FONT)
        self.hb = hb.Font(hb.Face(blob))
        self.hb.set_variations({"wght": weight})
        bp = BoundsPen(self.glyphs)
        self.glyphs["H"].draw(bp)
        self.cap = bp.bounds[3]  # the H's top, in font units

    def shape(self, text):
        buf = hb.Buffer()
        buf.add_str(text)
        buf.guess_segment_properties()
        hb.shape(self.hb, buf, {"kern": True, "liga": True})
        return [(self.order[i.codepoint], p.x_advance, p.x_offset, p.y_offset) for i, p in zip(buf.glyph_infos, buf.glyph_positions)]

    def layout(self, text, cap, x, base, tracking_em=0.0):
        """Outlines for `text` with cap height `cap`, ink starting at `x`, on `base`."""
        scale = cap / self.cap
        run = self.shape(text)
        track = tracking_em * 1000
        # First pass: where the ink starts, so the run can be placed by its ink.
        def draw(pen_factory):
            pen_x = 0.0
            for name, adv, xo, yo in run:
                pen_factory(name, pen_x + xo, yo)
                pen_x += adv + track
        bounds = [None]
        def measure(name, gx, gy):
            bp = BoundsPen(self.glyphs)
            self.glyphs[name].draw(TransformPen(bp, (1, 0, 0, 1, gx, gy)))
            if bp.bounds:
                b = bounds[0]
                bounds[0] = bp.bounds if b is None else (min(b[0], bp.bounds[0]), min(b[1], bp.bounds[1]), max(b[2], bp.bounds[2]), max(b[3], bp.bounds[3]))
        draw(measure)
        x0, y0, x1, y1 = bounds[0]
        svg = SVGPathPen(self.glyphs, ntos=num)
        ox = x - x0 * scale
        draw(lambda name, gx, gy: self.glyphs[name].draw(TransformPen(svg, (scale, 0, 0, -scale, ox + gx * scale, base - gy * scale))))
        ink = (x, base - y1 * scale, x + (x1 - x0) * scale, base - y0 * scale)
        return svg.getCommands(), ink

    def tracking_for(self, text, cap, width):
        """The tracking, in em, that makes `text`'s ink `width` wide at cap height `cap`."""
        _, ink = self.layout(text, cap, 0, 0)
        gaps = len(self.shape(text)) - 1
        size = cap / self.cap * 1000  # the font size, in units, that gives that cap height
        return (width - (ink[2] - ink[0])) / gaps / size


# -- The mark --------------------------------------------------------------------
def clip(poly, y, keep_above):
    """Sutherland-Hodgman against the line at `y`: keep what is above it, or below."""
    inside = (lambda p: p[1] <= y) if keep_above else (lambda p: p[1] >= y)
    out = []
    for i, cur in enumerate(poly):
        prev = poly[i - 1]
        if inside(cur):
            if not inside(prev):
                out.append(cross(prev, cur, y))
            out.append(cur)
        elif inside(prev):
            out.append(cross(prev, cur, y))
    return out


def cross(a, b, y):
    t = (y - a[1]) / (b[1] - a[1])
    return (a[0] + (b[0] - a[0]) * t, y)


def mark_svg(tone, prefix, height, x=0.0, y=0.0):
    """The A, `height` tall with its box's top-left at (x, y), as <defs> and a <g>."""
    s = height / (MARK_BOX[3] - MARK_BOX[1])
    tx, ty = x - MARK_BOX[0] * s, y - MARK_BOX[1] * s
    g = GRADIENTS[tone]
    defs, parts = [], []
    for key, pts in FACETS.items():
        (x1, y1), (x2, y2), c1, c2 = g[key]
        gid = f"{prefix}-{key}"
        defs.append(f'<linearGradient id="{gid}" gradientUnits="userSpaceOnUse" x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}"><stop offset="0" stop-color="{c1}"/><stop offset="1" stop-color="{c2}"/></linearGradient>')
        for piece in (clip(pts, BAR[0], True), clip(pts, BAR[1], False)):
            if len(piece) >= 3:
                d = "M" + " L".join(f"{num(px)} {num(py)}" for px, py in piece) + " Z"
                # A hair of its own colour around each facet: neighbours overlap
                # by 0.2 units, so no hairline of background shows along the
                # edges they share when a browser draws the A small.
                parts.append(f'<path fill="url(#{gid})" stroke="url(#{gid})" stroke-width=".4" stroke-linejoin="round" d="{d}"/>')
    parts.append(f'<path fill="#FFFFFF" fill-opacity=".18" d="M{" L".join(f"{px} {py}" for px, py in GLINT)} Z"/>')
    parts.append(f'<circle cx="80" cy="20" r="3" fill="{g["dot"]}"/>')
    body = f'<g transform="translate({num(tx)} {num(ty)}) scale({num(s)})">{"".join(parts)}</g>'
    box = (x, y, x + (MARK_BOX[2] - MARK_BOX[0]) * s, y + height)
    return "".join(defs), body, box


# -- Files -------------------------------------------------------------------------
def document(title, defs, body, boxes, pad=1.0):
    x0 = min(b[0] for b in boxes) - pad
    y0 = min(b[1] for b in boxes) - pad
    x1 = max(b[2] for b in boxes) + pad
    y1 = max(b[3] for b in boxes) + pad
    w, h = x1 - x0, y1 - y0
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{num(x0)} {num(y0)} {num(w)} {num(h)}" width="{num(w)}" height="{num(h)}" role="img" aria-label="{title}">'
        f"<title>{title}</title>"
        + (f"<defs>{defs}</defs>" if defs else "")
        + body
        + "</svg>\n"
    )


def build(out):
    os.makedirs(out, exist_ok=True)
    word = Face(WORD_WEIGHT)
    tag = Face(TAG_WEIGHT)
    word_track = word.tracking_for(WORD, FULL["word_cap"], FULL["word_w"])
    tag_track = tag.tracking_for(TAGLINE, FULL["tag_cap"], FULL["tag_w"])
    print(f"wordmark  Figtree {WORD_WEIGHT}, tracking {word_track * 1000:+.1f}/1000 em")
    print(f"tagline   Figtree {TAG_WEIGHT}, tracking {tag_track * 1000:+.1f}/1000 em")

    files = {}
    for tone, word_fill, tag_fill, suffix in (("light", NAVY, RED, ""), ("dark", ON_DARK_WORD, ON_DARK_TAG, "-on-dark")):
        p = f"arv{suffix.replace('-', '')}"
        mdefs, mbody, mbox = mark_svg(tone, f"{p}-m", MARK_H)

        wd, wbox = word.layout(WORD, FULL["word_cap"], FULL["word_x"], FULL["word_base"], word_track)
        td, tbox = tag.layout(TAGLINE, FULL["tag_cap"], FULL["tag_x"], FULL["tag_base"], tag_track)
        files[f"archivyn-lockup{suffix}.svg"] = document(
            "Archivyn: From Archives to You, accelerated by AI", mdefs,
            mbody + f'<path fill="{word_fill}" d="{wd}"/><path fill="{tag_fill}" d="{td}"/>', [mbox, wbox, tbox])

        cd, cbox = word.layout(WORD, COMPACT["word_cap"], COMPACT["word_x"], COMPACT["word_base"], word_track)
        files[f"archivyn-lockup-compact{suffix}.svg"] = document(
            "Archivyn", mdefs, mbody + f'<path fill="{word_fill}" d="{cd}"/>', [mbox, cbox])

        od, obox = word.layout(WORD, FULL["word_cap"], 0, FULL["word_cap"], word_track)
        files[f"archivyn-wordmark{suffix}.svg"] = document("Archivyn", "", f'<path fill="{word_fill}" d="{od}"/>', [obox])

        files[f"archivyn-mark{suffix}.svg"] = document("Archivyn", mdefs, mbody, [mbox])

    for name, text in files.items():
        with open(os.path.join(out, name), "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
        print(f"written   {name:38s} {len(text.encode()) / 1024:5.1f} KB")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", default=DEFAULT_OUT)
    build(os.path.abspath(ap.parse_args().out))
