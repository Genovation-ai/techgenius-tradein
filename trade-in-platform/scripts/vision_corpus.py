#!/usr/bin/env python3
"""
Build a labelled corpus for measuring the device scanner.

The scanner has never been measured. Its tests hand written issue objects to
the grading function, which checks that a high-severity crack maps to a low
grade — a mapping that was never in doubt. Nothing has ever asked whether the
computer vision sees a crack in a photograph of a cracked phone, or whether it
sees one in a photograph of an undamaged phone, which is the failure that costs
money: a clean device graded down, an honest customer told their phone is worth
less than it is.

So this makes photographs whose damage is known, because it put it there.
Real product renders are the base — the same images the catalogue serves — and
each is emitted pristine plus once per damage type at three severities. The
pristine copies matter most: they are the only way to count false positives,
and a detector that finds cracks everywhere scores perfectly on damaged phones.

Output is raw RGBA rather than PNG because the scanner reads ImageData and Node
here has no PNG decoder. The manifest says what was done to each frame.
"""

import json
import math
import os
import random
import sys
from PIL import Image, ImageChops, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
DEVICES = os.path.join(HERE, "..", "public", "devices")
OUT = os.path.join(HERE, "..", ".vision-corpus")

# The scanner downscales to 480px; generating near that size measures what it
# actually sees rather than detail it discards.
DIM = 420
SEVERITIES = ("low", "medium", "high")


def base_frames(limit):
    """Real device photographs, flattened onto a plausible background.

    The renders are transparent PNGs; a photograph of a phone has something
    behind it. Flattening onto a mid grey keeps the edge between device and
    background real, which is what the body-damage detectors key on.
    """
    names = sorted(n for n in os.listdir(DEVICES) if n.endswith(".png"))
    random.Random(11).shuffle(names)
    out = []
    for n in names:
        if len(out) >= limit:
            break
        try:
            im = Image.open(os.path.join(DEVICES, n)).convert("RGBA")
        except Exception:
            continue
        bg = Image.new("RGBA", im.size, (138, 140, 145, 255))
        bg.alpha_composite(im)
        im = bg.convert("RGB")
        w, h = im.size
        s = DIM / max(w, h)
        im = im.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)
        canvas = Image.new("RGB", (DIM, DIM), (138, 140, 145))
        canvas.paste(im, ((DIM - im.width) // 2, (DIM - im.height) // 2))
        out.append((n[:-4], canvas))
    return out


def screen_box(im):
    """Roughly where the glass is: the middle of the frame."""
    w, h = im.size
    return (int(w * 0.30), int(h * 0.16), int(w * 0.70), int(h * 0.84))


def add_crack(im, severity):
    """Branching bright fracture lines across the glass.

    A real crack is a tree: one impact point, lines radiating, each throwing
    shorter branches. Straight scratches are a different detector, so the
    branching is the part that has to be right.
    """
    im = im.copy()
    d = ImageDraw.Draw(im)
    x0, y0, x1, y1 = screen_box(im)
    rnd = random.Random(hash(severity) & 0xFFFF)
    trunks = {"low": 2, "medium": 4, "high": 7}[severity]
    width = {"low": 1, "medium": 1, "high": 2}[severity]
    ox = rnd.randint(x0 + 20, x1 - 20)
    oy = rnd.randint(y0 + 20, y1 - 20)
    for _ in range(trunks):
        ang = rnd.uniform(0, math.tau)
        length = rnd.uniform(0.25, 0.75) * (x1 - x0)
        px, py = ox, oy
        for step in range(7):
            ang += rnd.uniform(-0.28, 0.28)
            nx = px + math.cos(ang) * (length / 7)
            ny = py + math.sin(ang) * (length / 7)
            d.line([(px, py), (nx, ny)], fill=(238, 240, 246), width=width)
            if step in (2, 4) and severity != "low":
                ba = ang + rnd.choice((-1, 1)) * rnd.uniform(0.5, 1.1)
                bl = length * 0.3
                d.line(
                    [(nx, ny), (nx + math.cos(ba) * bl, ny + math.sin(ba) * bl)],
                    fill=(226, 230, 238),
                    width=1,
                )
            px, py = nx, ny
    return im


def add_scratch(im, severity):
    """Fine parallel-ish abrasions — mid-frequency texture, not sharp edges."""
    im = im.copy()
    d = ImageDraw.Draw(im)
    x0, y0, x1, y1 = screen_box(im)
    rnd = random.Random((hash(severity) >> 3) & 0xFFFF)
    n = {"low": 6, "medium": 16, "high": 34}[severity]
    for _ in range(n):
        sx = rnd.randint(x0, x1)
        sy = rnd.randint(y0, y1)
        ang = rnd.uniform(-0.6, 0.6)
        ln = rnd.uniform(12, 52)
        d.line(
            [(sx, sy), (sx + math.cos(ang) * ln, sy + math.sin(ang) * ln)],
            fill=(196, 199, 205),
            width=1,
        )
    return im.filter(ImageFilter.GaussianBlur(0.4))


def add_dent(im, severity):
    """A shadowed depression on one edge of the housing — asymmetric by design.

    Placed on the outer edge of the frame, where a dent in a real phone is and
    where the asymmetry metric looks. The first version put it at 31% and 69%
    of the width, inside the device but well inside the left and right bands
    the detector compares, so the measurement could not have seen it wherever
    the detector stood.
    """
    im = im.copy()
    d = ImageDraw.Draw(im)
    w, h = im.size
    rnd = random.Random((hash(severity) >> 5) & 0xFFFF)
    r = {"low": 9, "medium": 16, "high": 26}[severity]
    cx = rnd.choice([int(w * 0.12), int(w * 0.88)])
    cy = rnd.randint(int(h * 0.25), int(h * 0.75))
    for i in range(r, 0, -1):
        k = i / r
        v = int(120 - 80 * (1 - k))
        d.ellipse([cx - i, cy - i, cx + i, cy + i], fill=(v, v, v + 4))
    return im.filter(ImageFilter.GaussianBlur(0.8))


def add_glare(im, severity):
    """A blown-out reflection — the thing that makes a good phone unreadable.

    Added, not blended. The first version of this blended the frame toward a
    mostly-black layer and darkened the whole photograph instead of burning out
    a patch of it: the glare frames came out at 0.230 average brightness
    against 0.501 for the same phone clean, with fewer saturated pixels than
    the original. It made the detector look blind when the frames simply did
    not contain what they claimed to. Lightening drives the hotspot to white
    and leaves the rest of the frame alone, which is what a reflection does.
    """
    im = im.copy()
    w, h = im.size
    rnd = random.Random((hash(severity) >> 7) & 0xFFFF)
    rad = {"low": int(w * 0.13), "medium": int(w * 0.22), "high": int(w * 0.34)}[severity]
    cx = rnd.randint(int(w * 0.38), int(w * 0.62))
    cy = rnd.randint(int(h * 0.32), int(h * 0.68))
    layer = Image.new("RGB", im.size, (0, 0, 0))
    ImageDraw.Draw(layer).ellipse(
        [cx - rad, cy - rad, cx + rad, cy + rad], fill=(255, 255, 255)
    )
    layer = layer.filter(ImageFilter.GaussianBlur(rad * 0.38))
    return ImageChops.lighter(im, layer)


def add_blur(im, severity):
    return im.filter(
        ImageFilter.GaussianBlur({"low": 1.4, "medium": 2.8, "high": 5.0}[severity])
    )


def add_dark(im, severity):
    f = {"low": 0.55, "medium": 0.30, "high": 0.13}[severity]
    return Image.eval(im, lambda v: int(v * f))


DAMAGE = {
    "crack": add_crack,
    "scratch": add_scratch,
    "dent": add_dent,
    "glare": add_glare,
    "blurry": add_blur,
    "dark": add_dark,
}


def main():
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 40
    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT):
        os.remove(os.path.join(OUT, f))

    bases = base_frames(limit)
    manifest = []
    idx = 0

    def emit(img, device, damage, severity):
        nonlocal idx
        name = f"{idx:05d}.rgba"
        img.convert("RGBA").tobytes()
        with open(os.path.join(OUT, name), "wb") as fh:
            fh.write(img.convert("RGBA").tobytes())
        manifest.append(
            {
                "file": name,
                "width": img.width,
                "height": img.height,
                "device": device,
                "damage": damage,
                "severity": severity,
            }
        )
        idx += 1

    for device, im in bases:
        emit(im, device, "none", "none")
        for dmg, fn in DAMAGE.items():
            for sev in SEVERITIES:
                emit(fn(im, sev), device, dmg, sev)

    with open(os.path.join(OUT, "manifest.json"), "w") as fh:
        json.dump(manifest, fh)

    pristine = sum(1 for m in manifest if m["damage"] == "none")
    print(f"corpus: {len(manifest)} frames from {len(bases)} devices")
    print(f"  pristine (false-positive probes): {pristine}")
    print(f"  damaged: {len(manifest) - pristine} across {len(DAMAGE)} types x 3 severities")


if __name__ == "__main__":
    main()
