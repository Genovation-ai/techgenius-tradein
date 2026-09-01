"""
Tech Genius Price Scraper (Scrapling-based).

Reads config/scrape.json, fetches pricing pages, extracts prices
per device/storage/condition, and outputs JSON for the backend to import.

Usage:
  python3 scripts/scrape_prices.py --config config/scrape.json --output data/scraped_prices.json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    from scrapling.fetchers import Fetcher
except ImportError:
    print("ERROR: scrapling not installed. Run: pip3 install scrapling", file=sys.stderr)
    sys.exit(1)


def parse_price(text: str) -> Optional[float]:
    if not text:
        return None
    m = re.search(r"\$?\s*(\d[\d,]*(?:\.\d{1,2})?)", text.replace("\xa0", ""))
    if not m:
        return None
    return float(m.group(1).replace(",", ""))


def scrape_source(entry: Dict[str, Any]) -> List[Dict[str, Any]]:
    url = entry.get("url", "")
    device_id = entry.get("device_id", "")
    storage = entry.get("storage", "128GB")
    source_label = entry.get("source", "local-market")
    selectors = entry.get("selectors", {})

    if not url or not device_id:
        return []

    results: List[Dict[str, Any]] = []

    try:
        page = Fetcher.get(url, stealthy_headers=True, timeout=30)
    except Exception as e:
        print(f"  [WARN] Failed to fetch {url}: {e}", file=sys.stderr)
        return []

    for grade, selector in selectors.items():
        if not selector:
            continue
        try:
            nodes = page.css(selector).getall()
            for node_text in nodes:
                price = parse_price(str(node_text))
                if price and price > 0:
                    results.append({
                        "device_id": device_id,
                        "storage": storage,
                        "condition_grade": grade,
                        "base_price": round(price),
                        "source": source_label,
                    })
                    break
        except Exception as e:
            print(f"  [WARN] Selector failed for {device_id}/{grade}: {e}", file=sys.stderr)

    return results


def main() -> int:
    ap = argparse.ArgumentParser(description="Scrape device prices for Tech Genius backend")
    ap.add_argument("--config", required=True, help="Path to scrape config JSON")
    ap.add_argument("--output", required=True, help="Output JSON file path")
    args = ap.parse_args()

    config_path = Path(args.config)
    if not config_path.exists():
        print(f"ERROR: Config not found: {config_path}", file=sys.stderr)
        return 1

    cfg = json.loads(config_path.read_text("utf-8"))
    entries = cfg.get("sources", [])

    if not entries:
        print("No sources in config. Nothing to scrape.", file=sys.stderr)
        Path(args.output).write_text("[]", "utf-8")
        return 0

    all_prices: List[Dict[str, Any]] = []
    print(f"Scraping {len(entries)} source entries...")

    for i, entry in enumerate(entries):
        print(f"  [{i+1}/{len(entries)}] {entry.get('device_id', '?')} from {entry.get('url', '?')[:60]}...")
        prices = scrape_source(entry)
        all_prices.extend(prices)
        if i < len(entries) - 1:
            time.sleep(1)

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(all_prices, indent=2), "utf-8")
    print(f"Done. Wrote {len(all_prices)} price points to {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
