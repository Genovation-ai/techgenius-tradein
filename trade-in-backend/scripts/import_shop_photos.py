#!/usr/bin/env python3
"""Turn photographs taken in the shop into catalogue images.

Why this exists
---------------
Forty devices in the catalogue have no photograph and fall back to a named
"photo coming soon" plate. Freely-licensed photo libraries were tried and
rejected: of forty devices only nine had a usable match, several searches
returned the wrong handset entirely (a Pixel 4a query returned a microscope
image of a light sensor), and the usable ones were snapshots on grass and
gravel that would have looked less trustworthy beside four hundred clean
studio shots. Photographing the stock is both better and legally simpler,
since the shop owns the result outright.

This makes that a ten-minute job: shoot the devices, name each file after the
catalogue id, run this once.

Shooting notes
--------------
* Plain, evenly lit background — a sheet of white paper is enough.
* Device face-on and upright, filling most of the frame, screen off.
* One device per photo. A second device in shot is how a customer ends up
  selecting the wrong model and getting a quote for it.
* Any phone camera is fine; this script does the cropping and sizing.

Usage
-----
    python3 import_shop_photos.py ~/device-photos            # preview only
    python3 import_shop_photos.py ~/device-photos --apply

Files are named for the catalogue id: ``galaxy-s21.jpg``, ``google-pixel.png``.
Run ``--list-missing`` to print the ids that still need a photograph.
"""
from __future__ import annotations

import argparse
import os
import sqlite3
import sys

try:
    from PIL import Image, ImageChops, ImageFilter
except ImportError:  # pragma: no cover
    sys.exit("Pillow is required:  python3 -m pip install pillow")

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
REPO = os.path.dirname(BACKEND)
DEVICE_DIR = os.path.join(REPO, "trade-in-platform", "public", "devices")
DB_PATH = os.environ.get("TG_DB_PATH") or os.path.join(BACKEND, "data", "tradein.db")

# What the rest of the catalogue uses, so a new photo does not stand out in a
# grid beside four hundred existing ones.
TARGET = (300, 420)
MARGIN = 18
ACCEPTED = {".jpg", ".jpeg", ".png", ".webp", ".heic"}


def catalogue_ids() -> set[str]:
    if not os.path.exists(DB_PATH):
        return set()
    con = sqlite3.connect(DB_PATH)
    try:
        return {r[0] for r in con.execute("SELECT id FROM devices")}
    finally:
        con.close()


def missing_ids() -> list[str]:
    have = {f.rsplit(".", 1)[0] for f in os.listdir(DEVICE_DIR) if f.endswith(".png")}
    return sorted(i for i in catalogue_ids() if i not in have)


def autocrop(im: Image.Image) -> Image.Image:
    """Trim a plain background from around the device.

    Compares the image against a canvas of its own corner colour. A blurred
    copy drives the comparison so sensor noise on a white sheet does not read
    as content and defeat the crop. If nothing is found — a busy background,
    say — the original is returned and the device simply keeps its framing.
    """
    rgb = im.convert("RGB")
    corner = rgb.getpixel((2, 2))
    reference = Image.new("RGB", rgb.size, corner)
    diff = ImageChops.difference(rgb.filter(ImageFilter.GaussianBlur(2)), reference)
    box = ImageChops.add(diff, diff, 2.0, -30).getbbox()
    if not box:
        return im
    w, h = im.size
    pad = int(min(w, h) * 0.02)
    box = (max(0, box[0] - pad), max(0, box[1] - pad), min(w, box[2] + pad), min(h, box[3] + pad))
    # A crop that keeps almost everything, or almost nothing, means the
    # background was not plain. Leave it alone rather than guess.
    area = (box[2] - box[0]) * (box[3] - box[1])
    if area < w * h * 0.05 or area > w * h * 0.98:
        return im
    return im.crop(box)


def normalise(path: str) -> Image.Image:
    im = Image.open(path)
    if im.mode not in ("RGB", "RGBA"):
        im = im.convert("RGB")
    im = autocrop(im)
    inner = (TARGET[0] - MARGIN * 2, TARGET[1] - MARGIN * 2)
    im.thumbnail(inner, Image.LANCZOS)
    canvas = Image.new("RGBA", TARGET, (255, 255, 255, 0))
    canvas.paste(im, ((TARGET[0] - im.width) // 2, (TARGET[1] - im.height) // 2), im if im.mode == "RGBA" else None)
    return canvas


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("folder", nargs="?", help="folder of photos named <device-id>.jpg")
    ap.add_argument("--apply", action="store_true", help="write into public/devices")
    ap.add_argument("--list-missing", action="store_true", help="ids with no photo yet")
    args = ap.parse_args()

    if args.list_missing:
        ids = missing_ids()
        print(f"{len(ids)} devices have no photograph:")
        for i in ids:
            print(" ", i)
        return 0

    if not args.folder:
        ap.error("give a folder, or --list-missing")
    if not os.path.isdir(args.folder):
        ap.error(f"not a folder: {args.folder}")

    known = catalogue_ids()
    written = skipped = 0
    for name in sorted(os.listdir(args.folder)):
        stem, ext = os.path.splitext(name)
        if ext.lower() not in ACCEPTED:
            continue
        # A typo would silently create an image no device ever asks for.
        if known and stem not in known:
            print(f"  SKIP  {name}: '{stem}' is not a device id")
            skipped += 1
            continue
        out = os.path.join(DEVICE_DIR, f"{stem}.png")
        try:
            img = normalise(os.path.join(args.folder, name))
        except Exception as exc:
            print(f"  FAIL  {name}: {exc}")
            skipped += 1
            continue
        verb = "would write" if not args.apply else "wrote"
        if args.apply:
            img.save(out)
        print(f"  {verb}  {stem}.png  ({img.width}x{img.height})")
        written += 1

    print(f"\n{written} photo(s) {'imported' if args.apply else 'ready — re-run with --apply'}, {skipped} skipped")
    if args.apply and written:
        print("Commit public/devices and redeploy; the widget picks them up by id.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
