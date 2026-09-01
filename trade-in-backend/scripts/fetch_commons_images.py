#!/usr/bin/env python3
"""Source real product photos from Wikimedia Commons for devices that have none.

Why this is cautious to the point of refusing most candidates
------------------------------------------------------------
A naive search actively misleads. "Google Pixel 2" returns Pixel XL photos;
"iPad mini 2" returns a "Mini 3 vs Mini 2" comparison. Accepting those would put
the wrong handset in front of a shopper — the exact defect the catalog was
cleaned to remove — and a wrong photo is worse than an honest placeholder,
because the shopper believes it.

So a candidate is accepted only when the file title names this model and could
not plausibly be another: every token of the model must appear, no OTHER model
number may appear, and anything that is not a plain product shot (logo,
screenshot, teardown, box, comparison) is rejected. Everything uncertain is left
as a placeholder and reported, for a human to handle.

Licence: only files under CC/public-domain terms are taken, and attribution is
written to devices/IMAGE_CREDITS.json so it can be published.

    python3 scripts/fetch_commons_images.py            # dry run, shows decisions
    python3 scripts/fetch_commons_images.py --apply
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
import urllib.parse
import urllib.request
from pathlib import Path

from image_aliases import SILHOUETTE_PREFIX, model_key

DB = Path(__file__).resolve().parent.parent / "data" / "tradein.db"
DEVICES = Path(__file__).resolve().parent.parent.parent / "trade-in-platform" / "public" / "devices"
CREDITS = DEVICES / "IMAGE_CREDITS.json"
UA = {"User-Agent": "TechGeniusCatalog/1.0 (device buyback catalog; hello@techgenius.ca)"}

# Not a plain product shot.
REJECT_TITLE = re.compile(
    r"\b(vs|versus|comparison|compared|logo|icon|screenshot|screen shot|ui|odin|recovery|"
    r"teardown|disassembl|repair|box|packaging|sim|charger|cable|case|advert|billboard|"
    r"store|queue|launch|event|hand|held|person|man|woman|prototype|concept|render)\b",
    re.I,
)
OK_LICENCE = re.compile(r"(^cc[ -]|public domain|cc0)", re.I)


def looks_like_product_shot(data: bytes) -> tuple[bool, str]:
    """Reject correct-but-unusable photos.

    Matching the right device is only half the job. Commons is full of genuine
    product photography that is useless in a catalog grid: a Galaxy S4 propped
    on garden gravel, a dark corner-crop of an iPad on a desk. Next to 390 clean
    renders they read as broken, and the shopper cannot identify their device.

    Product renders sit on white or transparency and are roughly portrait;
    snapshots have busy corners and landscape framing.
    """
    from io import BytesIO
    from PIL import Image

    try:
        im = Image.open(BytesIO(data)).convert("RGBA")
    except Exception as exc:
        return False, f"unreadable image ({exc})"

    w, h = im.size
    if w < 200 or h < 200:
        return False, f"too small ({w}x{h})"
    aspect = w / h
    if not (0.45 <= aspect <= 1.35):
        return False, f"wrong shape for a tile ({w}x{h})"

    px = im.load()
    clean = 0
    for x, y in ((2, 2), (w - 3, 2), (2, h - 3), (w - 3, h - 3)):
        r, g, b, a = px[x, y]
        if a < 32 or (r + g + b) / 3 >= 228:
            clean += 1
    if clean < 3:
        return False, "busy background — snapshot, not a product shot"
    return True, "ok"


def api(params: dict) -> dict:
    url = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
        return json.load(r)


def tokens(text: str) -> list[str]:
    return [t for t in re.split(r"[^a-z0-9]+", text.lower()) if t]


# Words that name a DIFFERENT variant when they appear and we did not ask for
# them. "Pixel 2" must not accept a "Pixel Fold" or "Pixel XL" photo.
VARIANT_WORDS = {
    "xl", "fold", "flip", "pro", "max", "plus", "ultra", "mini", "air", "edge",
    "lite", "fe", "se", "classic", "note", "tab", "watch", "book", "a9", "s8",
}


def other_model_numbers(title: str, wanted: set[str]) -> bool:
    """True if the title carries a model number this device does not claim.

    No digits are whitelisted. An earlier version treated 1-4 as always
    acceptable, which is precisely the range these model names live in, so
    "iPad Air" happily accepted an "iPad Air 2" photo.
    """
    nums = {t for t in tokens(title) if re.fullmatch(r"\d{1,4}[a-z]?", t)}
    return bool(nums - wanted)


# Decorations that describe the photo, not the product.
DECORATION = re.compile(
    r"\((?:[^)]*)\)|"                                  # (Titanium Grey), (15463556650)
    r"\s[-–]\s*(front|back|side|rear|top|angled|open|closed|white|black|silver|gold|blue|grey|gray)\b|"
    r"\b(front|back|rear|side|view|photo|image|closeup|close up)\b",
    re.I,
)


def confident_match(title: str, key: str) -> bool:
    """Accept only when the filename names exactly this model and nothing else.

    Two rounds of heuristic filtering still let a Pixel Tablet through as a
    "Google Pixel" and a Tab S through as a P1000 Galaxy Tab, because Commons
    filenames are free-form prose. So the bar is now equality: strip the brand
    and photo decorations, and what remains must BE the model name. That
    rejects plenty of usable photos, which is the right trade — an honest
    placeholder costs nothing, a confidently wrong handset costs a sale and the
    shopper's trust.
    """
    stem = re.sub(r"^file:", "", title, flags=re.I)
    stem = re.sub(r"\.(jpg|jpeg|png|webp)$", "", stem, flags=re.I)
    if REJECT_TITLE.search(stem):
        return False
    stem = DECORATION.sub(" ", stem)
    stem = _LEADING_BRAND_RE.sub(" ", " " + stem)
    left = tokens(stem)
    want = tokens(key)
    return bool(want) and left == want


_LEADING_BRAND_RE = re.compile(
    r"\s(apple|samsung|google|motorola|microsoft|sony|lg|huawei|oneplus|asus|lenovo|nokia|htc)\b",
    re.I,
)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    conn = sqlite3.connect(DB)
    rows = conn.execute(
        "SELECT id, name, brand_id FROM devices WHERE enabled = 1 AND image_url LIKE ?",
        (f"%{SILHOUETTE_PREFIX}%",),
    ).fetchall()
    if args.limit:
        rows = rows[: args.limit]

    credits = json.loads(CREDITS.read_text()) if CREDITS.exists() else {}
    accepted, rejected = [], []

    for device_id, name, brand_id in rows:
        key = model_key(name)
        brand = (brand_id or "").split("-")[0]
        # Several phrasings, because Commons files are named inconsistently:
        # "Samsung Galaxy S II.png" but also plain "Pixel C.png". Widening the
        # search does not widen what is accepted — every candidate still has to
        # clear the exact-name and product-shot gates below.
        queries = [
            f"{brand} {key}",
            key,
            f"{key} {'tablet' if 'tab' in key or 'ipad' in key else 'smartphone'}",
            key.replace(" ", "-"),
        ]
        pages, seen_titles = [], set()
        for q in dict.fromkeys(qq.strip() for qq in queries if qq.strip()):
            try:
                res = api({
                    "action": "query", "format": "json", "generator": "search",
                    "gsrsearch": f"filetype:bitmap {q}", "gsrnamespace": "6", "gsrlimit": "12",
                    "prop": "imageinfo", "iiprop": "url|extmetadata|mime", "iiurlwidth": "800",
                })
            except Exception:
                continue
            for pg in (res.get("query", {}).get("pages") or {}).values():
                if pg.get("title") not in seen_titles:
                    seen_titles.add(pg.get("title"))
                    pages.append(pg)
        pick = None
        for p in pages:
            info = p.get("imageinfo", [{}])[0]
            md = info.get("extmetadata", {})
            lic = md.get("LicenseShortName", {}).get("value", "")
            if not OK_LICENCE.search(lic or ""):
                continue
            if not confident_match(p.get("title", ""), key):
                continue
            pick = {
                "title": p["title"],
                "url": info.get("thumburl") or info.get("url"),
                "licence": lic,
                "artist": re.sub(r"<[^>]+>", "", md.get("Artist", {}).get("value", "") or "").strip()[:120],
                "page": info.get("descriptionurl", ""),
            }
            break

        if not pick:
            rejected.append((name, f"no confident match among {len(pages)} results"))
            continue

        accepted.append((device_id, name, pick))
        if args.apply:
            try:
                req = urllib.request.Request(pick["url"], headers=UA)
                with urllib.request.urlopen(req, timeout=45) as r:
                    data = r.read()
                good, why = looks_like_product_shot(data)
                if not good:
                    rejected.append((name, f"correct device but {why}"))
                    continue
                out = DEVICES / f"{device_id}.png"
                out.write_bytes(data)
                conn.execute("UPDATE devices SET image_url = ? WHERE id = ?", (f"/devices/{out.name}", device_id))
                credits[out.name] = {
                    "device": name, "source": "Wikimedia Commons",
                    "file": pick["title"], "licence": pick["licence"],
                    "artist": pick["artist"], "page": pick["page"],
                }
            except Exception as exc:
                rejected.append((name, f"download failed: {exc}"))

    if args.apply:
        conn.commit()
        CREDITS.write_text(json.dumps(credits, indent=2, sort_keys=True))
    conn.close()

    print("=" * 76)
    print("WIKIMEDIA COMMONS SOURCING", "(applied)" if args.apply else "(dry run)")
    print("=" * 76)
    print(f"devices needing a real photo : {len(rows)}")
    print(f"confidently matched          : {len(accepted)}")
    print(f"left as placeholder          : {len(rejected)}\n")
    for _id, name, pick in accepted:
        print(f"  ACCEPT  {name[:34]:36} {pick['licence']:<14} {pick['title'][5:60]}")
    print()
    for name, why in rejected[:40]:
        print(f"  skip    {name[:34]:36} {why}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
