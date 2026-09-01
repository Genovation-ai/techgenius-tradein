#!/usr/bin/env python3
"""Audit catalog device images for cross-model collisions.

The rule this enforces (from the image repair spec):
  Same model, different storage/region  -> SHOULD share one image.
  Two genuinely different models        -> MUST NOT share an image.

It reports, for the enabled catalog:
  * cross-model collisions (one image used by >1 distinct model family)
  * image_url values whose file is missing from public/devices
  * how many devices are on a real photo vs a generated silhouette
  * devices with no image at all

Exit code is 1 when any cross-model collision or missing file is found, so it
can be used as a check in CI or before a release.
"""
from __future__ import annotations

import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

# model_key is the shared definition of "these two rows are the same product".
# The resolver and this audit deliberately use the same definition; what the
# audit actually proves is that the alias table and the fallback paths never
# put two different model_keys onto one image.
from image_aliases import SILHOUETTE_PREFIX, model_key

DB = Path(__file__).resolve().parent.parent / "data" / "tradein.db"
DEVICES_DIR = Path(__file__).resolve().parent.parent.parent / "trade-in-platform" / "public" / "devices"


def main() -> int:
    if not DB.exists():
        print(f"DB not found at {DB}")
        return 1

    on_disk = {p.name for p in DEVICES_DIR.iterdir() if p.is_file()}

    conn = sqlite3.connect(DB)
    rows = conn.execute(
        "SELECT id, name, image_url FROM devices WHERE enabled = 1"
    ).fetchall()
    conn.close()

    by_image: dict[str, list[tuple[str, str]]] = defaultdict(list)
    missing_file: list[tuple[str, str]] = []
    no_image: list[tuple[str, str]] = []
    silhouettes = 0
    remote = 0

    for device_id, name, image_url in rows:
        if not image_url:
            no_image.append((device_id, name))
            continue
        if str(image_url).startswith("http"):
            remote += 1
            continue
        if SILHOUETTE_PREFIX in image_url:
            silhouettes += 1
        by_image[image_url].append((device_id, name))
        fname = image_url.rsplit("/", 1)[-1]
        if fname not in on_disk:
            missing_file.append((device_id, image_url))

    collisions: list[tuple[str, dict[str, list[str]]]] = []
    for image_url, devices in by_image.items():
        groups: dict[str, list[str]] = defaultdict(list)
        for device_id, name in devices:
            groups[model_key(name)].append(name)
        if len(groups) > 1:
            collisions.append((image_url, dict(groups)))

    collisions.sort(key=lambda kv: -len(kv[1]))

    print("=" * 72)
    print("DEVICE IMAGE AUDIT")
    print("=" * 72)
    print(f"Enabled devices:            {len(rows)}")
    print(f"  on local /devices photo:  {sum(len(v) for v in by_image.values()) - silhouettes}")
    print(f"  on generated silhouette:  {silhouettes}")
    print(f"  on remote CDN photo:      {remote}")
    print(f"  with no image at all:     {len(no_image)}")
    print()
    print(f"Distinct local images used: {len(by_image)}")
    print(f"CROSS-MODEL COLLISIONS:     {len(collisions)}")
    print(f"MISSING IMAGE FILES:        {len(missing_file)}")
    print()

    if collisions:
        print("-" * 72)
        print("Cross-model collisions (one image, several different models)")
        print("-" * 72)
        for image_url, groups in collisions:
            total = sum(len(v) for v in groups.values())
            print(f"\n{image_url}  — {len(groups)} models / {total} rows")
            for key, names in sorted(groups.items()):
                print(f"    [{key}] x{len(names)}   e.g. {names[0]}")

    if missing_file:
        print()
        print("-" * 72)
        print("image_url pointing at a file that does not exist on disk")
        print("-" * 72)
        for device_id, image_url in missing_file[:40]:
            print(f"  {device_id} -> {image_url}")
        if len(missing_file) > 40:
            print(f"  … and {len(missing_file) - 40} more")

    if no_image:
        print()
        print(f"Devices with no image: {len(no_image)} (e.g. {no_image[0][0]})")

    ok = not collisions and not missing_file and not no_image
    print()
    print("RESULT:", "PASS — every model has its own image" if ok else "FAIL — see above")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
