#!/usr/bin/env python3
"""Backfill device image_url from local /devices assets + per-slug silhouettes.

Reads the canonical resolver from image_aliases.py (shared with
build_device_image.py and audit_device_images.py) so the scripts never diverge.

Strategy per device (enabled=1):
1. Keep good remote TechAPI CDN images (http://...jsdelivr...). These are
   real product photos pulled by the importer — leave them alone.
2. If a real file on disk exists for the device's own id stem -> use it.
   (Same model with multiple storage variants sharing one image is fine.)
3. Otherwise ask the shared resolver, which derives candidate stems from the
   device's own model name and then consults the curated same-model alias
   table. It never returns another model's photo.
4. If still no match: generate a per-slug branded silhouette PNG so this
   device has a unique image — never a shared photo with another model.

Matching is on the display name only. Device ids are slugified names, and the
slug flattens TechAPI's '(Apple iPhone 13,2)' into '...-apple-iphone-132',
which used to make every iPhone 12 SKU match the iphone-13 family.

Re-run after any catalog import, then run audit_device_images.py to confirm
no two models share a photo.
"""
from __future__ import annotations

import argparse
import sqlite3
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from image_aliases import (
    BRAND_FALLBACK_STEM,
    CATEGORY_FALLBACK_STEM,
    SILHOUETTE_BY_CATEGORY,
    SILHOUETTE_PREFIX,
    model_key,
    resolve_stem,
)

DB = Path(__file__).resolve().parent.parent / "data" / "tradein.db"
DEVICES_DIR = Path(__file__).resolve().parent.parent.parent / "trade-in-platform" / "public" / "devices"

# Make the silhouette generator importable. It lives next to this script.
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_device_image import draw_silhouette, detect_brand  # noqa: E402


def local_map() -> dict[str, str]:
    """Map filename stem -> '/devices/{file.name}' for every asset on disk."""
    out: dict[str, str] = {}
    for p in DEVICES_DIR.iterdir():
        if p.suffix.lower() in {".png", ".webp", ".jpg", ".jpeg"}:
            out[p.stem] = f"/devices/{p.name}"
    return out


def ensure_silhouette(device_id: str, name: str, category: str, brand: str, files: dict[str, str]) -> str:
    """Generate a per-slug branded silhouette PNG and return its /devices URL.

    Filenames are prefixed with SILHOUETTE_PREFIX so a future audit can tell
    'real photo' vs 'generated placeholder'. Three devices of the same model
    will share the silhouette only if they share the device_id slug (i.e.
    storage variants) — never two different models.
    """
    cfg = SILHOUETTE_BY_CATEGORY.get(category or "smartphone", SILHOUETTE_BY_CATEGORY["smartphone"])
    slug = f"{SILHOUETTE_PREFIX}-{device_id}"
    out_path = DEVICES_DIR / f"{slug}.png"
    if not out_path.exists():
        display = name or device_id
        detected = detect_brand(display)
        # Category decides the SHAPE; brand decides the COLOUR. Taking both from
        # the category made every phone the same blue and painted Galaxy watches
        # Google-green. Unknown brands fall back to the category palette.
        use_brand_palette = detected != "default"
        img = draw_silhouette(
            display,
            detected if use_brand_palette else (brand or detected),
            shape=cfg.get("shape", "phone"),
            bg=None if use_brand_palette else cfg.get("bg"),
            accent=None if use_brand_palette else cfg.get("accent"),
        )
        img.save(out_path, format="PNG", optimize=True)
    url = f"/devices/{slug}.png"
    files[slug] = url
    return url


def remote_image_is_alive(url: str, timeout: float = 12.0) -> bool:
    """True if a remote product photo actually loads.

    The TechAPI importer stored jsdelivr URLs and this script used to preserve
    them unconditionally as "real product photos". They now 404, so 14 devices
    rendered as broken images in the customer widget. Trusting a URL because it
    looks like a CDN is exactly the sort of unverified claim this project avoids.
    """
    request = urllib.request.Request(url, method="GET", headers={"User-Agent": "tg-image-audit/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return 200 <= response.status < 300 and bool(response.read(1))
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError, ValueError):
        return False


def clear_dead_remote_images(cur: sqlite3.Cursor) -> int:
    """Null out image_url for remote photos that no longer resolve, so the normal
    local/silhouette path can take over for those devices."""
    rows = cur.execute(
        "SELECT id, image_url FROM devices WHERE enabled = 1 AND image_url LIKE 'http%'"
    ).fetchall()
    if not rows:
        return 0

    print(f"Checking {len(rows)} remote image URL(s)…", flush=True)
    with ThreadPoolExecutor(max_workers=8) as pool:
        alive = list(pool.map(lambda row: remote_image_is_alive(row[1]), rows))

    dead = [row[0] for row, ok in zip(rows, alive) if not ok]
    for device_id in dead:
        cur.execute("UPDATE devices SET image_url = NULL WHERE id = ?", (device_id,))
    if dead:
        print(f"  {len(dead)} dead remote image(s) cleared: {', '.join(dead[:6])}"
              + (" …" if len(dead) > 6 else ""))
    return len(dead)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--check-remote",
        action="store_true",
        help="verify remote CDN image URLs over the network and replace dead ones",
    )
    args = ap.parse_args()

    if not DB.exists():
        print(f"DB not found at {DB}", flush=True)
        return 1
    files = local_map()
    if not files:
        print(f"No device image files found under {DEVICES_DIR}", flush=True)
        return 1

    conn = sqlite3.connect(DB)
    cur = conn.cursor()

    dead_remote = clear_dead_remote_images(cur) if args.check_remote else 0

    rows = cur.execute(
        "SELECT id, name, category_id, brand_id, image_url FROM devices WHERE enabled = 1"
    ).fetchall()

    file_stems = set(files.keys())
    updated = 0
    silhouette_count = 0
    silhouette_skipped = 0

    # Enforce the invariant rather than trusting it: the first model to claim a
    # stem owns it, and any other model that resolves to the same stem is sent
    # to a silhouette instead of quietly borrowing the photo.
    stem_owner: dict[str, str] = {}

    def claim(stem: str, key: str) -> bool:
        owner = stem_owner.setdefault(stem, key)
        return owner == key

    for device_id, name, category_id, brand_id, image_url in rows:
        # Keep good remote TechAPI CDN images (real product photos).
        if image_url and str(image_url).startswith("http") and "jsdelivr" in str(image_url):
            continue

        chosen_url: str | None = None
        key = model_key(name or device_id)

        # 1) Exact device-id stem on disk.
        if device_id in file_stems and claim(device_id, key):
            chosen_url = files[device_id]

        # 2) Same-model resolver: stems derived from this device's own model
        #    name, then the curated same-model alias table.
        if chosen_url is None:
            stem = resolve_stem(name or device_id, file_stems)
            if stem and claim(stem, key):
                chosen_url = files[stem]

        # 3) Per-slug silhouette so two different models never share a photo.
        if chosen_url is None:
            try:
                brand_stem = (brand_id or "").split("-", 1)[0]
                chosen_url = ensure_silhouette(device_id, name or device_id,
                                               category_id or "smartphone",
                                               brand_stem, files)
                file_stems.add(f"{SILHOUETTE_PREFIX}-{device_id}")
                silhouette_count += 1
            except Exception as exc:  # Pillow missing or draw failure
                silhouette_skipped += 1
                # Fall back to a single brand/category placeholder stem.
                stem = (BRAND_FALLBACK_STEM.get((brand_id or "").split("-", 1)[0])
                        or CATEGORY_FALLBACK_STEM.get(category_id or "", "iphone-15"))
                if stem in file_stems:
                    chosen_url = files[stem]

        if chosen_url and chosen_url != image_url:
            cur.execute("UPDATE devices SET image_url = ? WHERE id = ?", (chosen_url, device_id))
            updated += 1

    # Disable junk historical devices that shouldn't be in a buyback catalog.
    junk = cur.execute(
        """
        UPDATE devices SET enabled = 0
        WHERE enabled = 1 AND (
          lower(name) LIKE '%newton%'
          OR lower(name) LIKE '%messagepad%'
          OR lower(name) LIKE '%emate%'
          OR lower(id) LIKE '%aitoolbuzz%'
          OR lower(id) LIKE '%allphones%'
          OR lower(id) LIKE '%scrapegsma%'
          OR lower(id) LIKE '%beridzeg%'
          OR lower(id) LIKE '%ammok%'
          OR lower(id) LIKE '%abhinavflac%'
        )
        """
    ).rowcount

    conn.commit()
    enabled = cur.execute(
        "SELECT count(*) FROM devices WHERE enabled = 1"
    ).fetchone()[0]
    with_img = cur.execute(
        "SELECT count(*) FROM devices WHERE enabled = 1 AND image_url IS NOT NULL AND image_url != ''"
    ).fetchone()[0]
    # Drop silhouettes this script generated on an earlier run that nothing
    # points at any more — usually because a real photo for that model has
    # since landed on disk. Only ever removes generated placeholders.
    referenced = {
        url.rsplit("/", 1)[-1]
        for (url,) in cur.execute(
            "SELECT image_url FROM devices WHERE image_url LIKE '/devices/%'"
        ).fetchall()
    }
    pruned = 0
    for path in DEVICES_DIR.iterdir():
        if path.name.startswith(SILHOUETTE_PREFIX) and path.name not in referenced:
            path.unlink()
            pruned += 1

    # Count images shared across *different models*. Grouping by raw name would
    # flag the storage variants of one model, which are allowed to share.
    per_image: dict[str, set[str]] = {}
    for image_url, name in cur.execute(
        "SELECT image_url, name FROM devices WHERE enabled = 1 AND image_url LIKE '/devices/%'"
    ).fetchall():
        per_image.setdefault(image_url, set()).add(model_key(name))
    shared = sum(1 for keys in per_image.values() if len(keys) > 1)
    conn.close()

    print(f"Updated image_url on {updated} devices (+{silhouette_count} silhouettes, {silhouette_skipped} failed).")
    print(f"Disabled {junk} junk rows. Pruned {pruned} unreferenced silhouettes."
          + (f" Cleared {dead_remote} dead remote image(s)." if dead_remote else ""))
    print(f"Enabled catalog: {enabled} devices, {with_img} with images, {shared} images still shared across >1 distinct model.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
