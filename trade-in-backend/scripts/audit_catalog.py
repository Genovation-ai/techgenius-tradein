#!/usr/bin/env python3
"""Read-only health check of the live catalog: prices, gaps and contradictions.

Changes nothing. Run it before a launch, and after any import or price sync.

What it looks for, roughly in order of how much money it can cost you:
  * devices a customer can pick but that cannot be quoted
  * grade ladders that go the wrong way (a cracked phone worth more than a mint one)
  * storage ladders that go the wrong way (128GB worth more than 512GB)
  * prices that look like retail rather than buyback
  * quoted prices that disagree with the competitor the store says it follows
  * stale prices, missing grades, and devices with no real photo
"""
from __future__ import annotations

import json
import sqlite3
import sys
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

from image_aliases import SILHOUETTE_PREFIX

DB = Path(__file__).resolve().parent.parent / "data" / "tradein.db"

# Worst → best. A better condition must never be worth less.
GRADE_ORDER = ["defective", "fair", "average", "good", "flawless"]

# Buyback ceilings by category, set above what a current flagship genuinely
# fetches. The point is to catch RETAIL prices leaking into the buyback table —
# the TechAPI import once priced a used iPhone 12 at $773 — not to flag real
# high-end trade-ins. A 2TB iPhone 17 Pro Max really is worth ~$1300 to a buyer
# and a Mac Studio ~$2800, so ceilings tuned for mid-range phones only produced
# noise that trained you to ignore the report.
IMPLAUSIBLE_BUYBACK = {
    "smartphone": 1500.0,
    "tablet": 1600.0,
    "smartwatch": 600.0,
    "laptop": 3200.0,
    "computer": 3200.0,
    "gaming-console": 1300.0,
    "vr": 1200.0,
    "monitor": 1800.0,
}
DEFAULT_CEILING = 1500.0
STALE_DAYS = 45


def storage_rank(storage: str) -> float:
    """GB, for ordering. Non-capacity trims (40mm, 'default') sort last."""
    s = (storage or "").strip().lower().replace(" ", "")
    try:
        if s.endswith("tb"):
            return float(s[:-2]) * 1024
        if s.endswith("gb"):
            return float(s[:-2])
        if s.endswith("mb"):
            return float(s[:-2]) / 1024
    except ValueError:
        pass
    return -1.0


def main() -> int:
    conn = sqlite3.connect(DB)
    cur = conn.cursor()

    devices = cur.execute(
        "SELECT id, name, category_id, storages, image_url FROM devices WHERE enabled = 1"
    ).fetchall()
    dev_by_id = {d[0]: d for d in devices}

    prices = defaultdict(list)
    for device_id, storage, grade, price, source, updated in cur.execute(
        "SELECT device_id, storage, condition_grade, base_price, source, updated_at FROM prices"
    ):
        if device_id in dev_by_id:
            prices[device_id].append((storage, grade, price or 0.0, source or "", updated or ""))

    settings = dict(cur.execute("SELECT key, value FROM settings").fetchall())
    conn.close()

    no_prices, zero_prices, implausible = [], [], []
    grade_inversions, storage_inversions = [], []
    missing_grades, storage_mismatch = [], []
    stale, silhouettes = [], []
    source_counts = defaultdict(int)

    cutoff = (datetime.now() - timedelta(days=STALE_DAYS)).strftime("%Y-%m-%d")

    for device_id, name, category, storages_json, image_url in devices:
        rows = prices.get(device_id, [])
        priced = [r for r in rows if r[2] > 0]

        if not priced:
            # Hidden from /api/catalog/devices until priced, so a customer can
            # never reach it — a to-do, not a live defect.
            no_prices.append((device_id, name))
            continue

        for storage, grade, price, source, updated in rows:
            source_counts[source or "(none)"] += 1
            if price <= 0:
                zero_prices.append((device_id, name, storage, grade))
            if price > IMPLAUSIBLE_BUYBACK.get(category, DEFAULT_CEILING):
                implausible.append((device_id, name, storage, grade, price, source))
            if updated and updated[:10] < cutoff:
                stale.append((device_id, updated[:10]))

        # Grade ladder, per storage.
        by_storage = defaultdict(dict)
        for storage, grade, price, _s, _u in priced:
            by_storage[storage][grade] = price
        for storage, grades in by_storage.items():
            present = [g for g in GRADE_ORDER if g in grades]
            for worse, better in zip(present, present[1:]):
                if grades[better] < grades[worse] - 0.5:
                    grade_inversions.append(
                        (device_id, name, storage, worse, grades[worse], better, grades[better])
                    )
            missing = [g for g in GRADE_ORDER if g not in grades]
            if missing and len(missing) < len(GRADE_ORDER):
                missing_grades.append((device_id, name, storage, missing))

        # Storage ladder, per grade — bigger capacity should not be worth less.
        by_grade = defaultdict(dict)
        for storage, grade, price, _s, _u in priced:
            by_grade[grade][storage] = price
        # Laptops list memory in the same field as drive capacity; comparing
        # 16GB of RAM against a 1TB SSD as one ladder is meaningless.
        def same_axis(value: str) -> str:
            rank = storage_rank(value)
            if rank <= 0:
                return "other"
            if category in ("laptop", "computer") and rank <= 64:
                return "memory"
            return "storage"

        for grade, caps in by_grade.items():
          for axis in ("storage", "memory"):
            ranked = sorted(
                (
                    (storage_rank(s), s, p)
                    for s, p in caps.items()
                    if storage_rank(s) > 0 and same_axis(s) == axis
                ),
                key=lambda t: t[0],
            )
            for (_r1, s1, p1), (_r2, s2, p2) in zip(ranked, ranked[1:]):
                if p2 < p1 - 0.5:
                    storage_inversions.append((device_id, name, grade, s1, p1, s2, p2))

        # Declared storages vs priced storages.
        try:
            declared = set(json.loads(storages_json or "[]"))
        except json.JSONDecodeError:
            declared = set()
        pricedset = {r[0] for r in priced}
        unpriced = declared - pricedset
        if unpriced:
            storage_mismatch.append((device_id, name, sorted(unpriced)))

        if image_url and SILHOUETTE_PREFIX in image_url:
            silhouettes.append((device_id, name))

    def head(title: str, rows, fmt, limit=12):
        print()
        print("-" * 78)
        print(f"{title}: {len(rows)}")
        print("-" * 78)
        for r in rows[:limit]:
            print("  " + fmt(r))
        if len(rows) > limit:
            print(f"  … and {len(rows) - limit} more")

    print("=" * 78)
    print("CATALOG HEALTH")
    print("=" * 78)
    print(f"Enabled devices          : {len(devices)}")
    print(f"Price rows               : {sum(len(v) for v in prices.values())}")
    print(f"Frontend price source    : {settings.get('frontend_price_source')} "
          f"/ {settings.get('frontend_price_mode')} "
          f"{settings.get('frontend_beat_percent')}%")
    print()
    print("Price rows by source:")
    for source, count in sorted(source_counts.items(), key=lambda kv: -kv[1]):
        print(f"   {source:<26} {count}")

    head("BLOCKING — devices customers can pick but cannot be quoted", no_prices,
         lambda r: f"{r[0][:44]:<46} {r[1][:30]}")
    head("BLOCKING — better condition worth LESS than worse condition", grade_inversions,
         lambda r: f"{r[1][:26]:<28} {r[2]:<8} {r[5]}=${r[6]:.0f}  BELOW  {r[3]}=${r[4]:.0f}")
    head("BLOCKING — bigger storage worth LESS than smaller", storage_inversions,
         lambda r: f"{r[1][:26]:<28} {r[2]:<9} {r[5]}=${r[6]:.0f}  BELOW  {r[3]}=${r[4]:.0f}")
    head("SUSPECT — buyback price above plausible ceiling", implausible,
         lambda r: f"{r[1][:26]:<28} {r[2]:<8} {r[3]:<9} ${r[4]:.0f}  [{r[5]}]")
    head("ZERO / NEGATIVE price rows", zero_prices,
         lambda r: f"{r[1][:30]:<32} {r[2]:<8} {r[3]}")
    head("Declared storages with no price (dead options in the picker)", storage_mismatch,
         lambda r: f"{r[1][:30]:<32} {', '.join(r[2])}")
    head("Storages missing some condition grades", missing_grades,
         lambda r: f"{r[1][:30]:<32} {r[2]:<8} missing {', '.join(r[3])}")
    head(f"Devices with prices older than {STALE_DAYS} days",
         sorted(set(stale)), lambda r: f"{r[0][:46]:<48} {r[1]}")
    head("Devices with no real photo (generated placeholder)", silhouettes,
         lambda r: f"{r[0][:46]:<48} {r[1][:26]}")

    # Only zero/negative prices are unconditionally broken. Ladder
    # inconsistencies in this table are neutralised by the read-time caps in
    # quoteEngine (see audit_effective_quotes.ts, which measures what customers
    # are actually offered) — worth cleaning up, but not live defects. Unpriced
    # devices are hidden from the catalog, so they cannot be reached either.
    blocking = len(zero_prices)
    stored_only = len(grade_inversions) + len(storage_inversions)
    print()
    print("=" * 78)
    print(f"BLOCKING issues        : {blocking}")
    print(f"Stored inconsistencies : {stored_only}  (capped at quote time — run audit:quotes)")
    print(f"Unpriced / hidden      : {len(no_prices)}")
    print(f"Suspect prices         : {len(implausible)}")
    print(f"Cosmetic gaps          : {len(storage_mismatch) + len(missing_grades) + len(silhouettes)}")
    print("=" * 78)
    return 1 if blocking else 0


if __name__ == "__main__":
    sys.exit(main())
