#!/usr/bin/env python3
"""Regression tests for the device -> image resolver.

Covers the bugs that produced the shared-image defect in the catalog:
  * TechAPI names embed Apple's internal model code, and the slug flattens
    '(Apple iPhone 13,2)' to '...-apple-iphone-132'. Matching on that made
    every iPhone 12 SKU resolve to iphone-13.png.
  * Sibling fallbacks ('no Tab S10 FE photo? use tab-s9') put a different
    handset in front of the shopper.
  * A five-character model token ('Flip6') looked like a vendor order code
    and collapsed different foldables onto one model key.

Run: python3 scripts/test_image_resolver.py
"""
from __future__ import annotations

import sys

from image_aliases import derive_stems, model_key, resolve_stem

FAILURES: list[str] = []


def check(label: str, got, want) -> None:
    if got != want:
        FAILURES.append(f"{label}\n     got:  {got!r}\n     want: {want!r}")


def check_true(label: str, cond: bool) -> None:
    if not cond:
        FAILURES.append(label)


# --------------------------------------------------------------------------
# model_key: what counts as "the same product"
# --------------------------------------------------------------------------
IPHONE_12_JP = "Apple iPhone 12 5G A2402 Dual SIM TD-LTE JP CA 128GB (Apple iPhone 13,2)"
IPHONE_12_GLOBAL = "Apple iPhone 12 5G A2403 Global Dual SIM TD-LTE 256GB (Apple iPhone 13,2)"
IPHONE_12_PRO = "Apple iPhone 12 Pro 5G A2406 Dual SIM TD-LTE JP CA 512GB (Apple iPhone 13,3)"
IPHONE_12_MINI = "Apple iPhone 12 Mini 5G A2398 Dual SIM TD-LTE JP CA 64GB (Apple iPhone 13,1)"

check("iPhone 12 JP SKU -> model key", model_key(IPHONE_12_JP), "iphone 12")
check("iPhone 12 global SKU -> model key", model_key(IPHONE_12_GLOBAL), "iphone 12")
check("iPhone 12 Pro -> model key", model_key(IPHONE_12_PRO), "iphone 12 pro")
check("iPhone 12 Mini -> model key", model_key(IPHONE_12_MINI), "iphone 12 mini")
check("plain 'iPhone 13' -> model key", model_key("iPhone 13"), "iphone 13")

# Storage and region are trim, not identity.
check_true(
    "storage/region variants of one model share a key",
    model_key(IPHONE_12_JP) == model_key(IPHONE_12_GLOBAL),
)
# Pro / Mini / base are separate products.
for a, b in (
    (IPHONE_12_JP, IPHONE_12_PRO),
    (IPHONE_12_JP, IPHONE_12_MINI),
    (IPHONE_12_JP, "iPhone 13"),
):
    check_true(f"different models keep different keys: {a[:28]!r} vs {b[:28]!r}", model_key(a) != model_key(b))

# Five-character model tokens must not be eaten as vendor order codes.
check("Galaxy Z Flip6 keeps its model token", model_key("Galaxy Z Flip6"), "galaxy z flip6")
check("Galaxy Z Fold6 keeps its model token", model_key("Galaxy Z Fold6"), "galaxy z fold6")
check_true(
    "Flip6 and Fold6 are different models",
    model_key("Galaxy Z Flip6") != model_key("Galaxy Z Fold6"),
)

# Real vendor order codes still get stripped.
check(
    "Pixel order code stripped",
    model_key("Google Pixel 10 Pro 5G Global TD-LTE 128GB GEHN3 (Google Blazer)"),
    "pixel 10 pro",
)
check_true(
    "Pixel regional SKUs of one model agree",
    model_key("Google Pixel 10 Pro 5G Global TD-LTE 128GB GEHN3 (Google Blazer)")
    == model_key("Google Pixel 10 Pro UW 5G Dual SIM TD-LTE US 1TB G4QUR (Google Blazer)"),
)
check_true(
    "Pixel 10 Pro and 10 Pro XL stay apart",
    model_key("Google Pixel 10 Pro 5G Global TD-LTE 128GB GEHN3 (Google Blazer)")
    != model_key("Google Pixel 10 Pro XL 5G Global TD-LTE 256GB G45RY (Google Mustang)"),
)

# Chip token collapses only when a release year disambiguates the generation.
check_true(
    "'iPad Air 11 M2 (2024)' == 'iPad Air 11 (2024)'",
    model_key('iPad Air 11" M2 (2024)') == model_key("Apple iPad Air 11 (2024)"),
)
check_true(
    "iPad Air M2 2024 != M3 2025",
    model_key('iPad Air 11" M2 (2024)') != model_key('iPad Air 11" M3 (2025)'),
)
check_true(
    "MacBook Air M2 != M3 (no year to disambiguate, chip is kept)",
    model_key("MacBook Air M2") != model_key("MacBook Air M3"),
)


# --------------------------------------------------------------------------
# resolve_stem: never returns another model's photo
# --------------------------------------------------------------------------
DISK = {
    "iphone-12", "apple-iphone-12", "apple-iphone-12-pro", "apple-iphone-12-mini",
    "iphone-13", "iphone-13-mini", "iphone-15",
    "apple-iphone-11-pro", "apple-iphone-xs",
    "galaxy-tab-s10-fe", "tab-s9",
    "galaxy-watch6", "watch6-classic",
    "pixel-9", "pixel-tablet",
    "ipad-air-11-m2-2024",
}

# The headline bug: an iPhone 12 SKU must never land on iphone-13.
for name in (IPHONE_12_JP, IPHONE_12_GLOBAL):
    got = resolve_stem(name, DISK)
    check_true(f"iPhone 12 SKU resolves to an iPhone 12 photo (got {got!r})", got in {"iphone-12", "apple-iphone-12"})
check("iPhone 12 Pro resolves to its own photo", resolve_stem(IPHONE_12_PRO, DISK), "apple-iphone-12-pro")
check("iPhone 12 Mini resolves to its own photo", resolve_stem(IPHONE_12_MINI, DISK), "apple-iphone-12-mini")
check("plain iPhone 13 still resolves", resolve_stem("iPhone 13", DISK), "iphone-13")

# No cross-model sibling fallbacks.
check("Tab S10 FE uses its own photo, not tab-s9", resolve_stem("Samsung Galaxy Tab S10 FE", DISK), "galaxy-tab-s10-fe")
check("Tab S10 FE+ has no photo -> None (silhouette)", resolve_stem("Samsung Galaxy Tab S10 FE+", DISK), None)
check("Galaxy Watch6 != Watch6 Classic", resolve_stem("Samsung Galaxy Watch6", DISK), "galaxy-watch6")
check("Watch6 Classic keeps its own", resolve_stem("Galaxy Watch6 Classic", DISK), "watch6-classic")
check("iPhone 11 Pro uses its own photo, not an XS", resolve_stem("Apple iPhone 11 Pro", DISK), "apple-iphone-11-pro")
check("Pixel C has no photo -> None (not pixel-tablet)", resolve_stem("Google Pixel C", DISK), None)
check("Pixel 4 has no photo -> None (not pixel-9)", resolve_stem("Google Pixel 4", DISK), None)
check("unknown future model -> None (not iphone-15)", resolve_stem("iPhone 19 Ultra", DISK), None)

# Curated alias still bridges catalog spelling -> filename spelling.
check("iPad Air 11 (2024) -> m2 filename", resolve_stem("Apple iPad Air 11 (2024)", DISK), "ipad-air-11-m2-2024")

# Derived stems must always encode the device's own model.
check_true(
    "derived stems are model-specific",
    all("12-pro" in s or "12" in s for s in derive_stems(IPHONE_12_PRO)[:2]),
)


# --------------------------------------------------------------------------
# The invariant, stated directly: no two model keys may resolve to one stem.
# --------------------------------------------------------------------------
NAMES = [
    IPHONE_12_JP, IPHONE_12_GLOBAL, IPHONE_12_PRO, IPHONE_12_MINI, "iPhone 13",
    "Samsung Galaxy Tab S10 FE", "Galaxy Tab S9", "Samsung Galaxy Watch6",
    "Galaxy Watch6 Classic", "Apple iPhone 11 Pro", "iPhone XS",
]
owner: dict[str, str] = {}
for name in NAMES:
    stem = resolve_stem(name, DISK)
    if stem is None:
        continue
    key = model_key(name)
    if stem in owner and owner[stem] != key:
        FAILURES.append(f"stem {stem!r} claimed by two models: {owner[stem]!r} and {key!r}")
    owner[stem] = key


if FAILURES:
    print(f"FAILED — {len(FAILURES)} check(s):\n")
    for f in FAILURES:
        print(f"  ✗ {f}")
    sys.exit(1)

print("image resolver: all checks passed")
