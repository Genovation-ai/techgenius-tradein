#!/usr/bin/env python3
"""Collapse duplicate catalog rows so one model = one pickable device.

Why this matters beyond tidiness
--------------------------------
The TechAPI import layered regional SKUs on top of the seeded marketing names,
so one handset can appear a dozen times ("iPhone 12", "Apple iPhone 12",
"Apple iPhone 12 5G A2402 Dual SIM TD-LTE JP CA 128GB (Apple iPhone 13,2)"…).
Those rows carry *independent* price tables, so two tiles for the same phone can
quote different money — the catalog holds two "Galaxy S21 5G" rows at $347 and
$120. Which tile the shopper taps decides their offer. De-duping is a pricing
correctness fix, not just a UX one.

What it does
------------
1. Groups enabled devices by (category, model_key) — the shared definition of
   "same product" from image_aliases.py.
2. Picks one canonical row per group (see rank_canonical).
3. Fills *gaps* in the canonical's price table from the duplicates. It never
   overwrites a price the canonical already has, so no offer silently moves.
4. Disables the duplicates (enabled = 0) rather than deleting them, which is how
   this codebase already retires junk rows. Offer history keeps resolving, the
   scrapers' device-id mappings survive, and a bad call is one UPDATE to undo.
5. Reports price conflicts it did NOT resolve, so staff can review the money.

Safety
------
--dry-run (default) changes nothing and prints the plan.
--apply   performs the change inside a single transaction.

Run:
    python3 dedupe_catalog.py            # preview
    python3 dedupe_catalog.py --apply
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

from image_aliases import SILHOUETTE_PREFIX, model_key

DB = Path(__file__).resolve().parent.parent / "data" / "tradein.db"

# Names shaped like an import dump rather than something a shopper would say.
SKU_NOISE = ("td-lte", "dual sim", " a2", "(apple ", "(google ", "(htc ", "(samsung ")

# Price sources that are NOT trustworthy for buyback money. The TechAPI import
# seeded retail-like numbers — it prices a flawless 128GB iPhone 12 at $773 where
# gorecell and the trained baseline say $205-$250. Those rows are exactly what
# this script disables, so their prices must never be promoted onto a canonical
# row while filling gaps.
UNTRUSTED_PRICE_SOURCES = {"techapi-import"}

# Even from a trusted source, refuse a gap-fill wildly above what the canonical
# already charges for that grade — a signal the two rows are not really the same
# trim, or that the source is polluted.
FILL_SANITY_MULTIPLE = 2.0


def name_noise_score(name: str) -> int:
    """Lower is cleaner. Marketing names beat regional SKU dumps."""
    low = (name or "").lower()
    score = sum(12 for marker in SKU_NOISE if marker in low)
    return score + len(low)


def rank_canonical(row: dict) -> tuple:
    """Sort key — the smallest tuple wins the group.

    Order matters:
      1. Rows already used by an offer, so live history keeps a visible device.
      2. Rows the pricing engine knows (price_baselines.product_id), because
         catalogPriceSync only refreshes `enabled = 1` rows — canonicalising a
         row the scraper does not target would freeze its prices.
      3. Cleanest name — what the shopper reads on the tile.
      4. Most price rows, then most recently priced.
      5. A real photo over a generated silhouette.
      6. Id, so the result is deterministic.
    """
    return (
        0 if row["offer_refs"] else 1,
        0 if row["engine_known"] else 1,
        name_noise_score(row["name"]),
        -row["price_count"],
        row["price_staleness"],
        1 if row["silhouette"] else 0,
        row["id"],
    )


def load_rows(cur: sqlite3.Cursor) -> list[dict]:
    engine_ids = {
        r[0] for r in cur.execute("SELECT DISTINCT product_id FROM price_baselines").fetchall() if r[0]
    }
    offer_ids = {
        r[0] for r in cur.execute("SELECT DISTINCT device_id FROM offer_items").fetchall() if r[0]
    }

    rows: list[dict] = []
    for device_id, name, category_id, brand_id, image_url in cur.execute(
        "SELECT id, name, category_id, brand_id, image_url FROM devices WHERE enabled = 1"
    ).fetchall():
        count, latest = cur.execute(
            "SELECT COUNT(*), MAX(updated_at) FROM prices WHERE device_id = ? AND base_price > 0",
            (device_id,),
        ).fetchone()
        rows.append(
            {
                "id": device_id,
                "name": name,
                "category_id": category_id,
                "brand_id": brand_id,
                "image_url": image_url or "",
                "price_count": count or 0,
                # Sorts ascending, so "no prices at all" ranks worst.
                "price_staleness": ("" if latest is None else latest) and f"-{latest}" or "~",
                "silhouette": SILHOUETTE_PREFIX in (image_url or ""),
                "engine_known": device_id in engine_ids,
                "offer_refs": device_id in offer_ids,
            }
        )
    return rows


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write changes (default is a dry run)")
    ap.add_argument("--verbose", action="store_true", help="list every group, not just the biggest")
    args = ap.parse_args()

    if not DB.exists():
        print(f"DB not found at {DB}")
        return 1

    conn = sqlite3.connect(DB)
    cur = conn.cursor()

    groups: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for row in load_rows(cur):
        groups[(row["category_id"] or "", model_key(row["name"]))].append(row)

    dupes = {k: v for k, v in groups.items() if len(v) > 1}

    to_disable: list[tuple[str, str, str]] = []   # (dupe_id, dupe_name, canonical_id)
    price_fills: list[tuple[str, str, str, float, str]] = []  # canonical, storage, grade, price, from
    conflicts: list[tuple[str, str, str, float, float]] = []  # model, storage, grade, keep, other
    skipped_fills: list[tuple[str, str, str, float, str]] = []  # model, storage, grade, price, why

    for (category_id, key), rows in sorted(dupes.items(), key=lambda kv: -len(kv[1])):
        rows.sort(key=rank_canonical)
        canonical, *others = rows

        existing = {
            (storage, grade): (price, src)
            for storage, grade, price, src in cur.execute(
                "SELECT storage, condition_grade, base_price, source FROM prices WHERE device_id = ?",
                (canonical["id"],),
            ).fetchall()
        }
        filled: dict[tuple[str, str], tuple[float, str]] = {}
        # Ceiling per grade, from what the canonical itself already charges.
        grade_ceiling: dict[str, float] = {}
        for (_storage, grade), (price, _src) in existing.items():
            grade_ceiling[grade] = max(grade_ceiling.get(grade, 0.0), price)

        for other in others:
            to_disable.append((other["id"], other["name"], canonical["id"]))
            for storage, grade, price, src in cur.execute(
                "SELECT storage, condition_grade, base_price, source FROM prices"
                " WHERE device_id = ? AND base_price > 0",
                (other["id"],),
            ).fetchall():
                slot = (storage, grade)
                if slot in existing:
                    if abs(existing[slot][0] - price) > 0.5:
                        conflicts.append((key, storage, grade, existing[slot][0], price))
                    continue
                if slot in filled:
                    continue
                # Gap on the canonical. Duplicates are ranked best-first, but a
                # price is only promoted if it can be trusted with real money.
                if src in UNTRUSTED_PRICE_SOURCES:
                    skipped_fills.append((key, storage, grade, price, f"source={src}"))
                    continue
                ceiling = grade_ceiling.get(grade)
                if ceiling and price > ceiling * FILL_SANITY_MULTIPLE:
                    skipped_fills.append(
                        (key, storage, grade, price, f"{price:.0f} > {FILL_SANITY_MULTIPLE}x canonical {ceiling:.0f}")
                    )
                    continue
                filled[slot] = (price, other["id"])
                price_fills.append((canonical["id"], storage, grade, price, other["id"]))

    print("=" * 74)
    print("CATALOG DE-DUPLICATION", "(dry run)" if not args.apply else "(applying)")
    print("=" * 74)
    print(f"Enabled devices          : {sum(len(v) for v in groups.values())}")
    print(f"Distinct models          : {len(groups)}")
    print(f"Models with >1 row       : {len(dupes)}")
    print(f"Rows to disable          : {len(to_disable)}")
    print(f"Price gaps to fill       : {len(price_fills)}")
    print(f"Gap-fills refused        : {len(skipped_fills)}  (untrusted source or implausible)")
    print(f"Price conflicts (review) : {len(conflicts)}  (canonical's number kept)")
    print()

    shown = sorted(dupes.items(), key=lambda kv: -len(kv[1]))
    for (category_id, key), rows in (shown if args.verbose else shown[:10]):
        rows_sorted = sorted(rows, key=rank_canonical)
        keep = rows_sorted[0]
        flags = "".join(
            (
                "O" if keep["offer_refs"] else "-",
                "E" if keep["engine_known"] else "-",
                "S" if keep["silhouette"] else "-",
            )
        )
        print(f"{key!r} [{category_id}] — {len(rows)} rows")
        print(f"    KEEP   {keep['id']:<52} {keep['name'][:44]!r}  prices={keep['price_count']} [{flags}]")
        for row in rows_sorted[1:]:
            print(f"    drop   {row['id'][:52]:<52} {row['name'][:44]!r}  prices={row['price_count']}")
    if not args.verbose and len(shown) > 10:
        print(f"\n… and {len(shown) - 10} more groups (--verbose to list all)")

    if conflicts:
        print()
        print("-" * 74)
        print("PRICE CONFLICTS — kept the canonical's number, review these")
        print("-" * 74)
        for key, storage, grade, keep_price, other_price in conflicts[:25]:
            print(f"  {key:<26} {storage:<8} {grade:<10} kept ${keep_price:<8.0f} other ${other_price:.0f}")
        if len(conflicts) > 25:
            print(f"  … and {len(conflicts) - 25} more")

    if not args.apply:
        print()
        print("Dry run — nothing written. Re-run with --apply to commit.")
        conn.close()
        return 0

    try:
        cur.execute("BEGIN")
        upsert = (
            "INSERT INTO prices (device_id, storage, condition_grade, base_price, source, updated_at)"
            " VALUES (?, ?, ?, ?, 'dedupe-merge', datetime('now'))"
            " ON CONFLICT(device_id, storage, condition_grade)"
            " DO UPDATE SET base_price = excluded.base_price,"
            " source = excluded.source, updated_at = datetime('now')"
        )
        for canonical_id, storage, grade, price, _from in price_fills:
            cur.execute(upsert, (canonical_id, storage, grade, price))
        for dupe_id, _name, _canonical in to_disable:
            cur.execute("UPDATE devices SET enabled = 0 WHERE id = ?", (dupe_id,))
        conn.commit()
    except Exception as exc:
        conn.rollback()
        print(f"\nFAILED — rolled back: {exc}")
        conn.close()
        return 1

    remaining = cur.execute("SELECT COUNT(*) FROM devices WHERE enabled = 1").fetchone()[0]
    conn.close()
    print()
    print(f"Applied. Disabled {len(to_disable)} duplicate rows, filled {len(price_fills)} price gaps.")
    print(f"Enabled catalog is now {remaining} devices — one per model.")
    print("Re-run images:backfill + images:audit next, then verify quotes.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
