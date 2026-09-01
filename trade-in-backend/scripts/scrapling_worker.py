#!/usr/bin/env python3
"""
Scrapling worker — JSON-over-stdio protocol.

Input (stdin, one JSON object):
  {
    "provider": "gorecell",
    "devices": [
      {
        "productId": "iphone-15",
        "make": "Apple",
        "model": "iPhone 15",
        "variant": "128GB",
        "url": "https://...",
        "selectors": { "excellent": "...", "good": "..." }
      }
    ],
    "timeoutSec": 30
  }

Output (stdout, one JSON object):
  { "provider", "engine":"scrapling", "rows":[ScrapedPrice...], "errors":[], "durationMs", "targeted", "discovered" }
"""

from __future__ import annotations

import json
import re
import sys
import time
from typing import Any, Dict, List, Optional

try:
    from scrapling.fetchers import Fetcher
except ImportError:
    print(json.dumps({
        "provider": "scrapling",
        "engine": "scrapling",
        "rows": [],
        "errors": ["scrapling not installed"],
        "durationMs": 0,
        "targeted": 0,
        "discovered": 0,
    }))
    raise SystemExit(0)


COND_MAP = {
    "flawless": "excellent",
    "excellent": "excellent",
    "like-new": "excellent",
    "good": "good",
    "average": "fair",
    "fair": "fair",
    "cracked": "fair",
    "defective": "broken",
    "broken": "broken",
    "poor": "broken",
}


def parse_price(text: str) -> Optional[float]:
    if not text:
        return None
    m = re.search(r"\$?\s*(\d[\d,]*(?:\.\d{1,2})?)", text.replace("\xa0", " "))
    if not m:
        return None
    try:
        return float(m.group(1).replace(",", ""))
    except Exception:
        return None


def normalize_condition(raw: str) -> Optional[str]:
    return COND_MAP.get(raw.strip().lower())


def scrape_one(device: Dict[str, Any], timeout: int, provider: str) -> List[Dict[str, Any]]:
    url = device.get("url")
    if not url:
        return []
    rows: List[Dict[str, Any]] = []
    page = Fetcher.get(url, stealthy_headers=True, timeout=timeout)
    selectors = device.get("selectors") or {}
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    for cond_raw, selector in selectors.items():
        cond = normalize_condition(str(cond_raw))
        if not cond or not selector:
            continue
        price = None
        for sel in str(selector).split(","):
            sel = sel.strip().replace("::text", "")
            try:
                nodes = page.css(sel)
                texts = nodes.getall() if hasattr(nodes, "getall") else [str(nodes)]
                for t in texts:
                    price = parse_price(str(t))
                    if price:
                        break
            except Exception:
                continue
            if price:
                break
        if not price:
            continue
        rows.append({
            "competitor_name": provider,
            "make": device.get("make") or "Unknown",
            "model": device.get("model") or device.get("productId") or "Unknown",
            "product_id": device.get("productId"),
            "variant": device.get("variant") or "default",
            "condition": cond,
            "trade_in_price": price,
            "sell_price": None,
            "currency": "CAD",
            "raw": {"source": url, "engine": "scrapling", "payload": {"selector": selector}},
            "scraped_at": now,
        })
    return rows


def main() -> int:
    started = time.time()
    try:
        payload = json.load(sys.stdin)
    except Exception as e:
        print(json.dumps({
            "provider": "scrapling",
            "engine": "scrapling",
            "rows": [],
            "errors": [f"invalid stdin json: {e}"],
            "durationMs": 0,
            "targeted": 0,
            "discovered": 0,
        }))
        return 0

    provider = str(payload.get("provider") or "scrapling")
    devices = payload.get("devices") or []
    timeout = int(payload.get("timeoutSec") or 30)
    rows: List[Dict[str, Any]] = []
    errors: List[str] = []
    targeted = 0

    for d in devices:
        if not isinstance(d, dict):
            continue
        if not d.get("url"):
            continue
        targeted += 1
        try:
            rows.extend(scrape_one(d, timeout, provider))
        except Exception as e:
            errors.append(f"{provider}: {e} @ {d.get('url')}")
        time.sleep(0.5)

    print(json.dumps({
        "provider": provider,
        "engine": "scrapling",
        "rows": rows,
        "errors": errors,
        "durationMs": int((time.time() - started) * 1000),
        "targeted": targeted,
        "discovered": len(rows),
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
