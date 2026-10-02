"""Write Alyno's mark and lockups into public/brand/alyno/.

    python scripts/brand/alyno_logo.py          (npm run brand:alyno)

Alyno is the scholar directory's AI. Its mark is built only from parts of
Archivyn's A, so the two read as one family:

-- The kite ---------------------------------------------------------------------
The A's peak (navy left, red right) and its reflection beneath it, colours
swapped, meeting at the A's crossbar cut; kite proportions (a short peak over a
long tail); tilted 28 degrees, in flight; the A's point of light at its tip.

A kite flies high, but its string keeps it tied to the ground: every answer
Alyno gives is tied to the scholar's own words. The swapped halves are the two
directions it works in: you ask and it answers; it asks and you teach.

-- The files -------------------------------------------------------------------
alyno-mark                 full colour, 32 px and up
alyno-mark-small           below 32 px: no point of light (it is under a pixel
                           there) and a thicker cut, so the mark stays crisp at 16
alyno-mark-mono-{navy,white,black}
                           one colour, for embossing, stamps, tinted icons: the
                           silhouette and the cut carry it, as the A's do
alyno-lockup               the kite and the word, Archivyn's wordmark spec
Each colour file has an -on-dark twin. Shapes, gradients, the wordmark's face,
weight and tracking all come from archivyn_logo.py; nothing is restated here.
"""

import argparse
import math
import os

from archivyn_logo import COMPACT, FULL, GLINT, GRADIENTS, NAVY, ON_DARK_WORD, WORD, WORD_WEIGHT, Face, document, num

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUT = os.path.join(HERE, "..", "..", "public", "brand", "alyno")

# -- The kite, in the A's own units ------------------------------------------------
CX, TOP = 80.0, 8.0           # the A's apex
PEAK_H, TAIL_H = 78.0, 150.0  # a short peak over a long tail: a kite, not a rhombus
HALF_W = 52.0
CUT = 9.0                     # the A's crossbar, 126 to 135
SMALL_CUT = 24.0              # below 32 px the cut must survive being a pixel
TILT = -28.0                  # in flight

MONO = {"navy": NAVY, "white": "#FFFFFF", "black": "#000000"}


def facets(cut):
    mid = TOP + PEAK_H
    low = mid + cut
    return {
        "peak-left": [(CX, mid), (CX, TOP), (CX - HALF_W, mid)],
        "peak-right": [(CX, mid), (CX, TOP), (CX + HALF_W, mid)],
        "tail-left": [(CX, low), (CX, low + TAIL_H), (CX - HALF_W, low)],
        "tail-right": [(CX, low), (CX, low + TAIL_H), (CX + HALF_W, low)],
    }


# The swap: the peak is the A's (navy left, red right); the tail reverses it.
PAINT = {"peak-left": "left", "peak-right": "right", "tail-left": "right", "tail-right": "left"}


def rotate(p, c, deg):
    a = math.radians(deg)
    x, y = p[0] - c[0], p[1] - c[1]
    return (c[0] + x * math.cos(a) - y * math.sin(a), c[1] + x * math.sin(a) + y * math.cos(a))


def kite(prefix, height, x=0.0, y=0.0, tone="light", cut=CUT, light=True, mono=None):
    """The kite `height` tall (its tilted box), top-left at (x, y): <defs>, <g>, box."""
    f = facets(cut)
    centre = (CX, (TOP + TOP + PEAK_H + cut + TAIL_H) / 2)
    pts = [rotate(p, centre, TILT) for poly in f.values() for p in poly]
    bx0, by0 = min(p[0] for p in pts), min(p[1] for p in pts)
    bx1, by1 = max(p[0] for p in pts), max(p[1] for p in pts)
    s = height / (by1 - by0)
    tx, ty = x - bx0 * s, y - by0 * s
    defs, parts = [], []
    g = GRADIENTS[tone]
    y_top, y_bot = TOP, TOP + PEAK_H + cut + TAIL_H
    for key in ("left", "right"):
        if mono:
            continue
        (_, _), (_, _), c1, c2 = g[key]
        defs.append(f'<linearGradient id="{prefix}-{key}" gradientUnits="userSpaceOnUse" x1="0" y1="{num(y_top)}" x2="0" y2="{num(y_bot)}">'
                    f'<stop offset="0" stop-color="{c1}"/><stop offset="1" stop-color="{c2}"/></linearGradient>')
    if mono:
        # One colour: each half is one shape, so no seam shows down the middle. The
        # swap is a colour idea; drawn as a gap instead, the vertical line and the cut
        # would cross into a Latin cross, so in one colour the silhouette and cut carry it.
        mid = TOP + PEAK_H
        halves = [[(CX - HALF_W, mid), (CX, TOP), (CX + HALF_W, mid)],
                  [(CX - HALF_W, mid + cut), (CX + HALF_W, mid + cut), (CX, mid + cut + TAIL_H)]]
        for poly in halves:
            d = "M" + " L".join(f"{num(px)} {num(py)}" for px, py in poly) + " Z"
            parts.append(f'<path fill="{MONO[mono]}" d="{d}"/>')
    for name, poly in ([] if mono else f.items()):
        fill = f"url(#{prefix}-{PAINT[name]})"
        d = "M" + " L".join(f"{num(px)} {num(py)}" for px, py in poly) + " Z"
        # As in the A: a hair of each facet's own colour so neighbours meet with no seam.
        parts.append(f'<path fill="{fill}" stroke="{fill}" stroke-width=".4" stroke-linejoin="round" d="{d}"/>')
    if light and not mono:
        parts.append(f'<path fill="#FFFFFF" fill-opacity=".18" d="M{" L".join(f"{px} {py}" for px, py in GLINT)} Z"/>')
        parts.append(f'<circle cx="{num(CX)}" cy="20" r="3" fill="{g["dot"]}"/>')
    body = (f'<g transform="translate({num(tx)} {num(ty)}) scale({num(s)}) '
            f'rotate({num(TILT)} {num(centre[0])} {num(centre[1])})">{"".join(parts)}</g>')
    box = (x, y, x + (bx1 - bx0) * s, y + height)
    return "".join(defs), body, box


def build(out):
    os.makedirs(out, exist_ok=True)
    word = Face(WORD_WEIGHT)
    # Archivyn's own tracking, measured the way its script measures it, so the two words match.
    track = word.tracking_for(WORD, FULL["word_cap"], FULL["word_w"])
    files = {}
    mark_h = 223  # Archivyn's mark height, so the two lockups stand at one size
    for tone, word_fill, suffix in (("light", NAVY, ""), ("dark", ON_DARK_WORD, "-on-dark")):
        p = f"aly{suffix.replace('-', '')}"
        defs, body, box = kite(f"{p}-m", mark_h, tone=tone)
        files[f"alyno-mark{suffix}.svg"] = document("Alyno", defs, body, [box], pad=4)

        sdefs, sbody, sbox = kite(f"{p}-s", mark_h, tone=tone, cut=SMALL_CUT, light=False)
        files[f"alyno-mark-small{suffix}.svg"] = document("Alyno", sdefs, sbody, [sbox], pad=4)

        # The word as in Archivyn's compact lockup: same cap height and tracking; centred on the kite.
        cap = COMPACT["word_cap"]
        wx = box[2] + 30
        base = mark_h / 2 + cap / 2
        wd, wbox = word.layout("Alyno", cap, wx, base, track)
        files[f"alyno-lockup{suffix}.svg"] = document("Alyno", defs, body + f'<path fill="{word_fill}" d="{wd}"/>', [box, wbox], pad=4)

    for name in MONO:
        defs, body, box = kite(f"aly-{name}", mark_h, mono=name, light=False)
        files[f"alyno-mark-mono-{name}.svg"] = document("Alyno", defs, body, [box], pad=4)

    for name, text in files.items():
        with open(os.path.join(out, name), "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
        print(f"written   {name:34s} {len(text.encode()) / 1024:5.1f} KB")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", default=DEFAULT_OUT)
    build(os.path.abspath(ap.parse_args().out))
