# Steps we made — clean chronological log

**Project:** Tech Genius Burlington Trade-In (Reusely-style replica)  
**Branch:** `cursor/tech-genius-trade-in-b397`  
**Date of this log:** 2026-08-11  

Each step is a real milestone from the build. No fluff.

---

## Goal (always)

Ship a store-owned trade-in system that:

- Quotes customers fairly using live competitor data (beat GoRecell by default)
- Runs buyback ops like Reusely (offers, inventory, invoices, payouts, team)
- Embeds on shoptechgenius.ca (Shopify) / Framer
- Never pretends email/CRM succeeded without real webhooks

---

## Steps

### 1. Customer sell widget foundation
Built React trade-in flow: category → device → details → condition → offer → checkout → done.

### 2. Real product photos
Replaced placeholder shapes with real device images; bundled critical photos into the embed so Framer/Shopify always show devices.

### 3. Hosting packs
Documented and packed Framer upload, Shopify CDN, and Netlify permanent hosting options for shoptechgenius.ca.

### 4. Pricing engine + CRM outbox
Added independent pricing engine and Twenty CRM outbox mapping (queue events; send only when webhook configured).

### 5. Full backend (Reusely replacement core)
Express + SQLite: catalog, prices, offers, customers, inventory, scraper hooks, API key auth, public `/api/quote`.

### 6. Catalog seed + TechAPI import
Seeded devices/brands/categories/prices; Scrapling TechAPI importer; static `/devices` image hosting.

### 7. Admin panel + login
Reusely-style admin UI wired to backend; email/password admin auth.

### 8. Dual-engine scrapers + training
Scrapling dual-mode pipeline; self-learning / training hooks for pricing baselines.

### 9. Live competitor scrapers
Adapters for **GoRecell**, **UniverCell**, **Bell**, **TELUS**; admin Pricing page to compare and choose source.

### 10. GoRecell deep fix + full sync
Fixed GoRecell live price read via product-page `query_data`; full-catalog per-storage sync + weekly scrape.

### 11. Grade system
Tech Genius grade names; water-damage locks to As-Is / defective path.

### 12. Security + UI polish
Hardened production paths; fixed build errors; cleaned admin navigation.

### 13. Ops modules closed
Notifications, global search, dashboard KPIs, RBAC (admin/manager/operator), invoices, payouts board, bulk quote, walk-in hand-off, shipping label HTML, uploads, customer portal.

### 14. Pricing perfection
- Map GoRecell **Cracked** → store **fair** (not collapsed into average incorrectly)
- Storage aliases `1TB` ↔ `1024GB`
- Beat −2% on catalog display + quotes
- Promo expiry / max uses
- Store-credit +5% boost
- FE/BE alignment so quotes match what admin expects

### 15. Device-by-name SaaS bootstrap
If a model is missing, staff/widget can add by name; `build_device_image.py` creates a product image automatically.

### 16. Multi-angle AI vision
Guided front / back / left / right photos → structured issues → grade; stored on offers; shown in admin Offer Detail.

### 17. Multi-tenant SaaS
Organizations, stores, org settings, `tg_live_…` API keys, `/admin/signup`, public `GET /api/saas/widget-config?org=slug`, branding colors.

### 18. Image audit (analysis complete)
Found wrong shared images from overly broad backfill aliases (e.g. all Pixels → `pixel-9.png`, iPhone 12 TechAPI names with `(Apple iPhone 13,2)` → `iphone-13.png`).

### 19. Image repair (shipped)
Root cause was the device **id**, not the name: the slug flattens `(Apple iPhone 13,2)` into `…-apple-iphone-132`, so all 27 iPhone 12 SKUs matched `iphone.?13` even after the name's parenthetical was stripped.

- Stems are now derived from each device's own model name, so two different models cannot resolve to the same file by construction.
- Cross-model "sibling" fallbacks and catch-all aliases removed. A model with no photo gets a per-slug silhouette labelled with its real name — never another handset.
- The backfill enforces the rule (first model to claim a stem owns it) and prunes silhouettes a real photo has replaced.
- Frontend stopped substituting `iphone-15.png` on image error, in both admin and the widget.
- `npm run images:audit` now reports **0 cross-model collisions** across 544 devices; `npm run test:images` locks the resolver behaviour.

### 20. Selectable frontend templates (shipped)
`frontend_template` setting mirrored after `frontend_price_source`: admin picker in Settings, per-org override, public `GET /api/widget/template`, `data-template` skins in `templates.css`, `?tg_template=` preview. Seven first-party presets — no competitor CSS shipped.

### 21. Ops polish
Invoices and Payouts now honour the store selector like Offers and Inventory; dead invoice-print helper removed; missing `angle` field type fixed (it was breaking `npm run build`).

### 22. Catalog de-duplication (shipped)
The TechAPI import stacked regional SKUs on top of the seeded marketing names — 13 rows for "iPhone 12" alone. Each row had its own price table, and the TechAPI rows held *retail* prices, so the wrong tile quoted **$773** where the right one said **$245**. 60 storage slots were over-quoting 3-4x.

544 enabled rows -> **419, one per model**. Canonical = the row offers reference / the pricing engine targets / the cleanest name. Duplicates are disabled rather than deleted, so history and scraper mappings survive and it reverses with one UPDATE. Price gaps on the canonical are filled only from trusted sources and never above 2x its own grade price (72 fills refused, 88 accepted).

### 23. Retired devices made unquotable (shipped)
`/api/quote` and `/api/widget/submit` are public and take a device_id, and the quote engine never checked `enabled` — so hiding a tile did not stop a retired row being priced at $758. Guarded at the one shared choke point in `quoteEngine.ts`.

### 24. Framer /sell embed made deployable (shipped)
- API origin now resolved at **runtime** (`data-api` / `data-org` / `window.TG_TRADE_IN_API`) — one built file works on any host, no rebuild.
- Lite bundle: **9.9 MB -> 388 KB** (photos load from the API's /devices, which runs anyway).
- Fixed 12 hardcoded `/devices/...` paths that resolved against the host page and 404'd on techgenius.ca.
- Replaced 14 dead jsdelivr CDN images (all 404) with per-slug silhouettes.
- Hid the placeholder `"default"` storage chip shown on 24% of the catalog.
- Verified in a browser from a different origin: 200 tiles, 0 duplicates, 0 broken images, 0 failed requests, 0 console errors.
- Deliverables: `~/Downloads/TechGenius-Framer-Sell/`.

---

## Current system status

| Area | Status |
|------|--------|
| Customer widget + quotes | Working |
| Admin ops (offers → inventory → invoice) | Working |
| Competitor scrape + frontend price source | Working |
| Multi-tenant orgs | Working |
| Multi-angle vision | Working |
| Device-by-name + auto image | Working |
| Perfect per-device unique images | Working (audit gate: 0 collisions) |
| One catalog row per model | Working (419 models, dedupe gate: 0 duplicates) |
| Framer /sell embed | Ready to mount — needs the backend on public HTTPS |
| Selectable UI templates (like price source) | Working |
| Live email / CRM / carrier APIs | Blocked on credentials |

---

## How to continue later

1. Unzip project on laptop (see `HOW_TO_SAVE_TO_LAPTOP.md`)
2. Read `PROJECT_MASTER_GUIDE.md`
3. Connect Shopify page + email/CRM webhooks for production — the remaining
   blockers are all ops-side (hosting, secrets, webhooks, carrier/payout rails)
4. After any catalog import: `npm run images:backfill && npm run images:audit`

End of step log.
