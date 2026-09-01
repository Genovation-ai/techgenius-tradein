#!/usr/bin/env python3
"""
Import the full GoRecell buyback catalog into Tech Genius.

- Parses step-flow embedded products JSON (all categories)
- Upserts categories, brands, devices
- Downloads real product images into trade-in-platform/public/devices/
- Seeds missing price rows with conservative placeholders (source=gorecell-catalog)

Usage:
  python3 scripts/import_gorecell_catalog.py
  python3 scripts/import_gorecell_catalog.py --html /tmp/gorecell-all.html --skip-download
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "tradein.db"
IMG_DIR = ROOT.parent / "trade-in-platform" / "public" / "devices"
STEP_URL = "https://gorecell.ca/step-flow/"

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

# GoRecell category slug → our category id + display name
CATEGORY_MAP: Dict[str, Tuple[str, str, int]] = {
    "smartphone": ("smartphone", "Smartphone", 1),
    "tablet": ("tablet", "Tablet", 2),
    "smartwatch": ("smartwatch", "Smartwatch", 3),
    "macbook": ("laptop", "Laptop", 4),
    "laptops": ("laptop", "Laptop", 4),
    "microsoft-surface": ("laptop", "Laptop", 4),
    "imac": ("computer", "Desktop / iMac", 5),
    "mac-computers": ("computer", "Desktop / iMac", 5),
    "gaming-console": ("gaming-console", "Gaming Console", 6),
    "vr": ("vr", "VR / Wearables", 7),
    "monitors": ("monitor", "Monitor", 8),
}

# Placeholder flawless prices when no market scrape exists yet (CAD)
PLACEHOLDER_BY_CATEGORY: Dict[str, int] = {
    "smartphone": 200,
    "tablet": 180,
    "smartwatch": 90,
    "laptop": 350,
    "computer": 280,
    "gaming-console": 250,
    "vr": 200,
    "monitor": 120,
}

CONDITION_MULT = {
    "flawless": 1.0,
    "good": 0.9,
    "average": 0.78,
    "fair": 0.62,
    "defective": 0.4,
}

DEFAULT_STORAGES = {
    "smartphone": ["64GB", "128GB", "256GB", "512GB"],
    "tablet": ["64GB", "128GB", "256GB", "512GB"],
    "smartwatch": ["default"],
    "laptop": ["256GB", "512GB", "1TB"],
    "computer": ["256GB", "512GB", "1TB"],
    "gaming-console": ["default"],
    "vr": ["default"],
    "monitor": ["default"],
}


def slugify(text: str) -> str:
    s = text.lower().strip()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s[:80] or "device"


def fetch_html(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read().decode("utf-8", "replace")


def parse_products(html: str) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]]]:
    products = json.loads(re.search(r"var products = (\[.*?\]);", html, re.DOTALL).group(1))
    categories = json.loads(re.search(r"var categories = (\[.*?\]);", html, re.DOTALL).group(1))
    brands = json.loads(re.search(r"var brands = (\[.*?\]);", html, re.DOTALL).group(1))
    return products, categories, brands


def map_category(product: Dict[str, Any]) -> Optional[Tuple[str, str, int]]:
    cats = product.get("_categories") or []
    for c in cats:
        slug = (c.get("slug") or "").lower()
        if slug in CATEGORY_MAP:
            return CATEGORY_MAP[slug]
    names = product.get("_categories_name") or []
    for n in names:
        for slug, mapped in CATEGORY_MAP.items():
            if mapped[1].lower() == str(n).lower() or slug.replace("-", " ") in str(n).lower():
                return mapped
    return None


def brand_slug(product: Dict[str, Any]) -> str:
    names = product.get("_barands_name") or []
    if names:
        return slugify(names[0])
    brands = product.get("_barands") or []
    if brands and brands[0].get("slug"):
        return slugify(brands[0]["slug"])
    if brands and brands[0].get("name"):
        return slugify(brands[0]["name"])
    # infer from name
    name = (product.get("_name") or "").lower()
    for token in (
        "iphone",
        "ipad",
        "macbook",
        "imac",
        "apple",
        "galaxy",
        "samsung",
        "pixel",
        "google",
        "playstation",
        "xbox",
        "switch",
        "nintendo",
        "quest",
        "meta",
        "steam",
        "asus",
        "lenovo",
        "dell",
        "msi",
        "razer",
        "sony",
        "microsoft",
        "surface",
        "valve",
    ):
        if token in name:
            marketing = {
                "iphone": "apple",
                "ipad": "apple",
                "macbook": "apple",
                "imac": "apple",
                "galaxy": "samsung",
                "pixel": "google",
                "playstation": "sony",
                "xbox": "microsoft",
                "switch": "nintendo",
                "quest": "meta",
                "steam": "valve",
                "surface": "microsoft",
            }
            return marketing.get(token, token)
    return "other"


def brand_display(product: Dict[str, Any], bslug: str) -> str:
    names = product.get("_barands_name") or []
    if names:
        return str(names[0])
    return bslug.replace("-", " ").title()


def device_id(product: Dict[str, Any], cat_id: str) -> str:
    url = product.get("_url") or ""
    m = re.search(r"/product/([^/]+)/?", url)
    if m:
        base = slugify(m.group(1))
    else:
        base = slugify(product.get("_name") or f"device-{product.get('_id')}")
    # Keep ids unique across categories when names collide
    if cat_id not in ("smartphone", "tablet", "smartwatch", "laptop") and not base.startswith(cat_id):
        # gaming/vr/etc — prefix lightly if needed
        pass
    return base


def guess_storages(product: Dict[str, Any], cat_id: str) -> List[str]:
    name = product.get("_name") or ""
    found = re.findall(r"(\d+\s?(?:GB|TB))", name, re.I)
    cleaned = []
    if found:
        for f in found:
            f = f.upper().replace(" ", "")
            # Drop RAM-like sizes on phones/tablets (8GB RAM in product titles)
            m = re.match(r"^(\d+)GB$", f)
            if m and int(m.group(1)) <= 16 and cat_id in ("smartphone", "tablet"):
                continue
            if f not in cleaned:
                cleaned.append(f)
        if cleaned:
            # Normalize 1024GB → keep as-is; sync will canonicalize to 1TB
            return cleaned
    # watch sizes
    if cat_id == "smartwatch":
        sizes = re.findall(r"(\d{2})\s?mm", name, re.I)
        if sizes:
            return [f"{s}mm" for s in sizes]
    return list(DEFAULT_STORAGES.get(cat_id, ["default"]))


def download_image(url: str, dest: Path) -> bool:
    if dest.exists() and dest.stat().st_size > 500:
        return True
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=45) as resp:
            data = resp.read()
        if len(data) < 200:
            return False
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        return True
    except Exception as e:
        print(f"  [WARN] image download failed {url}: {e}", file=sys.stderr)
        return False


def ext_from_url(url: str) -> str:
    path = url.split("?")[0]
    if "." in path.rsplit("/", 1)[-1]:
        ext = path.rsplit(".", 1)[-1].lower()
        if ext in ("png", "jpg", "jpeg", "webp", "gif"):
            return "jpg" if ext == "jpeg" else ext
    return "png"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--html", help="Use local HTML instead of fetching")
    ap.add_argument("--skip-download", action="store_true")
    ap.add_argument("--db", default=str(DB_PATH))
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    if args.html:
        html = Path(args.html).read_text("utf-8")
    else:
        print(f"Fetching {STEP_URL} ...")
        html = fetch_html(STEP_URL)

    products, gr_cats, gr_brands = parse_products(html)
    print(f"Parsed {len(products)} products, {len(gr_cats)} categories, {len(gr_brands)} brands")

    if args.limit:
        products = products[: args.limit]

    conn = sqlite3.connect(args.db)
    conn.execute("PRAGMA foreign_keys = ON")
    cur = conn.cursor()

    # Ensure categories
    for slug, (cid, cname, order) in CATEGORY_MAP.items():
        cur.execute(
            "INSERT INTO categories (id, name, sort_order, enabled) VALUES (?, ?, ?, 1) "
            "ON CONFLICT(id) DO UPDATE SET name = excluded.name, enabled = 1",
            (cid, cname, order),
        )

    seen_brands: set[str] = set()
    imported = 0
    images_ok = 0
    skipped = 0

    for p in products:
        mapped = map_category(p)
        if not mapped:
            skipped += 1
            continue
        cat_id, cat_name, _ = mapped
        bslug = brand_slug(p)
        brand_id = f"{bslug}-{cat_id}"
        bname = brand_display(p, bslug)
        if brand_id not in seen_brands:
            cur.execute(
                "INSERT INTO brands (id, name, category_id, enabled) VALUES (?, ?, ?, 1) "
                "ON CONFLICT(id) DO UPDATE SET name = excluded.name, enabled = 1",
                (brand_id, bname, cat_id),
            )
            seen_brands.add(brand_id)

        did = device_id(p, cat_id)
        name = (p.get("_name") or did).strip()
        storages = guess_storages(p, cat_id)
        img_src = p.get("_image_src") or ""
        image_url = None

        if img_src and not args.skip_download:
            ext = ext_from_url(img_src)
            dest = IMG_DIR / f"{did}.{ext}"
            if download_image(img_src, dest):
                image_url = f"/devices/{did}.{ext}"
                images_ok += 1
            time.sleep(0.05)
        elif img_src:
            # still record remote path preference as local expectation
            ext = ext_from_url(img_src)
            local = IMG_DIR / f"{did}.{ext}"
            if local.exists():
                image_url = f"/devices/{did}.{ext}"
                images_ok += 1

        # Prefer keeping existing image_url if we didn't download
        cur.execute(
            "INSERT INTO devices (id, category_id, brand_id, name, storages, image_url, enabled) "
            "VALUES (?, ?, ?, ?, ?, ?, 1) "
            "ON CONFLICT(id) DO UPDATE SET "
            "category_id = excluded.category_id, "
            "brand_id = excluded.brand_id, "
            "name = excluded.name, "
            "storages = excluded.storages, "
            "image_url = COALESCE(excluded.image_url, devices.image_url), "
            "enabled = 1",
            (did, cat_id, brand_id, name, json.dumps(storages), image_url),
        )

        # Seed prices only where missing
        base = PLACEHOLDER_BY_CATEGORY.get(cat_id, 150)
        # Slight bump for Pro / Ultra / Max / OLED names
        lname = name.lower()
        if any(t in lname for t in ("pro max", "ultra", "oled", "pro")):
            base = int(base * 1.35)
        elif any(t in lname for t in ("plus", "air")):
            base = int(base * 1.15)

        for storage in storages:
            for grade, mult in CONDITION_MULT.items():
                price = max(5, round(base * mult))
                cur.execute(
                    "INSERT INTO prices (device_id, storage, condition_grade, base_price, source, updated_at) "
                    "VALUES (?, ?, ?, ?, 'gorecell-catalog', datetime('now')) "
                    "ON CONFLICT(device_id, storage, condition_grade) DO NOTHING",
                    (did, storage, grade, price),
                )

        # Store GoRecell product id for step-flow scrapes
        cur.execute(
            "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
            (f"gorecell_product_map:{did}", str(p.get("_id"))),
        )

        imported += 1
        if imported % 50 == 0:
            print(f"  … {imported} devices")
            conn.commit()

    conn.commit()

    # Summary
    total_devices = cur.execute("SELECT COUNT(*) FROM devices WHERE enabled = 1").fetchone()[0]
    with_img = cur.execute(
        "SELECT COUNT(*) FROM devices WHERE enabled = 1 AND image_url IS NOT NULL AND image_url != ''"
    ).fetchone()[0]
    by_cat = cur.execute(
        "SELECT category_id, COUNT(*) FROM devices WHERE enabled = 1 GROUP BY category_id ORDER BY 2 DESC"
    ).fetchall()
    conn.close()

    print(
        json.dumps(
            {
                "imported_or_updated": imported,
                "skipped_unmapped": skipped,
                "images_downloaded_or_present": images_ok,
                "db_enabled_devices": total_devices,
                "db_with_images": with_img,
                "by_category": {k: v for k, v in by_cat},
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
