#!/usr/bin/env python3
"""Writes public/favicon.svg: the hizb star with the letter ghain, for small sizes.

The letter is an SVG path outlined from the site's own Amiri Bold font (glyph uni063A), because an SVG favicon cannot
load web fonts. Green ("zumurrudi nahar") by default, the turquoise night palette under prefers-color-scheme: dark.

    pip install fonttools brotli
    python scripts/gen-favicon.py
    python scripts/gen-favicon.py --full

Then run scripts/gen-share-images.js, which renders favicon-32.png from public/favicon.svg.

--full writes the full variant instead, for the general share image only: thin lines and two faint outer squares, too
fine for a favicon. It goes to scripts/share-icon-full.svg and is not served. public/favicon.svg stays as it is.
"""
import os
import sys

from fontTools.misc.transform import Transform
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
FONT = os.path.join(ROOT, "public", "fonts", "amiri-arabic-700-normal.woff2")
OUT = os.path.join(ROOT, "public", "favicon.svg")
OUT_FULL = os.path.join(ROOT, "scripts", "share-icon-full.svg")
S = 100  # the viewBox side: every length below is its fraction of s times 100
RX = 22.83  # the corner radius: the general share image's icon, 21px on 92px

GREEN = {"bg": "#F2F0E8", "ac": "#1E6B50", "g1": "#8FCBAE", "o1": 0.70, "g2": "#EBC98A", "o2": 0.60}
NIGHT = {"bg": "#0A0E1F", "ac": "#9FB4FF", "g1": "#4B5BDB", "o1": 0.55, "g2": "#2FB5A8", "o2": 0.35}


def ghain_path():
    font = TTFont(FONT)
    glyphs = font.getGlyphSet()
    name = font.getBestCmap()[0x063A]
    if name != "uni063A":
        raise SystemExit("unexpected glyph for U+063A: " + name)
    bounds = BoundsPen(glyphs)
    glyphs[name].draw(bounds)
    x0, y0, x1, y1 = bounds.bounds
    k = 0.40 * S / (y1 - y0)  # ink height 0.40s
    # centred on the ink box; font coordinates grow upwards, SVG coordinates downwards
    t = Transform(k, 0, 0, -k, S / 2 - k * (x0 + x1) / 2, S / 2 + k * (y0 + y1) / 2)
    pen = SVGPathPen(glyphs, ntos=lambda v: ("%.2f" % v).rstrip("0").rstrip("."))
    glyphs[name].draw(TransformPen(pen, t))
    return pen.getCommands()


def palette_css(p):
    return (
        ".b{fill:%(bg)s}.l{stroke:%(ac)s}.f{fill:%(ac)s}"
        ".a{stop-color:%(g1)s}.a0{stop-opacity:%(o1).2f}.c{stop-color:%(g2)s}.c0{stop-opacity:%(o2).2f}" % p
    )


def outer_squares():
    side = 1.12 * 0.60 * S
    corner = S / 2 - side / 2
    square = '<rect x="%g" y="%g" width="%g" height="%g" fill="none" stroke="rgba(30,107,80,.35)" stroke-width="0.8"%s/>'
    return square % (corner, corner, side, side, "") + square % (corner, corner, side, side, ' transform="rotate(45 50 50)"')


def build(css, line, ring, under=""):
    side, half = 0.60 * S, 0.30 * S
    corner = S / 2 - half
    square = '<rect x="%g" y="%g" width="%g" height="%g" fill="none" class="l" stroke-width="%g"%s/>'
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d">' % (S, S, S, S)
        + "<style>" + css + "</style>"
        + '<defs><radialGradient id="g1" gradientUnits="userSpaceOnUse" cx="95" cy="0" r="78">'
        + '<stop offset="0" class="a a0"/><stop offset="1" class="a" stop-opacity="0"/></radialGradient>'
        + '<radialGradient id="g2" gradientUnits="userSpaceOnUse" cx="0" cy="100" r="72">'
        + '<stop offset="0" class="c c0"/><stop offset="1" class="c" stop-opacity="0"/></radialGradient></defs>'
        + '<rect width="100" height="100" rx="%g" class="b"/><rect width="100" height="100" rx="%g" fill="url(#g1)"/>' % (RX, RX)
        + '<rect width="100" height="100" rx="%g" fill="url(#g2)"/>' % RX
        + under
        + square % (corner, corner, side, side, line, "")
        + square % (corner, corner, side, side, line, ' transform="rotate(45 50 50)"')
        + '<circle cx="50" cy="50" r="25.5" fill="none" class="l" stroke-width="%g"/>' % ring
        + '<path class="f" d="' + ghain_path() + '"/></svg>\n'
    )


def main():
    if "--full" in sys.argv[1:]:
        out, svg = OUT_FULL, build(palette_css(GREEN), 2, 0.9, outer_squares())
    else:
        css = palette_css(GREEN) + "@media (prefers-color-scheme:dark){" + palette_css(NIGHT) + "}"
        out, svg = OUT, build(css, 4.2, 2.2)
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        f.write(svg)
    print("wrote", out, len(svg), "bytes")


if __name__ == "__main__":
    main()
