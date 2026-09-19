#!/usr/bin/env python3
"""Put every device tile on the same canvas with the same breathing room.

Why this exists
---------------
Measured across the catalogue: 410 of 452 tiles were not on the 300x420 canvas
the widget lays out for, 221 had the device pressed against the tile's edge with
no margin at all, and 12 — manufacturer renders showing front and back side by
side — were so wide they shrank to half the height of their neighbours. In a
grid that reads as some phones zoomed in, some cut off, some tiny: exactly what
a customer flagged.

Every tile now goes through one rule. Trim to the device, then fit it so it
stands the same height in every frame, centred, on a transparent ground.
A render showing the device twice (back beside front) is cropped to the front
half first, so it stands as tall as a single-device render would.

Idempotent: running it again changes nothing.
"""
from __future__ import annotations

import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
DEVICE_DIR = os.path.normpath(os.path.join(HERE, "..", "..", "trade-in-platform", "public", "devices"))
CANVAS = (300, 420)
TARGET_FILL = 0.86  # fraction of canvas height the device stands
SIDE_MAX = 0.88     # never wider than this fraction of the canvas


def content_box(im: Image.Image):
    if im.mode == "RGBA":
        box = im.split()[3].getbbox()
        if box:
            return box
    g = im.convert("L").point(lambda p: 255 if p < 245 else 0)
    return g.getbbox()


def pair_gap(im: Image.Image):
    """x of a clear vertical gap in the middle third of a wide image, else None.

    Scans columns for ones that are fully transparent (or white on an opaque
    render). A run of them between 30% and 70% of the width means two separate
    objects; the split point is the right edge of that run.
    """
    w, h = im.size
    if w < h * 1.15:
        return None
    a = im.split()[3] if im.mode == "RGBA" else None
    g = im.convert("L")
    empty = []
    for x in range(int(w * 0.30), int(w * 0.70)):
        col_alpha = [a.getpixel((x, y)) for y in range(0, h, max(1, h // 60))] if a else None
        if col_alpha is not None and max(col_alpha) > 8:
            empty.append(False)
            continue
        if col_alpha is None:
            col = [g.getpixel((x, y)) for y in range(0, h, max(1, h // 60))]
            if min(col) < 240:
                empty.append(False)
                continue
        empty.append(True)
    # need a run of at least 2% of the width
    need = max(2, int(w * 0.02))
    run = 0
    for i, e in enumerate(empty):
        run = run + 1 if e else 0
        if run >= need:
            return int(w * 0.30) + i + 1
    return None


def normalise(im: Image.Image) -> Image.Image:
    im = im.convert("RGBA")
    box = content_box(im)
    if not box:
        return im
    im = im.crop(box)
    w, h = im.size
    # Two views of one device side by side — back beside front — show up as a
    # column of empty pixels between them. That gap is the signal, not the
    # width: a Steam Deck, a Mac mini and a MacBook are all wider than tall and
    # are one object, and treating width as the tell cut every one of them in
    # half. Keep the right-hand view, which is the front on these renders.
    gap = pair_gap(im)
    if gap is not None:
        im = im.crop((gap, 0, w, h))
        box = content_box(im)
        if box:
            im = im.crop(box)
        w, h = im.size
    scale = (CANVAS[1] * TARGET_FILL) / h
    if w * scale > CANVAS[0] * SIDE_MAX:
        scale = (CANVAS[0] * SIDE_MAX) / w
    nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
    im = im.resize((nw, nh), Image.LANCZOS)
    out = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
    out.paste(im, ((CANVAS[0] - nw) // 2, (CANVAS[1] - nh) // 2), im)
    return out


def main() -> int:
    apply = "--apply" in sys.argv
    changed = 0
    for f in sorted(os.listdir(DEVICE_DIR)):
        if not f.endswith(".png") or f.startswith("_"):
            continue
        p = os.path.join(DEVICE_DIR, f)
        try:
            im = Image.open(p)
        except Exception:
            continue
        out = normalise(im)
        if apply:
            out.save(p)
        changed += 1
    print(f"{'normalised' if apply else 'would normalise'} {changed} tiles to {CANVAS[0]}x{CANVAS[1]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
