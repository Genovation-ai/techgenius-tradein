"""Canonical device -> image-stem resolution (single source of truth).

Shared by backfill_device_images.py, build_device_image.py and
audit_device_images.py so they can never disagree about which image a device
should show.

The rule this file enforces
--------------------------
    Same model, different storage/region -> SHOULD share one image.
    Two genuinely different models       -> MUST NOT share an image.

How a stem is chosen (in order)
-------------------------------
1. ``derive_stems(name)`` — build candidate filename stems out of the device's
   OWN model name. Because every candidate is generated from that device's
   model key, two different models can never derive the same stem. This is the
   path that resolves the overwhelming majority of the catalog.
2. ``FAMILY_ALIASES`` — a small curated table for models whose photo is filed
   under a spelling the name does not produce (e.g. "iPad Air 11 (2024)" is
   filed as ``ipad-air-11-m2-2024``). Every entry lists only alternative
   spellings of the SAME model. There are deliberately **no** cross-model
   sibling fallbacks (no iPhone 17 -> iphone-16, no Tab S10 FE -> tab-s9) and
   **no** catch-alls (no bare ``pixel`` -> pixel-9, no bare ``iphone`` ->
   iphone-15): showing a shopper the wrong handset is worse than showing a
   clean generated silhouette of the right one.
3. Caller generates a per-slug silhouette. Unique, honest, labelled with the
   device's real name.

Why the device id is not used for matching
------------------------------------------
Ids are slugified names, so they carry no extra signal — but they do carry
extra noise. TechAPI names embed Apple's internal model code, and the slug
flattens ``(Apple iPhone 13,2)`` into ``...-apple-iphone-132``. Matching that
made every iPhone 12 SKU look like an iPhone 13. Matching is on the display
name only, with internal-codename parentheticals stripped first.
"""
from __future__ import annotations

import re

# --------------------------------------------------------------------------
# Name normalisation
# --------------------------------------------------------------------------

# '(Apple iPhone 13,2)', '(Google Blazer)' — vendor-internal model codenames.
# Year parentheticals like '(2024)' are NOT matched here: they name the model.
_CODENAME_PAREN = re.compile(
    r"\([^)]*\b(Apple|Google|Samsung|Motorola|HTC|LG|Sony|Huawei|Xiaomi)\b[^)]*\)",
    re.I,
)
# '(256GB)' — a storage variant, never a different model.
_STORAGE_PAREN = re.compile(r"\(\s*\d+\s?(?:GB|TB)\s*\)", re.I)
_STORAGE = re.compile(r"\b\d+\s?(?:GB|TB|MB)\b", re.I)
_RAM = re.compile(r"\b\d+GB\s?RAM\b", re.I)
_APPLE_MODEL_NO = re.compile(r"\bA\d{4}\b", re.I)
# Vendor order codes: 5-char ALL-CAPS alphanumerics holding a digit — GEHN3,
# GN4F5, G4QUR, GK2MP, GLBW0, G45RY, GUL82, GYPW4, GM66V, G025N. The all-caps
# requirement matters: it is what keeps model tokens that happen to be five
# characters ("Flip3", "Fold6") from being mistaken for order codes and
# collapsing two different foldables onto one model key.
_VENDOR_SKU = re.compile(r"\b(?=[A-Z0-9]{5}\b)(?=[A-Z0-9]*\d)[A-Z][A-Z0-9]{4}\b")
# Region / retail qualifiers. A model does not change because it is the
# Japanese dual-SIM variant.
_VARIANT_TOKENS = re.compile(
    r"\b(?:td|td-lte|uw|dual|sim|esim|global|unlocked|"
    r"jp|ca|cn|us|eu|uk|au|kr|row)\b",
    re.I,
)

# Radio generation. Ambiguous on purpose: in a TechAPI SKU dump
# ("Apple iPhone 12 5G A2402 Dual SIM TD-LTE JP CA 128GB") it is a radio
# descriptor, but in a marketing name ("Google Pixel 4a 5G", "Galaxy Z Fold2
# 5G") it is part of the model — Pixel 4a and Pixel 4a 5G are different phones
# at different prices. So it is only stripped when the name also carries an
# SKU marker, which is what distinguishes the two shapes of name.
_RADIO_TOKENS = re.compile(r"\b(?:5g|4g|3g|lte)\b", re.I)
# The vendor-code branch stays case-SENSITIVE (scoped (?i:) covers only the
# other three): with a blanket re.I, "Fold2" reads as a 5-char order code and
# "Galaxy Z Fold2 5G" loses its 5G.
_SKU_MARKERS = re.compile(
    r"(?i:\bA\d{4}\b|\bTD-LTE\b|\bDual\s+SIM\b)"
    r"|\b(?=[A-Z0-9]{5}\b)(?=[A-Z0-9]*\d)[A-Z][A-Z0-9]{4}\b"
)
_BRAND_PREFIXES = (
    "apple", "google", "samsung", "motorola", "moto", "microsoft", "sony",
    "dell", "lenovo", "asus", "meta", "valve", "nintendo", "hp", "oneplus",
    "huawei", "xiaomi", "lg", "nothing",
)
_LEADING_BRAND = re.compile(rf"^(?:{'|'.join(_BRAND_PREFIXES)})[- ]+", re.I)


def strip_apple_parenthetical(text: str) -> str:
    """Remove vendor-internal codename parentheticals such as
    '(Apple iPhone 13,2)' or '(Google Blazer)'. Year parentheticals such as
    '(2024)' are kept — they are part of the model name."""
    return _CODENAME_PAREN.sub(" ", text or "")


def _strip_noise(name: str) -> str:
    """Drop everything that varies within one model: codenames, storage,
    Apple model numbers, vendor SKUs, region qualifiers, and — only on SKU-shaped
    names — the radio generation."""
    raw = name or ""
    n = strip_apple_parenthetical(raw)
    # Decide before the markers themselves get stripped below.
    if _SKU_MARKERS.search(raw):
        n = _RADIO_TOKENS.sub(" ", n)
    n = _STORAGE_PAREN.sub(" ", n)
    n = n.replace("+", " plus ").replace("&", " and ")
    n = n.replace('"', " ").replace("”", " ").replace("“", " ").replace("'", " ")
    n = _RAM.sub(" ", n)
    n = _STORAGE.sub(" ", n)
    n = _APPLE_MODEL_NO.sub(" ", n)
    n = _VENDOR_SKU.sub(" ", n)
    n = _VARIANT_TOKENS.sub(" ", n)
    # A trailing '/ A2409' style alternate part number leaves a bare slash.
    n = re.sub(r"[/,]", " ", n)
    return re.sub(r"\s+", " ", n).strip()


# Models where a trailing "5G" is marketing, not a distinct product, so
# "<model>" and "<model> 5G" are one catalog row.
#
# This cannot be inferred: for the Pixel 4a and the original Galaxy Z Flip the
# 5G version is a genuinely different phone with a different chipset and price,
# while these Samsung flagships shipped 5G-only and the suffix just varies by
# region and retailer. Each entry below is a deliberate product call; add to it
# only when you have checked that no separate non-5G model exists.
SAME_MODEL_WITH_5G_SUFFIX = {
    "galaxy s20 ultra",
    "galaxy s21 ultra",
    "galaxy s21 plus",
}


def model_key(name: str) -> str:
    """The identity of a model, as a shopper would name it.

    Two catalog rows with the same model_key are the same product in different
    storage/region trim and MAY share one photo. Two rows with different
    model_keys are different products and MUST NOT.

        'Apple iPhone 12 5G A2402 Dual SIM TD-LTE JP CA 128GB (Apple iPhone 13,2)'
            -> 'iphone 12'
        'Apple iPhone 12 Pro 5G A2406 ... (Apple iPhone 13,3)'
            -> 'iphone 12 pro'
    """
    n = _strip_noise(name).lower()
    n = re.sub(r"[^a-z0-9. ]", " ", n)
    n = re.sub(r"\s+", " ", n).strip()
    n = _LEADING_BRAND.sub("", n)
    # 'iPad Air 11" M2 (2024)' and 'iPad Air 11 (2024)' are the same product
    # listed twice. Drop the chip token when a release year is also present —
    # the year is what separates the M2/M3/M4 generations, so nothing merges
    # that shouldn't. (Kept out of _strip_noise: derive_stems still needs the
    # chip to build the 'ipad-air-11-m2-2024' filename.)
    if re.search(r"\b(?:19|20)\d{2}\b", n):
        n = re.sub(r"\bm\d\b", " ", n)
        n = re.sub(r"\s+", " ", n).strip()

    # Collapse a marketing-only 5G suffix, but only for models on the list.
    if n.endswith(" 5g") and n[:-3].strip() in SAME_MODEL_WITH_5G_SUFFIX:
        n = n[:-3].strip()
    return n.strip()


def _slugify(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (text or "").lower())
    return re.sub(r"-+", "-", s).strip("-")


def derive_stems(name: str) -> list[str]:
    """Candidate filename stems built from this device's own model name.

    Every candidate encodes the device's model key, so two different models can
    never derive the same stem — which is what keeps the 'no shared photos
    across models' rule true by construction rather than by vigilance.
    """
    cleaned = _strip_noise(name)
    full = _slugify(cleaned)
    if not full:
        return []

    bare = _LEADING_BRAND.sub("", cleaned)
    bare_slug = _slugify(bare)

    out: list[str] = []

    def add(stem: str) -> None:
        if stem and stem not in out:
            out.append(stem)

    # Most specific first: exactly what the name says, then with/without the
    # brand prefix that filenames are inconsistent about.
    add(full)
    add(bare_slug)
    for brand in ("apple", "samsung", "google", "oneplus", "motorola"):
        if bare_slug and not bare_slug.startswith(f"{brand}-"):
            add(f"{brand}-{bare_slug}")

    # Filenames spell ordinal generations both ways: 'ipad-7th-gen' and
    # 'ipad-7'. Offer both, still inside this one model.
    ordinal = re.sub(r"-(\d+)(?:st|nd|rd|th)-gen\b", r"-\1", bare_slug)
    add(ordinal)
    add(re.sub(r"-gen\b", "", bare_slug))
    # 'galaxy-watch-7' <-> 'galaxy-watch7'
    add(re.sub(r"-(\d+)$", r"\1", bare_slug))
    add(re.sub(r"([a-z])(\d+)$", r"\1-\2", bare_slug))

    return out


# --------------------------------------------------------------------------
# Curated aliases — alternative spellings of the SAME model only.
# --------------------------------------------------------------------------
# Used when derive_stems misses because the photo is filed under a name the
# catalog does not use (chip/year suffixes, marketing vs internal spellings).
# A pattern must never map to a different product. Ordered most specific first.
FAMILY_ALIASES: list[tuple[str, list[str]]] = [
    # --- iPad Air: catalog says '11 (2024)', the photo says '11-m2-2024' ---
    (r"^ipad air 11 2026$", ["ipad-air-11-m4-2026"]),
    (r"^ipad air 13 2026$", ["ipad-air-13-m4-2026"]),
    (r"^ipad air 11 2025$", ["ipad-air-11-m3-2025"]),
    (r"^ipad air 13 2025$", ["ipad-air-13-m3-2025"]),
    (r"^ipad air 11 2024$", ["ipad-air-11-m2-2024"]),
    (r"^ipad air 13 2024$", ["ipad-air-13-m2-2024"]),
    (r"^ipad air m2$", ["ipad-air-m2", "ipad-air-11-m2-2024"]),
    (r"^ipad air m3$", ["ipad-air-11-m3-2025"]),
    (r"^ipad air (\d)(?:st|nd|rd|th)? gen$", [r"ipad-air-\1th-gen"]),

    # --- iPad mini / iPad: ordinal spellings ---
    (r"^ipad mini 6$", ["ipad-mini-6", "ipad-mini-6th-gen"]),
    (r"^ipad mini 7$", ["ipad-mini-a17-pro", "ipad-mini-7"]),
    (r"^ipad mini a17 pro$", ["ipad-mini-a17-pro"]),
    (r"^ipad mini (\d)$", [r"ipad-mini-\1th-gen"]),
    (r"^ipad 10th$", ["ipad-10th-gen", "ipad-10"]),
    (r"^ipad (\d+)th$", [r"ipad-\1th-gen"]),

    # --- iPad Pro: chip/year spellings ---
    (r"^ipad pro 13 m4$", ["ipad-pro-13-m4", "ipad-pro-13-m4-2024"]),
    (r"^ipad pro 11 m4$", ["ipad-pro-11-m4-2024"]),
    (r"^ipad pro 11$", ["ipad-pro-11"]),

    # --- Apple Watch ---
    (r"^watch ultra 2$", ["watch-ultra-2"]),
    (r"^watch se 2$", ["watch-se-2", "watch-se-2nd-gen"]),
    (r"^apple watch (\d+)$", [r"watch-series-\1"]),
    (r"^watch (\d+)$", [r"watch-series-\1"]),

    # --- Samsung Galaxy: 'galaxy-s24' vs 's24' file spellings ---
    (r"^galaxy (s\d+.*)$", [r"\1", r"samsung-galaxy-\1"]),
    (r"^galaxy (tab s\d+.*)$", [r"\1"]),
    (r"^galaxy (z (?:fold|flip)\s?\d+)$", [r"\1", r"samsung-galaxy-\1"]),
    (r"^galaxy (watch\d+.*)$", [r"\1"]),

    # --- Google Pixel: 'google-pixel-7' vs 'pixel-7' ---
    (r"^pixel (.+)$", [r"pixel-\1", r"google-pixel-\1"]),

    # --- Same device, filed under a carrier/radio suffix -------------------
    # Verified individually. Near-miss matching also suggested S25 Edge -> S25,
    # iPad Air -> iPad Air 3rd gen, and Tab S 8.4 (2014) -> Tab S8 (2022); all
    # rejected as different products.
    (r"^galaxy s20 ultra$", ["samsung-galaxy-s20-ultra-5g", "s20-ultra"]),
    (r"^galaxy s21 ultra$", ["samsung-galaxy-s21-ultra-5g", "s21-ultra"]),
    (r"^ipad mini 4th gen$", ["ipad-mini-4th-gen"]),

    # --- MacBook / iMac year spellings ---
    (r"^macbook air 13 (\d{4})$", ["macbook-air-m3", "macbook-air-m2"]),
    (r"^imac 24 (\d{4})$", [r"imac-24-\1", "imac-24-2024"]),
]

_COMPILED_ALIASES = [(re.compile(p, re.I), stems) for p, stems in FAMILY_ALIASES]


# Last-resort per-brand / per-category stems. Only reachable when the caller
# cannot generate a silhouette (Pillow missing). Kept deliberately narrow, and
# the caller reports how many devices land here so it never goes unnoticed.
BRAND_FALLBACK_STEM: dict[str, str] = {
    "apple": "iphone-15",
    "samsung": "s24",
    "google": "pixel-9",
}

CATEGORY_FALLBACK_STEM: dict[str, str] = {
    "smartphone": "iphone-15",
    "tablet": "ipad-10",
    "smartwatch": "watch-series-9",
    "laptop": "macbook-air-m3",
    "computer": "imac-24-2024",
    "gaming-console": "playstation-5",
    "vr": "quest-3",
    "monitor": "studio-display",
}

# Generated per-slug placeholders are prefixed with this token so an audit can
# always tell a real product photo from a drawn stand-in.
SILHOUETTE_PREFIX = "_silhouette"

SILHOUETTE_BY_CATEGORY: dict[str, dict[str, str]] = {
    "smartphone":       {"shape": "phone",    "bg": "16,22,34",  "accent": "70,110,170"},
    "tablet":           {"shape": "tablet",   "bg": "10,28,58",  "accent": "40,98,180"},
    "smartwatch":       {"shape": "watch",    "bg": "20,24,28",  "accent": "52,168,83"},
    "laptop":           {"shape": "laptop",   "bg": "16,22,34",  "accent": "120,120,128"},
    "computer":         {"shape": "desktop",  "bg": "16,22,34",  "accent": "120,120,128"},
    "gaming-console":   {"shape": "console",  "bg": "12,16,22",  "accent": "200,120,40"},
    "vr":               {"shape": "headset",  "bg": "20,16,40",  "accent": "120,80,200"},
    "monitor":          {"shape": "monitor",  "bg": "16,22,34",  "accent": "120,120,128"},
}


def alias_stems(name: str) -> list[str]:
    """Curated alternative spellings for this device's model key."""
    key = model_key(name)
    if not key:
        return []
    out: list[str] = []
    for pattern, stems in _COMPILED_ALIASES:
        m = pattern.match(key)
        if not m:
            continue
        for stem in stems:
            # Expand \1-style backreferences against the matched key.
            expanded = re.sub(
                r"\\(\d)",
                lambda g: _slugify(m.group(int(g.group(1))) or ""),
                stem,
            )
            expanded = _slugify(expanded)
            if expanded and expanded not in out:
                out.append(expanded)
    return out


def resolve_stem(name: str, files: set[str]) -> str | None:
    """Return the image stem this device should use, or None.

    None means "no photo of this exact model exists" — the caller should then
    generate a per-slug silhouette rather than borrow another model's photo.
    """
    for stem in derive_stems(name):
        if stem in files:
            return stem
    for stem in alias_stems(name):
        if stem in files:
            return stem
    return None


def clean_haystack(*parts: str) -> str:
    """Backwards-compatible helper: lowercase, de-noised text for callers that
    still want a single searchable string. Prefer resolve_stem(name, files)."""
    return model_key(" ".join(p for p in parts if p))
