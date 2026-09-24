#!/usr/bin/env python3
"""
Build a catalog product image for a device known only by name.

Strategy:
1. Prefer cloning the nearest existing family asset (e.g. iPhone 16 → iPhone 17).
2. Otherwise draw a clean product-card silhouette with brand colors + model label.
Writes PNG to trade-in-platform/public/devices/{slug}.png
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parent.parent.parent
DEVICES_DIR = ROOT / "trade-in-platform" / "public" / "devices"

BRAND_COLORS = {
    "apple": ((18, 18, 20), (245, 245, 247), (90, 90, 95)),
    "samsung": ((10, 28, 58), (232, 242, 255), (40, 98, 180)),
    "google": ((20, 24, 28), (232, 248, 240), (52, 168, 83)),
    "oneplus": ((28, 10, 10), (255, 236, 232), (220, 54, 46)),
    "motorola": ((12, 24, 48), (230, 240, 255), (56, 110, 200)),
    "huawei": ((28, 12, 12), (255, 240, 235), (200, 40, 40)),
    "microsoft": ((16, 32, 56), (232, 242, 255), (0, 120, 212)),
    "default": ((16, 22, 34), (236, 242, 250), (70, 110, 170)),
}

# Single source of truth for stem resolution lives in image_aliases.py and is
# shared with backfill_device_images.py and audit_device_images.py so the
# scripts can never disagree on which image a device maps to.
from image_aliases import resolve_stem


def slugify(name: str) -> str:
    s = name.strip().lower()
    s = s.replace("+", " plus ").replace("&", " and ")
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return re.sub(r"-+", "-", s).strip("-") or "device"


def detect_brand(name: str) -> str:
    n = name.lower()
    if "iphone" in n or "ipad" in n or "macbook" in n or "apple" in n or "watch series" in n:
        return "apple"
    if "galaxy" in n or "samsung" in n or re.search(r"\bs2[0-9]\b", n) or "z fold" in n or "z flip" in n:
        return "samsung"
    if "pixel" in n or "google" in n:
        return "google"
    if "oneplus" in n or "one plus" in n:
        return "oneplus"
    if "nothing" in n:
        return "default"
    if "moto" in n or "motorola" in n:
        return "motorola"
    if "huawei" in n:
        return "huawei"
    if "surface" in n or "xbox" in n:
        return "microsoft"
    return "default"


def _existing_stems() -> dict[str, Path]:
    """stem -> file path for every product image on disk."""
    out: dict[str, Path] = {}
    if not DEVICES_DIR.exists():
        return out
    for p in DEVICES_DIR.iterdir():
        if p.is_file() and p.suffix.lower() in (".png", ".webp", ".jpg", ".jpeg"):
            out.setdefault(p.stem, p)
    return out


def find_base_image(name: str, slug: str) -> Path | None:
    """Find an existing photo *of this same model* to adapt.

    Deliberately never returns a neighbouring generation's photo. A device we
    have no photo of gets a labelled silhouette instead — a shopper picking
    "iPhone 18" must not be shown an iPhone 17, because picking the wrong tile
    produces the wrong quote and a bad hand-off downstream.
    """
    stems = _existing_stems()
    for candidate in (slug, slug.replace("apple-", ""), f"apple-{slug}"):
        if candidate in stems:
            return stems[candidate]

    stem = resolve_stem(name, set(stems.keys()))
    return stems[stem] if stem else None


# Bold first, then regular, across macOS / Linux / Windows. The previous list
# held only three Linux paths, so on macOS every lookup fell through to
# ImageFont.load_default() — a fixed tiny bitmap that silently ignores `size`,
# which is why generated labels came out unreadable.
_FONT_CANDIDATES_BOLD = (
    ("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 0),
    ("/System/Library/Fonts/HelveticaNeue.ttc", 1),
    ("/System/Library/Fonts/Helvetica.ttc", 1),
    ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 0),
    ("/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf", 0),
    ("C:/Windows/Fonts/arialbd.ttf", 0),
)
_FONT_CANDIDATES_REGULAR = (
    ("/System/Library/Fonts/Supplemental/Arial.ttf", 0),
    ("/System/Library/Fonts/Helvetica.ttc", 0),
    ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 0),
    ("/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf", 0),
    ("C:/Windows/Fonts/arial.ttf", 0),
)


def load_font(size: int, bold: bool = True):
    """A real scalable font at `size`, or the bitmap default as a last resort."""
    for path, index in (_FONT_CANDIDATES_BOLD if bold else _FONT_CANDIDATES_REGULAR):
        if not Path(path).exists():
            continue
        try:
            return ImageFont.truetype(path, size=size, index=index)
        except (OSError, ValueError):
            continue
    return ImageFont.load_default()


def _fit_font(draw: ImageDraw.ImageDraw, text: str, max_width: int, start: int, bold=True, floor=11):
    """Largest size at or below `start` whose text fits `max_width`."""
    size = start
    while size > floor:
        font = load_font(size, bold=bold)
        if draw.textbbox((0, 0), text, font=font)[2] <= max_width:
            return font
        size -= 1
    return load_font(floor, bold=bold)


def _vertical_gradient(size, top_rgb, bottom_rgb) -> Image.Image:
    """Smooth top-to-bottom gradient, drawn once per row."""
    width, height = size
    grad = Image.new("RGB", (1, height))
    for y in range(height):
        t = y / max(1, height - 1)
        grad.putpixel(
            (0, y),
            tuple(int(top_rgb[i] + (bottom_rgb[i] - top_rgb[i]) * t) for i in range(3)),
        )
    return grad.resize((width, height), Image.BILINEAR)


def _rounded_mask(size, box, radius) -> Image.Image:
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(box, radius=radius, fill=255)
    return mask


def _parse_rgb(s: str | None, default: tuple[int, int, int]) -> tuple[int, int, int]:
    if not s:
        return default
    try:
        parts = [int(p) for p in s.split(",")]
        return (parts[0], parts[1], parts[2]) if len(parts) == 3 else default
    except Exception:
        return default


def draw_silhouette(name: str, brand: str, size=(300, 420), *,
                    shape: str = "phone",
                    bg: str | None = None,
                    accent: str | None = None) -> Image.Image:
    """Render a product tile for a device we have no photograph of.

    This is a stand-in, but it has to read as a *product*, not as a fault. The
    previous version drew a white outline around a near-black fill, which in an
    image-first picker looked like a dead handset or a broken image — the tile a
    shopper skips. So: a lit screen with a brand-tinted wallpaper, a metallic
    bezel, depth from a soft glow and a floor shadow, and the model name set
    large enough to actually read at grid size.

    Filenames keep the _silhouette prefix so an audit can still tell a real
    photograph from one of these.
    """
    bg_default, _fg_default, accent_default = BRAND_COLORS.get(brand, BRAND_COLORS["default"])
    bg_rgb = _parse_rgb(bg, bg_default)
    accent_rgb = _parse_rgb(accent, accent_default)
    width, height = size

    # Background: gradient, lighter at the top so the device reads as lit.
    top = tuple(min(255, c + 26) for c in bg_rgb)
    bottom = tuple(max(0, c - 12) for c in bg_rgb)
    img = _vertical_gradient(size, top, bottom).convert("RGBA")

    # Soft accent glow behind where the device will sit.
    glow = Image.new("RGBA", size, (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse(
        (width * 0.10, height * 0.10, width * 0.90, height * 0.78),
        fill=(*accent_rgb, 90),
    )
    img = Image.alpha_composite(img, glow.filter(ImageFilter.GaussianBlur(46)))

    shape = (shape or "phone").lower()
    label_top = height - 64

    # Geometry per category: (body box, corner radius, screen inset)
    if shape in ("tablet",):
        body, radius, inset = [46, 44, width - 46, label_top - 26], 20, 9
    elif shape in ("laptop", "computer", "desktop", "monitor"):
        body, radius, inset = [30, 74, width - 30, label_top - 78], 12, 8
    elif shape in ("watch", "smartwatch"):
        body, radius, inset = [86, 104, width - 86, label_top - 96], 46, 10
    elif shape in ("console", "gaming-console"):
        body, radius, inset = [52, 116, width - 52, label_top - 44], 22, 0
    elif shape in ("headset", "vr"):
        body, radius, inset = [40, 140, width - 40, label_top - 84], 44, 12
    else:  # phone
        body, radius, inset = [84, 56, width - 84, label_top - 22], 34, 8

    # Floor shadow, so the device sits on the background instead of floating.
    shadow = Image.new("RGBA", size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).ellipse(
        (body[0] + 8, body[3] - 14, body[2] - 8, body[3] + 20), fill=(0, 0, 0, 130)
    )
    img = Image.alpha_composite(img, shadow.filter(ImageFilter.GaussianBlur(15)))

    draw = ImageDraw.Draw(img)

    # Bezel: a light metallic frame rather than a flat white outline.
    bezel = _vertical_gradient(
        (body[2] - body[0], body[3] - body[1]), (236, 238, 242), (176, 180, 190)
    ).convert("RGBA")
    img.paste(bezel, (body[0], body[1]),
              _rounded_mask(bezel.size, [0, 0, bezel.size[0] - 1, bezel.size[1] - 1], radius))
    draw = ImageDraw.Draw(img)

    if inset:
        screen = [body[0] + inset, body[1] + inset, body[2] - inset, body[3] - inset]
        # A lit screen carrying the brand accent — the single biggest reason the
        # old tiles looked broken was that this was solid black.
        wallpaper = _vertical_gradient(
            (screen[2] - screen[0], screen[3] - screen[1]),
            tuple(min(255, int(c * 0.85) + 34) for c in accent_rgb),
            tuple(max(0, int(c * 0.34)) for c in accent_rgb),
        ).convert("RGBA")
        img.paste(wallpaper, (screen[0], screen[1]),
                  _rounded_mask(wallpaper.size,
                                [0, 0, wallpaper.size[0] - 1, wallpaper.size[1] - 1],
                                max(4, radius - inset)))
        draw = ImageDraw.Draw(img)

        # Diagonal glass reflection.
        gloss = Image.new("RGBA", size, (0, 0, 0, 0))
        ImageDraw.Draw(gloss).polygon(
            [(screen[0], screen[1]),
             (screen[0] + (screen[2] - screen[0]) * 0.60, screen[1]),
             (screen[0], screen[1] + (screen[3] - screen[1]) * 0.72)],
            fill=(255, 255, 255, 30),
        )
        img = Image.alpha_composite(img, gloss.filter(ImageFilter.GaussianBlur(9)))
        draw = ImageDraw.Draw(img)

        if shape in ("phone", "smartphone"):
            # Camera island, wider on Pro models — a small cue that this is a phone.
            island_w = 74 if "pro" in name.lower() else 52
            cx = width // 2
            draw.rounded_rectangle(
                [cx - island_w // 2, body[1] + inset + 7, cx + island_w // 2, body[1] + inset + 23],
                radius=9, fill=(16, 18, 24, 235),
            )

    if shape in ("laptop", "computer", "desktop"):
        # Keyboard deck under the screen.
        deck = [body[0] - 22, body[3] + 4, body[2] + 22, body[3] + 20]
        draw.rounded_rectangle(deck, radius=6, fill=(206, 210, 218, 255))
        draw.rounded_rectangle(
            [width // 2 - 26, deck[1] + 5, width // 2 + 26, deck[1] + 8], radius=2,
            fill=(150, 155, 165, 255),
        )
    elif shape in ("watch", "smartwatch"):
        # Strap above and below, plus the crown.
        strap_w = (body[2] - body[0]) // 2
        cx = width // 2
        draw.rounded_rectangle([cx - strap_w // 2, body[1] - 42, cx + strap_w // 2, body[1] + 12],
                               radius=12, fill=(58, 62, 70, 255))
        draw.rounded_rectangle([cx - strap_w // 2, body[3] - 12, cx + strap_w // 2, body[3] + 42],
                               radius=12, fill=(58, 62, 70, 255))
        draw.rounded_rectangle([body[2] - 3, (body[1] + body[3]) // 2 - 13,
                                body[2] + 9, (body[1] + body[3]) // 2 + 13],
                               radius=5, fill=(198, 202, 210, 255))
    elif shape in ("console", "gaming-console"):
        draw.rounded_rectangle(
            [width // 2 - 7, body[1] + 16, width // 2 + 7, body[3] - 16],
            radius=6, fill=(*accent_rgb, 255),
        )

    # No caption, no badge. The card already prints the model name directly
    # under the tile, so a name burned into the picture says it twice — and
    # says it in a bar that covers the device. "New device · image built" and
    # "Photo coming soon" are worse than redundant: they are our internal
    # vocabulary telling a customer the picture is not real, on the screen
    # where they are choosing which phone is theirs.

    return img.convert("RGB")


def adapt_base(base: Path, name: str, brand: str, size=(300, 420)) -> Image.Image:
    src = Image.open(base).convert("RGBA")
    # Fit into canvas with brand wash
    bg, _fg, accent = BRAND_COLORS.get(brand, BRAND_COLORS["default"])
    canvas = Image.new("RGBA", size, (*bg, 255))
    fitted = ImageOps.contain(src, (size[0] - 36, size[1] - 90))
    # slight brand tint for "new gen" feel
    tinted = ImageEnhance.Color(fitted).enhance(1.05)
    tinted = ImageEnhance.Contrast(tinted).enhance(1.04)
    ox = (size[0] - tinted.width) // 2
    oy = 28
    canvas.alpha_composite(tinted, (ox, oy))

    # No caption, no badge. The card already prints the model name directly
    # under the tile, so a name burned into the picture says it twice — and
    # says it in a bar that covers the device. "New device · image built" and
    # "Photo coming soon" are worse than redundant: they are our internal
    # vocabulary telling a customer the picture is not real, on the screen
    # where they are choosing which phone is theirs.
    return canvas.convert("RGB")


def build(name: str, slug: str | None = None, force: bool = False) -> dict:
    DEVICES_DIR.mkdir(parents=True, exist_ok=True)
    slug = slugify(slug or name)
    out = DEVICES_DIR / f"{slug}.png"
    brand = detect_brand(name)
    if out.exists() and not force:
        return {"ok": True, "path": str(out), "image_url": f"/devices/{slug}.png", "method": "existing", "slug": slug}

    base = find_base_image(name, slug)
    if base is not None:
        img = adapt_base(base, name, brand)
        method = f"adapted:{base.name}"
    else:
        img = draw_silhouette(name, brand)
        method = "silhouette"

    img.save(out, format="PNG", optimize=True)
    return {
        "ok": True,
        "path": str(out),
        "image_url": f"/devices/{slug}.png",
        "method": method,
        "slug": slug,
        "brand": brand,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", required=True)
    ap.add_argument("--slug")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    result = build(args.name, args.slug, force=args.force)
    import json

    print(json.dumps(result))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
