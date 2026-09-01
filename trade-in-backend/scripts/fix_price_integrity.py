#!/usr/bin/env python3
"""Repair internal contradictions in the price table.

Three defects, all of which quote a customer the wrong money:

1. STORAGE LABEL SPLIT — the same capacity stored under two names. Galaxy S10+
   carried both '1TB' ($165) and '1024GB' ($462). deviceMatch.ts aliases the two
   for lookup, but the table still held both rows, so which one a quote hit was
   luck. Merged onto '1TB', keeping the better-sourced row.

2. BAD DEDUPE GAP-FILLS — the catalog de-dupe filled gaps on surviving rows and
   guarded against implausible prices, but never checked the storage ladder, so
   it could fill a 512GB slot below the 256GB price already there. Those fills
   are tagged `source = 'dedupe-merge'` and any that break a ladder are removed.

3. GRADE INVERSIONS — derived `*:scaled` grades were computed from the
   competitor's "excellent" price without being tied to the real scraped prices
   for the other grades, so a worse condition could pay more than a better one
   (Watch Ultra 2: $43 defective against $15 fair). Clamped so price never rises
   as condition worsens.

Clamping always moves the WORSE grade DOWN, never the better grade up: these are
payouts, so when two sources disagree the cheaper reading is the safe one.

--dry-run is the default. Use --apply to write.
"""
from __future__ import annotations

import argparse
import shutil
import sqlite3
import sys
import time
from collections import defaultdict
from pathlib import Path

DB = Path(__file__).resolve().parent.parent / "data" / "tradein.db"

GRADE_LADDER = ["defective", "fair", "average", "good", "flawless"]  # worst -> best

# Higher wins when two rows describe the same capacity.
SOURCE_CONFIDENCE = {
    "gorecell": 100,
    "gorecell-catalog": 95,
    "gorecell:scaled": 80,
    "data-driven-baseline": 70,
    "dedupe-merge": 40,
    "catalog-seed": 30,
    "bootstrap": 20,
    "techapi-import": 10,
}

STORAGE_ALIASES = {"1024GB": "1TB", "2048GB": "2TB", "512gb": "512GB"}


def storage_gb(storage: str) -> float:
    s = (storage or "").strip().lower().replace(" ", "")
    try:
        if s.endswith("tb"):
            return float(s[:-2]) * 1024
        if s.endswith("gb"):
            return float(s[:-2])
    except ValueError:
        pass
    return -1.0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write changes (default is a dry run)")
    args = ap.parse_args()

    if args.apply:
        backup = DB.with_name(f"{DB.name}.bak-pre-price-fix-{int(time.time())}")
        shutil.copy2(DB, backup)
        print(f"Backup: {backup.name}\n")

    conn = sqlite3.connect(DB)
    cur = conn.cursor()
    enabled = {i for (i,) in cur.execute("SELECT id FROM devices WHERE enabled = 1")}

    alias_merges: list[tuple[str, str, str, float, float]] = []
    dropped_fills: list[tuple[str, str, str, float, str]] = []
    clamps: list[tuple[str, str, str, float, float]] = []

    # ---- 1. Merge split storage labels -------------------------------------
    for old_label, new_label in STORAGE_ALIASES.items():
        rows = cur.execute(
            "SELECT device_id, condition_grade, base_price, source FROM prices WHERE storage = ?",
            (old_label,),
        ).fetchall()
        for device_id, grade, price, source in rows:
            if device_id not in enabled:
                continue
            existing = cur.execute(
                "SELECT base_price, source FROM prices WHERE device_id = ? AND storage = ? AND condition_grade = ?",
                (device_id, new_label, grade),
            ).fetchone()
            if existing is None:
                alias_merges.append((device_id, grade, f"rename -> {new_label}", price, price))
                if args.apply:
                    cur.execute(
                        "UPDATE prices SET storage = ? WHERE device_id = ? AND storage = ? AND condition_grade = ?",
                        (new_label, device_id, old_label, grade),
                    )
                continue

            keep_new = SOURCE_CONFIDENCE.get(existing[1] or "", 0) >= SOURCE_CONFIDENCE.get(source or "", 0)
            winner = existing[0] if keep_new else price
            alias_merges.append((device_id, grade, f"merge {old_label}->{new_label}", existing[0], winner))
            if args.apply:
                if not keep_new:
                    cur.execute(
                        "UPDATE prices SET base_price = ?, source = ?, updated_at = datetime('now')"
                        " WHERE device_id = ? AND storage = ? AND condition_grade = ?",
                        (price, source, device_id, new_label, grade),
                    )
                cur.execute(
                    "DELETE FROM prices WHERE device_id = ? AND storage = ? AND condition_grade = ?",
                    (device_id, old_label, grade),
                )

    # ---- 2. Drop dedupe gap-fills that break the storage ladder ------------
    by_device_grade: dict[tuple[str, str], dict[str, tuple[float, str]]] = defaultdict(dict)
    for device_id, storage, grade, price, source in cur.execute(
        "SELECT device_id, storage, condition_grade, base_price, source FROM prices WHERE base_price > 0"
    ):
        if device_id in enabled:
            by_device_grade[(device_id, grade)][storage] = (price, source or "")

    for (device_id, grade), caps in by_device_grade.items():
        ranked = sorted(
            ((storage_gb(s), s, p, src) for s, (p, src) in caps.items() if storage_gb(s) > 0),
            key=lambda t: t[0],
        )
        # Only gap-fills get corrected. Real scraped prices that disagree across
        # capacities are upstream data, not something to paper over here.
        for index, (_gb, storage, price, source) in enumerate(ranked):
            if source != "dedupe-merge":
                continue
            # A fill must sit inside the envelope its real-priced neighbours
            # define: at least the largest smaller capacity, at most the
            # smallest larger one.
            floor = max((p for _g, _s, p, src in ranked[:index] if src != "dedupe-merge"), default=None)
            ceiling = min((p for _g, _s, p, src in ranked[index + 1:] if src != "dedupe-merge"), default=None)

            target = price
            if floor is not None and target < floor:
                target = floor
            if ceiling is not None and target > ceiling:
                target = ceiling

            if floor is not None and ceiling is not None and floor > ceiling:
                # Real neighbours contradict each other; this fill cannot be
                # placed honestly between them. Drop it rather than invent.
                dropped_fills.append((device_id, storage, grade, price, "removed (neighbours conflict)"))
                if args.apply:
                    cur.execute(
                        "DELETE FROM prices WHERE device_id = ? AND storage = ? AND condition_grade = ?"
                        " AND source = 'dedupe-merge'",
                        (device_id, storage, grade),
                    )
            elif abs(target - price) > 0.5:
                dropped_fills.append((device_id, storage, grade, price, f"clamped -> ${target:.0f}"))
                if args.apply:
                    cur.execute(
                        "UPDATE prices SET base_price = ?, updated_at = datetime('now')"
                        " WHERE device_id = ? AND storage = ? AND condition_grade = ? AND source = 'dedupe-merge'",
                        (round(target), device_id, storage, grade),
                    )

    # ---- 3. Clamp the grade ladder ----------------------------------------
    by_device_storage: dict[tuple[str, str], dict[str, float]] = defaultdict(dict)
    for device_id, storage, grade, price in cur.execute(
        "SELECT device_id, storage, condition_grade, base_price FROM prices WHERE base_price > 0"
    ):
        if device_id in enabled:
            by_device_storage[(device_id, storage)][grade] = price

    for (device_id, storage), grades in by_device_storage.items():
        ceiling = float("inf")
        for grade in reversed(GRADE_LADDER):  # best -> worst
            price = grades.get(grade)
            if price is None:
                continue
            if price > ceiling:
                clamps.append((device_id, storage, grade, price, ceiling))
                if args.apply:
                    cur.execute(
                        "UPDATE prices SET base_price = ?, updated_at = datetime('now')"
                        " WHERE device_id = ? AND storage = ? AND condition_grade = ?",
                        (round(ceiling), device_id, storage, grade),
                    )
            else:
                ceiling = price

    if args.apply:
        conn.commit()
    conn.close()

    def section(title, rows, fmt, limit=10):
        print("-" * 78)
        print(f"{title}: {len(rows)}")
        print("-" * 78)
        for r in rows[:limit]:
            print("  " + fmt(r))
        if len(rows) > limit:
            print(f"  … and {len(rows) - limit} more")
        print()

    print("=" * 78)
    print("PRICE INTEGRITY REPAIR", "(dry run)" if not args.apply else "(applied)")
    print("=" * 78)
    section("1. Split storage labels merged", alias_merges,
            lambda r: f"{r[0][:34]:<36} {r[2]:<24} {r[1]:<10} -> ${r[4]:.0f}")
    section("2. Dedupe gap-fills corrected to the real-price envelope", dropped_fills,
            lambda r: f"{r[0][:30]:<32} {r[1]:<9} {r[2]:<10} ${r[3]:.0f} {r[4]}")
    section("3. Grade inversions clamped", clamps,
            lambda r: f"{r[0][:30]:<32} {r[1]:<9} {r[2]:<10} ${r[3]:.0f} -> ${r[4]:.0f}")

    if not args.apply:
        print("Dry run — nothing written. Re-run with --apply to commit.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
