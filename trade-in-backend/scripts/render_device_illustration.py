#!/usr/bin/env python3
"""Draw an accurate product illustration for a device we have no photograph of.

Why this exists
---------------
Twenty-five catalogue devices have no photograph anywhere we can legitimately
use — mostly legacy Pixels and Galaxy Tabs, which no free image library
documents with a clean single-device shot. The fallback was a generic handset
plate with "Photo coming soon" printed on it: the same silhouette whatever you
were selling, which read as a missing image rather than a product.

This draws the actual device instead. Not a photograph and not pretending to be
one, but not generic either: the proportions come from the manufacturer's own
millimetre dimensions, and the front is drawn the way that model's front
actually looks — a home button on an iPad, the forehead and chin bezels of a
2016 Pixel, the notch on a Pixel 3 XL, the corner punch-hole on an S10e.

A shopper picking their device from a grid needs the tile to look like the thing
in their hand. Getting the shape and the era right does most of that work; the
model name underneath does the rest.

Output matches the photographs it sits beside: device only, transparent
background, 300x420, so a grid of mixed photographs and illustrations reads as
one set.

Usage
-----
    python3 render_device_illustration.py --spec specs.json --out-dir ./out
    python3 render_device_illustration.py --name "Google Pixel 3" --slug google-pixel-3
"""
from __future__ import annotations

import argparse
import json
import os
import re
from typing import Any

from PIL import Image, ImageDraw, ImageFilter

CANVAS = (300, 420)
SS = 4  # supersample factor; edges on a 300px tile are very visible


def brand_of(name: str) -> str:
    n = name.lower()
    if any(k in n for k in ("ipad", "iphone", "apple", "macbook")):
        return "apple"
    if any(k in n for k in ("galaxy", "samsung")):
        return "samsung"
    if "pixel" in n:
        return "google"
    return "other"


# Body colours chosen to read as the metal these devices are actually made of,
# not as brand marketing colours.
BODY = {
    "apple": ((72, 74, 78), (140, 143, 148)),
    "samsung": ((38, 41, 48), (120, 126, 138)),
    "google": ((46, 48, 52), (128, 132, 140)),
    "other": ((52, 54, 58), (126, 130, 138)),
}


def aspect_for(spec: dict[str, Any]) -> float:
    """Height / width. Real dimensions when the manufacturer published them."""
    h, w = spec.get("h"), spec.get("w")
    if h and w:
        return float(h) / float(w)
    name = spec.get("name", "").lower()
    # Class defaults for the devices whose dimensions were never imported.
    if "ipad" in name:
        return 4 / 3  # every iPad in this catalogue is a 4:3 panel
    if "tab" in name:
        return 16 / 10
    return 2.0  # a modern handset


def front_style(spec: dict[str, Any]) -> str:
    """What the front of this specific model looks like."""
    name = spec.get("name", "").lower()
    year = int(spec.get("release") or 0)
    if "ipad" in name or "tab" in name:
        return "home"  # every tablet here predates the button being dropped
    if "s4" in name or (brand_of(name) == "samsung" and year and year <= 2016):
        return "home"
    if "3 xl" in name or "3a xl" in name:
        return "notch"
    if year >= 2019:
        return "hole"
    if year and year <= 2017:
        return "bezel"  # Pixel and Pixel 2: real forehead and chin
    return "slim"


def render(spec: dict[str, Any]) -> Image.Image:
    name = spec.get("name", "Device")
    brand = brand_of(name)
    dark, light = BODY[brand]
    style = front_style(spec)
    ratio = aspect_for(spec)

    W, H = CANVAS[0] * SS, CANVAS[1] * SS
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Fit the body to the canvas with a margin, preserving the real aspect.
    margin = int(H * 0.055)
    max_h, max_w = H - margin * 2, W - margin * 2
    bh = max_h
    bw = bh / ratio
    if bw > max_w:
        bw = max_w
        bh = bw * ratio
    bw, bh = int(bw), int(bh)
    x0, y0 = (W - bw) // 2, (H - bh) // 2
    x1, y1 = x0 + bw, y0 + bh
    radius = int(bw * (0.055 if style == "home" else 0.11))

    # Contact shadow, so the device sits on something.
    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle(
        [x0 + bw * 0.06, y1 - bh * 0.02, x1 - bw * 0.06, y1 + bh * 0.035],
        radius=radius, fill=(0, 0, 0, 70))
    img = Image.alpha_composite(img, sh.filter(ImageFilter.GaussianBlur(SS * 6)))
    d = ImageDraw.Draw(img)

    # Metal body, with a lighter rim so the edge catches light.
    d.rounded_rectangle([x0, y0, x1, y1], radius=radius, fill=(*light, 255))
    inset = max(2, int(bw * 0.012))
    d.rounded_rectangle([x0 + inset, y0 + inset, x1 - inset, y1 - inset],
                        radius=radius - inset // 2, fill=(*dark, 255))

    # Screen. Bezels are era-specific: this is most of what makes a 2016 Pixel
    # read as a 2016 Pixel rather than as a current phone.
    if style == "home":
        top_b, side_b = bh * 0.075, bw * 0.055
        bot_b = bh * 0.105
    elif style == "bezel":
        top_b, side_b, bot_b = bh * 0.085, bw * 0.045, bh * 0.095
    elif style == "slim":
        top_b, side_b, bot_b = bh * 0.05, bw * 0.035, bh * 0.06
    else:
        top_b, side_b, bot_b = bh * 0.022, bw * 0.028, bh * 0.028
    s = [x0 + side_b, y0 + top_b, x1 - side_b, y1 - bot_b]
    d.rounded_rectangle(s, radius=max(3, int(radius * 0.75)), fill=(12, 13, 16, 255))

    sw, shh = s[2] - s[0], s[3] - s[1]
    cx = (s[0] + s[2]) / 2

    if style == "notch":
        nw, nh = sw * 0.34, shh * 0.045
        d.rounded_rectangle([cx - nw / 2, s[1], cx + nw / 2, s[1] + nh],
                            radius=int(nh * 0.45), fill=(8, 9, 11, 255))
    elif style == "hole":
        # Drawn a touch larger than life with a faint rim. At 300px the true
        # scale of a punch-hole disappears, and it is the one feature that
        # separates these models from a plain black rectangle.
        r = sw * 0.042
        hx = s[0] + sw * 0.86 if brand == "samsung" else s[0] + sw * 0.13
        hy = s[1] + shh * 0.042
        d.ellipse([hx - r * 1.35, hy - r * 1.35, hx + r * 1.35, hy + r * 1.35],
                  fill=(30, 32, 37, 255))
        d.ellipse([hx - r, hy - r, hx + r, hy + r], fill=(5, 6, 8, 255))
    elif style in ("home", "bezel"):
        # Front camera and earpiece live on the forehead.
        r = bw * 0.016
        d.ellipse([cx - sw * 0.16 - r, y0 + top_b / 2 - r, cx - sw * 0.16 + r, y0 + top_b / 2 + r],
                  fill=(28, 30, 34, 255))
        ew = sw * 0.16
        d.rounded_rectangle([cx - ew / 2, y0 + top_b / 2 - bw * 0.008,
                             cx + ew / 2, y0 + top_b / 2 + bw * 0.008],
                            radius=int(bw * 0.008), fill=(28, 30, 34, 255))

    if style == "home":
        r = bw * 0.062
        cyb = y1 - bot_b / 2
        d.ellipse([cx - r, cyb - r, cx + r, cyb + r], outline=(150, 154, 160, 255),
                  width=max(2, int(bw * 0.008)))

    # A single soft diagonal on the glass. Screens are reflective; a flat black
    # rectangle reads as a dead panel, which is the impression this replaces.
    gl = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(gl).polygon(
        [(s[0], s[1] + shh * 0.30), (s[2], s[1] - shh * 0.02),
         (s[2], s[1] + shh * 0.18), (s[0], s[1] + shh * 0.62)],
        fill=(255, 255, 255, 16))
    mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(mask).rounded_rectangle(s, radius=max(3, int(radius * 0.75)), fill=255)
    img = Image.alpha_composite(img, Image.composite(gl, Image.new("RGBA", (W, H), (0, 0, 0, 0)), mask))

    return img.resize(CANVAS, Image.LANCZOS)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec", help="JSON map of slug -> spec")
    ap.add_argument("--name")
    ap.add_argument("--slug")
    ap.add_argument("--out-dir", default=".")
    a = ap.parse_args()
    os.makedirs(a.out_dir, exist_ok=True)

    specs: dict[str, Any]
    if a.spec:
        specs = json.load(open(a.spec))
    elif a.name:
        slug = a.slug or re.sub(r"[^a-z0-9]+", "-", a.name.lower()).strip("-")
        specs = {slug: {"name": a.name, "slug": slug}}
    else:
        ap.error("give --spec or --name")

    for slug, spec in specs.items():
        spec.setdefault("name", slug)
        img = render(spec)
        out = os.path.join(a.out_dir, f"{slug}.png")
        img.save(out)
        print(f"  {slug:36s} {front_style(spec):6s} ratio {aspect_for(spec):.2f}")
    print(f"\n{len(specs)} illustration(s) written to {a.out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
