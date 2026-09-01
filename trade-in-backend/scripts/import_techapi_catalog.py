"""
TechAPI → Tech Genius backend catalog importer (Scrapling-based).

This creates/updates:
  - categories
  - brands
  - devices (id, name, storages, image_url)
  - prices matrix for all condition grades

Pricing model:
  - Uses TechAPI msrp_usd when present
  - Otherwise estimates msrp_usd from score.overall
  - Converts msrp_usd → flawless base_price, then applies condition multipliers

Note:
  - TechAPI does not always provide image_url for every slug. If image_url is
    null, we still import the device (frontend can fall back).
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
from dataclasses import dataclass, field
from pathlib import Path
from statistics import median
from typing import Any, Dict, Iterable, List, Optional

try:
    from scrapling.fetchers import Fetcher
except ImportError:
    print("ERROR: scrapling not installed. Run: pip3 install scrapling", file=sys.stderr)
    raise


@dataclass(frozen=True)
class ImportConfig:
    techapi_base_url: str
    resources: List[Dict[str, Any]]
    allowed_brand_slugs: List[str]
    max_devices_per_resource_brand: int
    require_image_url: bool
    estimate_from_score_factor: float
    flawless_quote_fraction: float
    storage_base_adjustment: float
    min_price: float
    max_price: float
    import_source_label: str
    prefer_verified: bool = True
    name_include_keywords: List[str] = field(default_factory=list)
    name_exclude_keywords: List[str] = field(default_factory=list)


MARKETING_TO_BRAND = {
    "galaxy": "samsung",
    "pixel": "google",
    "iphone": "apple",
    "ipad": "apple",
    "macbook": "apple",
    "watch": "apple",
}


def _infer_brand(slug: str, name: str, allowed: List[str]) -> Optional[str]:
    hay = f"{slug} {name}".lower()
    for b in allowed:
        if slug.startswith(f"{b}-") or hay.startswith(b):
            return b
    for token, brand in MARKETING_TO_BRAND.items():
        if brand in allowed and (token in slug or token in hay):
            return brand
    return None


def _name_allowed(slug: str, name: str, cfg: ImportConfig) -> bool:
    hay = f"{slug} {name}".lower()
    for bad in cfg.name_exclude_keywords:
        if bad.lower() in hay:
            return False
    if not cfg.name_include_keywords:
        return True
    return any(k.lower() in hay for k in cfg.name_include_keywords)


CONDITION_MULTIPLIER: Dict[str, float] = {
    "flawless": 1.0,
    "good": 0.9,
    "average": 0.78,
    "fair": 0.62,
    "defective": 0.4,
}


def _fetch_json(url: str, *, timeout: int = 30) -> Dict[str, Any]:
    # Scrapling Fetcher works for JSON too; response bytes live in `body`.
    page = Fetcher.get(url, stealthy_headers=False, timeout=timeout)
    raw = getattr(page, "body", None)
    if raw is None:
        raise RuntimeError(f"Scrapling returned no body for {url}")
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8")
    return json.loads(raw)


def _upsert(
    cur: sqlite3.Cursor,
    sql: str,
    params: Iterable[Any],
) -> None:
    cur.execute(sql, list(params))


def _to_storage_strings(storage_options: Any) -> List[str]:
    if not storage_options:
        return []

    out: List[str] = []
    for s in storage_options:
        # TechAPI sometimes gives numbers (GB), sometimes strings.
        if isinstance(s, (int, float)):
            gb = int(s)
            out.append(f"{gb}GB")
        else:
            txt = str(s).strip()
            # If it's a bare number, normalize to "NNGB"
            m = re.fullmatch(r"(\d+)\s*gb", txt, flags=re.IGNORECASE)
            if m:
                out.append(f"{m.group(1)}GB")
            else:
                # If it's like "1024GB" keep it.
                out.append(txt)
    # Keep stable order and remove duplicates.
    seen = set()
    uniq: List[str] = []
    for x in out:
        if x in seen:
            continue
        seen.add(x)
        uniq.append(x)
    return uniq


def _estimate_msrp_usd(rec: Dict[str, Any], cfg: ImportConfig) -> Optional[float]:
    msrp = rec.get("msrp_usd", None)
    if isinstance(msrp, (int, float)) and msrp > 0:
        return float(msrp)

    score = rec.get("score") or {}
    overall = score.get("overall")
    if isinstance(overall, (int, float)) and overall > 0:
        return float(overall) * cfg.estimate_from_score_factor

    return None


def _storage_factor(storage_gb: float, median_gb: float, cfg: ImportConfig) -> float:
    if median_gb <= 0:
        return 1.0
    delta = (storage_gb - median_gb) / median_gb
    factor = 1.0 + (delta * cfg.storage_base_adjustment)
    return max(0.85, min(1.25, factor))


def _storage_to_gb(storage: str) -> Optional[float]:
    m = re.match(r"^\s*(\d+(?:\.\d+)?)\s*gb\s*$", storage, flags=re.IGNORECASE)
    if not m:
        return None
    try:
        return float(m.group(1))
    except Exception:
        return None


def import_from_techapi(cfg: ImportConfig, db_path: str) -> int:
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    cur = conn.cursor()

    def upsert_category(category_id: str) -> None:
        _upsert(
            cur,
            """
            INSERT INTO categories (id, name, sort_order, enabled)
            VALUES (?, ?, 0, 1)
            ON CONFLICT(id) DO UPDATE SET enabled = 1
            """,
            [category_id, category_id.title().replace("_", " ")],
        )

    def upsert_brand(brand_id: str, brand_name: str, category_id: str) -> None:
        _upsert(
            cur,
            """
            INSERT INTO brands (id, name, category_id, enabled)
            VALUES (?, ?, ?, 1)
            ON CONFLICT(id) DO UPDATE SET enabled = 1, name = excluded.name, category_id = excluded.category_id
            """,
            [brand_id, brand_name, category_id],
        )

    def upsert_device(
        device_id: str,
        category_id: str,
        brand_id: str,
        name: str,
        storages: List[str],
        image_url: Optional[str],
    ) -> None:
        _upsert(
            cur,
            """
            INSERT INTO devices (id, category_id, brand_id, name, storages, image_url, enabled)
            VALUES (?, ?, ?, ?, ?, ?, 1)
            ON CONFLICT(id) DO UPDATE SET
              category_id = excluded.category_id,
              brand_id = excluded.brand_id,
              name = excluded.name,
              storages = excluded.storages,
              image_url = excluded.image_url,
              enabled = 1
            """,
            [
                device_id,
                category_id,
                brand_id,
                name,
                json.dumps(storages, ensure_ascii=False),
                image_url,
            ],
        )

    def upsert_price_points(
        device_id: str,
        storages: List[str],
        flawless_base_price_by_storage_gb: Dict[str, float],
    ) -> None:
        for storage in storages:
            base_flawless = float(flawless_base_price_by_storage_gb.get(storage, 0))
            if base_flawless <= 0:
                continue
            for grade, mult in CONDITION_MULTIPLIER.items():
                price = round(base_flawless * mult)
                price = max(cfg.min_price, min(cfg.max_price, price))
                _upsert(
                    cur,
                    """
                    INSERT INTO prices (device_id, storage, condition_grade, base_price, source, updated_at)
                    VALUES (?, ?, ?, ?, ?, datetime('now'))
                    ON CONFLICT(device_id, storage, condition_grade) DO UPDATE SET
                      base_price = excluded.base_price,
                      source = excluded.source,
                      updated_at = datetime('now')
                    """,
                    [device_id, storage, grade, price, cfg.import_source_label],
                )

    total_devices = 0

    try:
        conn.execute("BEGIN")

        for resource in cfg.resources:
            resource_name = resource["resource"]  # e.g. "smartphones"
            category_id = resource["category_id"]  # e.g. "smartphone"
            list_endpoint = f"{cfg.techapi_base_url}/v1/{resource_name}"

            upsert_category(category_id)

            index = _fetch_json(list_endpoint)
            results = index.get("results", [])
            if not isinstance(results, list):
                continue

            # Group by brand slug prefix (kebab-case slugs are brand-prefix-heavy).
            selected: List[str] = []
            per_brand_count: Dict[str, int] = {b: 0 for b in cfg.allowed_brand_slugs}

            # Iterate in the order returned by TechAPI; filter + cap per brand.
            for entry in results:
                slug = entry.get("slug")
                name = str(entry.get("name") or "")
                if not isinstance(slug, str) or not slug:
                    continue
                if not _name_allowed(slug, name, cfg):
                    continue
                # brand prefix heuristic: "{brand}-..."
                brand_prefix = _infer_brand(slug, name, cfg.allowed_brand_slugs)
                if not brand_prefix:
                    continue
                if per_brand_count.get(brand_prefix, 0) >= cfg.max_devices_per_resource_brand:
                    continue
                per_brand_count[brand_prefix] = per_brand_count.get(brand_prefix, 0) + 1
                selected.append(slug)

            for slug in selected:
                detail_url = f"{cfg.techapi_base_url}/v1/{resource_name}/{slug}"
                rec = _fetch_json(detail_url)

                brand = rec.get("brand") or {}
                brand_slug = brand.get("slug")
                brand_name = brand.get("name")
                if not isinstance(brand_slug, str) or brand_slug not in cfg.allowed_brand_slugs:
                    continue
                if not isinstance(brand_name, str) or not brand_name:
                    brand_name = brand_slug.title()

                brand_id = f"{brand_slug}-{category_id}"
                upsert_brand(brand_id, brand_name, category_id)

                device_storages = _to_storage_strings(rec.get("storage_options_gb"))
                if not device_storages:
                    # fallback to a "default" storage bucket
                    device_storages = ["default"]

                image_url = rec.get("image_url")
                if image_url is not None and not isinstance(image_url, str):
                    image_url = None
                if cfg.require_image_url and not image_url:
                    continue

                if cfg.prefer_verified and rec.get("verified") is False and not image_url:
                    # Skip unverified junk without photos unless we already have room.
                    continue

                device_id = rec.get("slug") or slug
                if not isinstance(device_id, str):
                    continue
                device_name = rec.get("name") or device_id
                if not isinstance(device_name, str):
                    device_name = str(device_id)

                if not _name_allowed(device_id, device_name, cfg):
                    continue

                upsert_device(
                    device_id=device_id,
                    category_id=category_id,
                    brand_id=brand_id,
                    name=device_name,
                    storages=device_storages,
                    image_url=image_url,
                )

                msrp_est = _estimate_msrp_usd(rec, cfg)
                if msrp_est is None or msrp_est <= 0:
                    continue

                # Compute flawless base_price per storage using a storage factor.
                numeric_storages: List[float] = []
                storage_gb_by_storage: Dict[str, float] = {}
                for s in device_storages:
                    gb = _storage_to_gb(s)
                    if gb is None:
                        continue
                    storage_gb_by_storage[s] = gb
                    numeric_storages.append(gb)

                med = median(numeric_storages) if numeric_storages else 128.0
                base_flawless_for_median = msrp_est * cfg.flawless_quote_fraction

                flawless_base_price_by_storage: Dict[str, float] = {}
                for s in device_storages:
                    gb = storage_gb_by_storage.get(s, med)
                    factor = _storage_factor(float(gb), float(med), cfg)
                    flawless_base_price_by_storage[s] = base_flawless_for_median * factor

                upsert_price_points(device_id, device_storages, flawless_base_price_by_storage)

                total_devices += 1

        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    return total_devices


def load_config(path: str) -> ImportConfig:
    cfg_raw = json.loads(Path(path).read_text("utf-8"))
    return ImportConfig(
        techapi_base_url=str(cfg_raw["techapi_base_url"]),
        resources=list(cfg_raw["resources"]),
        allowed_brand_slugs=list(cfg_raw["allowed_brand_slugs"]),
        max_devices_per_resource_brand=int(cfg_raw["max_devices_per_resource_brand"]),
        require_image_url=bool(cfg_raw.get("require_image_url", False)),
        estimate_from_score_factor=float(cfg_raw.get("estimate_from_score_factor", 40.0)),
        flawless_quote_fraction=float(cfg_raw.get("flawless_quote_fraction", 0.42)),
        storage_base_adjustment=float(cfg_raw.get("storage_base_adjustment", 0.10)),
        min_price=float(cfg_raw.get("min_price", 20)),
        max_price=float(cfg_raw.get("max_price", 20000)),
        import_source_label=str(cfg_raw.get("import_source_label", "techapi-import")),
        prefer_verified=bool(cfg_raw.get("prefer_verified", True)),
        name_include_keywords=list(cfg_raw.get("name_include_keywords") or []),
        name_exclude_keywords=list(cfg_raw.get("name_exclude_keywords") or []),
    )


def main() -> int:
    ap = argparse.ArgumentParser(description="Import TechAPI devices into Tech Genius backend")
    ap.add_argument("--config", required=True, help="Path to techapi import config JSON")
    ap.add_argument(
        "--db",
        default=str(Path(__file__).resolve().parent.parent / "data" / "tradein.db"),
        help="Path to SQLite DB",
    )
    args = ap.parse_args()

    cfg = load_config(args.config)
    imported = import_from_techapi(cfg, args.db)
    print(f"Imported/updated {imported} devices from TechAPI into {args.db}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

