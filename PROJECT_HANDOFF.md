# TECH GENIUS TRADE-IN — COMPLETE PROJECT HANDOFF

**Document type:** Single handoff file (all information in one place)  
**Date:** 2026-08-11  
**Owner:** Sai Yaganti (`s.yaganti@student.fdu.edu`)  
**Branch:** `cursor/tech-genius-trade-in-b397`  
**Cloud agent:** https://cursor.com/agents/bc-019fafda-9feb-7864-8cfa-a4ebcd9bb397  
**Archive:** `TechGenius-TradeIn-FULL-PROJECT.zip` (~27 MB)  

If someone only reads **one file**, it should be this one.

---

# PART A — GOAL & PRODUCT

## A1. Project goal

Build a **complete Reusely-style trade-in / buyback operations system** for **Tech Genius Burlington** that:

1. Lets customers **sell devices for cash** via a website widget (Shopify / Framer embed).
2. Returns **server-authoritative offers** using competitor scrapes (default: beat GoRecell by ~2%).
3. Lets staff run **buyback ops** in an admin console: offers, walk-in hand-off, inventory, invoices, payouts, team RBAC, shipping labels, notifications, reports.
4. Supports **multi-tenant SaaS orgs** (white-label widget config + API keys).
5. Stays **honest** — no fake email/CRM success without webhooks; no client-inflated quote prices.

**Business sites**

| Site | Role |
|------|------|
| https://shoptechgenius.ca | Shopify store — intended live mount for sell page |
| https://techgenius.ca | Brand site (Framer) — can link to Shopify sell page |

**Verdict today:** **PARTIAL READY** for soft-launch after hosting + secrets + webhooks. Core buyback loop works with real SQLite data.

---

# PART B — WHAT EACH FOLDER / FILE IS

## B1. Top-level layout

```
/
├── PROJECT_HANDOFF.md                 ← THIS FILE (complete handoff)
├── PROJECT_MASTER_GUIDE.md            ← shorter goal + map + run guide
├── STEPS_WE_MADE.md                   ← chronological build steps
├── HOW_TO_SAVE_TO_LAPTOP.md           ← download / unzip instructions
├── README.md                          ← short index
├── REUSELY_REPLICA_REPORT.md          ← feature matrix vs Reusely
├── PRODUCTION_AUDIT_REPORT.md         ← production readiness audit
├── TechGenius-TradeIn-FULL-PROJECT.zip← laptop backup archive
├── trade-in-platform/                 ← FRONTEND (React / Vite)
└── trade-in-backend/                  ← BACKEND (Express / SQLite)
```

## B2. Frontend — `trade-in-platform/` (all important files)

### Config / build
| File | Purpose |
|------|---------|
| `package.json` | Scripts: `dev`, `build`, `build:embed`, `test`, `lint` |
| `vite.config.ts` | Local app + admin build |
| `vite.embed.config.ts` | Shopify/Framer embed bundle (`tg-trade-in.js`) |
| `index.html` | App entry HTML |
| `tsconfig*.json` | TypeScript configs |

### Customer widget (`src/`)
| File / folder | Purpose |
|---------------|---------|
| `App.tsx` | Local preview shell (header + TradeInFlow + TrackOffer) |
| `embed.ts` / `shopifyEmbed.tsx` | Embed entry points |
| `components/TradeInFlow.tsx` | Main sell wizard |
| `components/CategoryStep.tsx` | Step: category |
| `components/DevicePickStep.tsx` | Step: search/select device (+ bootstrap missing device) |
| `components/DetailsStep.tsx` | Step: storage / carrier |
| `components/ValuationStep.tsx` | Step: condition questions |
| `components/MediaAiStep.tsx` | Step: multi-angle photos + local vision |
| `components/GradeStep.tsx` | Step: grade |
| `components/OfferStep.tsx` | Step: cash offer display |
| `components/CheckoutStep.tsx` | Step: contact + submit |
| `components/DoneStep.tsx` | Step: confirmation |
| `components/TrackOffer.tsx` | Customer offer tracking / portal |
| `components/TradeInProgress.tsx` | Progress UI |
| `lib/tradeInApi.ts` | API client (catalog, quote, submit, ensure-device) |
| `lib/tradeInTypes.ts` | Steps, media, vision types |
| `lib/pricingBackend.ts` | Client estimate helpers |
| `lib/offers.ts` / `lib/twenty.ts` | Local offer save + CRM outbox mapping |
| `lib/localVision/` | On-device CV issue detection |
| `hooks/useCatalog.ts` | Loads devices from API |
| `data/catalog.ts` | Offline fallback catalog only |
| `data/deviceImages.ts` | Image resolution helpers |
| `data/deviceImageBundles.ts` | Inlined PNGs for embed |
| `tokens.css` / `AppShell.css` / `*Step.css` | Design tokens + styles |
| `public/devices/` | ~400 product image files |

### Admin (`src/admin/`)
| File | Purpose |
|------|---------|
| `api.ts` | Admin fetch + session + `deviceImgSrc` |
| `pages/DashboardPage.tsx` | Pipeline KPIs |
| `pages/OffersPage.tsx` / `OfferDetailPage.tsx` | Offer list + detail (vision, labels, uploads) |
| `pages/CustomersPage.tsx` | Customers |
| `pages/CatalogPage.tsx` | Devices + build-from-name |
| `pages/PricingPage.tsx` | Competitor prices + frontend price source |
| `pages/InventoryPage.tsx` | Inventory + sell |
| `pages/InvoicesPage.tsx` | Invoices |
| `pages/PayoutsPage.tsx` | Payouts board |
| `pages/BulkHandoffPage.tsx` | Walk-in / bulk quote-offer |
| `pages/ShippingPage.tsx` | Shipping labels |
| `pages/TeamPage.tsx` | RBAC users |
| `pages/ReportsPage.tsx` | Reports |
| `pages/SettingsPage.tsx` | Company, promos, branding, org keys |

### Integration docs (frontend)
| File | Purpose |
|------|---------|
| `CONNECT_SHOPTECHGENIUS.md` | Mount on shoptechgenius.ca |
| `INTEGRATE_SHOPIFY.md` | Shopify theme embed |
| `INTEGRATE_FRAMER.md` | Framer component / iframe |
| `TRADEIN_CHECKLIST.md` | QA checklist |
| `AUDIT_COMPETITORS.md` / `BETTER_THAN_COMPETITORS.md` | Competitor UX notes |
| `framer/` / `framer-upload/` / `shopify/` | Hosting packs / Liquid / templates |

## B3. Backend — `trade-in-backend/` (all important files)

### Config / data
| File | Purpose |
|------|---------|
| `package.json` | `dev`, migrate, scrape, cron helpers |
| `src/server.ts` | Express entry; mounts public + protected routes |
| `src/db/schema.ts` | SQLite schema + default settings seed |
| `src/db/migrate.ts` | Migrations |
| `src/db/seed.ts` | Catalog seed |
| `data/tradein.db` | **Live database** (devices, prices, offers, orgs…) |
| `config/scrape.json` | Scraper config |
| `config/seed_catalog.json` / `techapi_catalog_import.json` | Import configs |
| `config/pricing-engine.json` | Pricing engine config |

### Routes (`src/routes/`)
| File | Purpose |
|------|---------|
| `widget.ts` | Public submit, portal, ensure-device, media upload |
| `catalog.ts` | Categories, brands, devices, from-name |
| `pricing.ts` | Prices, adjustments, competitors, frontend-source, quote |
| `offers.ts` | Admin offers + hand-off + shipping label |
| `customers.ts` | Customers |
| `inventory.ts` | Inventory + sell instantly |
| `invoices.ts` | Invoices |
| `payouts.ts` | Payouts |
| `bulk.ts` | Bulk quote / bulk offer |
| `auth.ts` | Login / logout / me |
| `saas.ts` | Signup, widget-config, org settings/keys/stores |
| `settings.ts` | Global settings, workflow, promos |
| `scraper.ts` | Run live scrapers |
| `cron.ts` | Weekly scrape / catalog sync / train |
| `dashboard.ts` / `reports.ts` / `search.ts` / `notifications.ts` | Ops APIs |
| `team.ts` | Staff RBAC |
| `uploads.ts` / `integrations.ts` | Files + integrations |

### Services (`src/services/`)
| File | Purpose |
|------|---------|
| `quoteEngine.ts` | **Authoritative** quote math |
| `competitorPricing.ts` | Frontend price source match/beat |
| `catalogPriceSync.ts` | GoRecell full-catalog price sync |
| `tenancy.ts` | Orgs, keys, public widget config |
| `deviceBootstrap.ts` | Device-by-name create + image |
| `scraper.ts` | Scrape orchestration |
| `email.ts` / `crmWebhook.ts` / `notifications.ts` | Outbox (blocked without webhooks) |

### Pricing engine (`src/pricing-engine/`)
| Path | Purpose |
|------|---------|
| `adapters/` | GoRecell, UniverCell, Bell, TELUS scrapers |
| `scrapling/` | Dual-engine scrape helpers |
| `training/` | Baseline training |
| `deviceMatch.ts` | Match scraped products → catalog IDs |

### Scripts
| File | Purpose |
|------|---------|
| `scripts/build_device_image.py` | Auto product image from name |
| `scripts/backfill_device_images.py` | Map DB devices → `/devices` files |
| `scripts/scrapling_worker.py` | Python scrape worker |
| `scripts/sync_gorecell_catalog_prices.ts` | Full catalog price sync CLI |
| `scripts/ensure_device_from_name.ts` | CLI device bootstrap |

---

# PART C — HOW THE SYSTEM WORKS

## C1. Customer flow

1. Open sell page → `TradeInFlow`
2. Category → brand/search → device image grid
3. Storage + carrier + condition answers
4. Optional multi-angle photos (front/back/left/right) → local vision issues → grade hint
5. `POST /api/quote` → server returns cash offer (uses frontend price source settings)
6. Checkout → `POST /api/widget/submit` (server **re-quotes**; ignores client price attacks)
7. Track via portal with email unlock

## C2. Admin ops flow

1. Login `/admin`
2. Offers pipeline (status moves)
3. Walk-in: Bulk/Hand-off → optional shipping label → complete → invoice + inventory
4. Sell Instantly from inventory
5. Pricing: scrape competitors → choose source frontend reflects → optional beat %
6. Catalog: edit devices / build missing device from name
7. Team: admin / manager / operator capabilities

## C3. Pricing truth (critical)

Settings in SQLite `settings` table:

| Key | Typical value | Meaning |
|-----|---------------|---------|
| `frontend_price_source` | `gorecell` | Which competitor quotes reflect |
| `frontend_price_mode` | `beat` | `match` or `beat` |
| `frontend_beat_percent` | `2` | Undercut % when mode=beat |

Also: storage alias `1TB` ↔ `1024GB`; GoRecell **Cracked** maps to store **fair**; store-credit payout can get +5% boost.

Customers **never** see competitor names/prices — only Tech Genius offer.

---

# PART D — CREDENTIALS & ENV (DEV)

## D1. Local defaults

| Item | Value |
|------|--------|
| Backend URL | `http://127.0.0.1:4100` |
| Admin email | `admin@techgenius.ca` |
| Admin password | `TechGenius2026!` |
| Manager | `manager@techgenius.ca` / `Manager2026!` |
| Operator | `operator@techgenius.ca` / `Operator2026!` |
| Dev API key | `tg-dev-key-2026` |
| Cron secret (dev) | often same as API key unless `TG_CRON_SECRET` set |

## D2. Production environment variables

```bash
NODE_ENV=production
TG_API_KEY=…                 # required in production
TG_ADMIN_PASSWORD=…          # required in production
TG_CRON_SECRET=…             # required for cron routes
TG_REQUIRE_SECRETS=1         # optional force
TG_CORS_ORIGINS=https://shoptechgenius.ca,https://…
TG_EMAIL_WEBHOOK=https://…   # optional live email
TG_EMAIL_WEBHOOK_TOKEN=…
TG_CRM_WEBHOOK_URL=https://… # optional Twenty/CRM
TG_CRM_WEBHOOK_TOKEN=…
TG_TRUST_PROXY=1             # if behind reverse proxy
TG_DB_PATH=/data/tradein.db  # REQUIRED on hosted deploys — see below
VITE_TRADE_IN_API_URL=https://YOUR_API_HOST
```

**`TG_DB_PATH` is the one that silently loses data if you skip it.** It defaults
to `data/tradein.db` inside the repo, which on a hosted platform lives in the
container image rather than on the mounted volume. The app runs, takes offers,
and looks healthy — then the next deploy replaces the container and every offer,
customer, and price row is gone with it. Point it at the volume mount, then
redeploy once and confirm an existing offer is still there.

`GET /api/health` reports `checks.database` and answers **503** when the
database is unreachable, so point your uptime monitor at it: a plain 200 check
against a static endpoint would stay green through exactly that failure.

Without email/CRM webhooks, outbox events stay **blocked** (honest — not fake-success).

---

# PART E — API CHEAT SHEET

## Public (no API key)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | Health |
| GET | `/api/catalog/categories` | Categories |
| GET | `/api/catalog/brands` | Brands |
| GET | `/api/catalog/devices` | Devices (+ prices) |
| POST | `/api/catalog/devices/from-name` | Bootstrap device (may be keyed depending on route wiring) |
| POST | `/api/quote` | Authoritative quote |
| POST | `/api/widget/submit` | Create offer |
| POST | `/api/widget/ensure-device` | Add missing device by name |
| POST | `/api/widget/portal` | Customer portal unlock |
| GET | `/api/widget/template[?org=slug]` | Frontend template the widget renders with |
| GET | `/api/saas/widget-config?org=slug` | White-label config (includes `template`) |

## Admin (API key / session + capabilities)
| Area | Base path |
|------|-----------|
| Offers | `/api/offers` |
| Pricing / competitors / frontend-source | `/api/pricing` |
| Inventory / invoices / payouts | `/api/inventory`, `/api/invoices`, `/api/payouts` |
| Bulk | `/api/bulk` |
| Scraper | `/api/scraper/run-live` |
| Settings / team / reports | `/api/settings`, `/api/team`, `/api/reports` |
| Storefront template | `GET`/`PUT /api/settings/widget-template` |
| SaaS org | `/api/saas/org*` |

## Cron
| Path | Purpose |
|------|---------|
| `POST /api/cron/scrape` | Live scrape |
| `POST /api/cron/sync-catalog` | GoRecell catalog prices |
| `POST /api/cron/weekly` | Combined weekly job |
| `POST /api/cron/train` | Pricing train |

Header: `x-cron-secret: …`

---

# PART F — RUN ON LAPTOP (NO ERRORS CHECKLIST)

## Prerequisites
- Node.js **20+**
- npm
- Python **3.10+** (image build / scrapers)
- Optional: Playwright browsers for live scrapes

## Install & start

```bash
# 1) Unzip archive
unzip TechGenius-TradeIn-FULL-PROJECT.zip -d TechGenius-TradeIn
cd TechGenius-TradeIn

# 2) Backend
cd trade-in-backend
npm install
npm run db:migrate
npm run dev
# → http://127.0.0.1:4100

# 3) Frontend (new terminal)
cd ../trade-in-platform
npm install
# optional:
# export VITE_TRADE_IN_API_URL=http://127.0.0.1:4100
npm run dev
```

## Verify

```bash
curl http://127.0.0.1:4100/api/health
# expect: {"status":"ok", ...}
```

Open Vite URL → widget.  
Open `/admin` → login with admin credentials above.

## Embed build (Shopify)

```bash
cd trade-in-platform
npm run build:embed
```

Follow `CONNECT_SHOPTECHGENIUS.md` to upload assets and paste into `/pages/sell-my-device`.

---

# PART G — STEPS WE MADE (CHRONOLOGICAL)

1. Customer sell widget foundation (multi-step React flow)
2. Real product photos + image-first device pick
3. Bundle photos into Framer/Shopify embed
4. Framer / Shopify / Netlify hosting packs + docs
5. Independent pricing engine + Twenty CRM outbox mapping
6. Full Express + SQLite backend (catalog, offers, inventory, auth)
7. Public quote + API keys + scraper hooks
8. Catalog seed + TechAPI import + `/devices` static serving
9. Admin panel + email/password login
10. Scrapling dual-engine + training
11. Live scrapers: GoRecell, UniverCell, Bell, TELUS
12. GoRecell `query_data` fix + full per-storage catalog sync + weekly job
13. Tech Genius grade names + water-damage As-Is lock
14. Security hardening (server re-quote, production secret exit, CORS options)
15. Ops modules: notifications, search, KPIs, RBAC, invoices, payouts, bulk/hand-off, shipping HTML, uploads, portal
16. Pricing perfection (cracked→fair, 1TB alias, beat −2%, promos, store-credit boost)
17. Device-by-name bootstrap + `build_device_image.py`
18. Multi-angle vision → structured issues → grade on offers
19. Multi-tenant SaaS (orgs, stores, settings, `tg_live_…` keys, widget-config)
20. Docs for laptop backup + this complete handoff file
21. Strict per-device image repair **shipped** — resolver rewritten, catalog repaired, audit script + regression tests added (see PART I)
22. Selectable frontend templates **shipped** — `frontend_template` setting, admin picker, `data-template` skins (see PART J)
23. Store scoping completed on Invoices and Payouts; dead invoice-print helper removed; `angle` typing fix unblocked `npm run build`
24. Catalog de-duplicated — 544 rows → **419, one per model** (see PART N). Fixed a live over-quoting bug: duplicate rows carried TechAPI *retail* prices, so a shopper tapping the wrong iPhone 12 tile was quoted $773 instead of $245
25. Retired devices made unquotable — `/api/quote` and `/api/widget/submit` are public, so hiding a tile was not enough on its own
26. Framer `/sell` embed made deployable (see PART O): runtime `data-api` (no rebuild to change host), lite bundle 10 MB → **388 KB**, 14 dead CDN images replaced, placeholder `"default"` storage no longer shown to customers

---

# PART H — STATUS MATRIX (HONEST)

| Area | Status |
|------|--------|
| Customer widget + server quotes | ✅ Working |
| Admin offers → inventory → invoice | ✅ Working |
| Competitor scrape + frontend price source | ✅ Working |
| Multi-tenant orgs / widget branding | ✅ Working |
| Multi-angle vision | ✅ Working |
| Device-by-name + auto image | ✅ Working |
| Email delivery | ⚠️ Needs `TG_EMAIL_WEBHOOK` |
| CRM / Twenty | ⚠️ Needs `TG_CRM_WEBHOOK_URL` |
| Carrier label purchase APIs | ⚠️ Printable HTML only |
| Payout money movement | ⚠️ Status tracking only |
| Shopify / Framer live mount | 🚧 Needs staff hosting upload |
| Unique correct device images everywhere | ✅ Repaired — `npm run images:audit` reports 0 cross-model collisions |
| Frontend template picker (like price source) | ✅ Working — Admin → Settings → Storefront template |
| GitHub `origin` remote in cloud agent | ❌ Not configured — use zip download |

---

# PART I — DEVICE IMAGE REPAIR (DONE)

**The rule:** same model, different storage/region → *should* share one image.
Two genuinely different models → **must not**.

### What was wrong

| Shared URL | Rows | Cause |
|------------|-----:|-------|
| `/devices/iphone-13.png` | 27 | Device **ids** flatten `(Apple iPhone 13,2)` into `…-apple-iphone-132`, so every iPhone 12 SKU matched the `iphone.?13` alias. Stripping the parenthetical from the *name* alone never fixed it. |
| `/devices/ipad-mini-6.png` | 5 | catch-all `ipad.?mini` alias |
| `/devices/ipad-air-m2.png` | 4 | catch-all `ipad.?air` alias |
| `/devices/tab-s9.png` | 2 | Tab S10 FE fell back to a Tab S9 photo |
| `/devices/ipad-10.png`, `iphone-13-mini.png`, `pixel-tablet.png`, `watch6-classic.png`, `apple-iphone-xs.png` | 7 | cross-model "sibling" fallbacks |

### How it was fixed

- `scripts/image_aliases.py` rewritten. A device's image stem is now **derived
  from its own model name** (`derive_stems`), so two different models cannot
  produce the same stem by construction. Matching uses the display name only —
  the id carries no extra signal, only the flattened-parenthetical noise.
- **No cross-model fallbacks and no catch-alls.** The curated alias table now
  holds only alternative spellings of the *same* model (e.g. `iPad Air 11 (2024)`
  → `ipad-air-11-m2-2024`). A model with no photo gets a per-slug silhouette
  labelled with its real name, not last year's handset.
- `backfill_device_images.py` enforces the rule instead of trusting it: the
  first model to claim a stem owns it, and it prunes silhouettes that a real
  photo has since replaced.
- `build_device_image.py` (device-by-name bootstrap) is exact-model-only too, so
  a brand-new model gets a silhouette rather than a neighbouring generation.
- Frontend no longer substitutes `iphone-15.png` on image error. Admin uses
  `DeviceThumb` (initial-letter tile); the widget already did, and
  `deviceImage()` now returns `""` instead of a category stock photo.

### Current state

```
Enabled devices:            544
  on local /devices photo:  490
  on generated silhouette:   39
  on remote CDN photo:       15
CROSS-MODEL COLLISIONS:       0
MISSING IMAGE FILES:          0
```

### Keeping it fixed

```bash
cd trade-in-backend
npm run images:backfill   # re-run after any catalog import (idempotent)
npm run images:audit      # exits 1 on any cross-model collision
npm run test:images       # resolver regression tests
```

---

# PART J — SELECTABLE FRONTEND TEMPLATES (DONE)

Mirrors `frontend_price_source`: one server-side setting, chosen in admin, read
by the widget at runtime.

| Piece | Where |
|-------|-------|
| Setting | `settings.frontend_template` (default `techgenius`); per-org override in `org_settings.widget_template` |
| Service | `trade-in-backend/src/services/widgetTemplate.ts` |
| Admin UI | Settings → **Storefront template** (`GET`/`PUT /api/settings/widget-template`) |
| Public read | `GET /api/widget/template[?org=slug]`; also on `GET /api/saas/widget-config` |
| Widget | `useWidgetTemplate()` → `data-template` on `.trade-in-embed` |
| Skins | `trade-in-platform/src/templates.css` |

Templates: `techgenius` (default), `gorecell_step`, `univercell_sell`,
`bell_trade`, `telus_trade`, `reusely_ops`, `minimal`.

**First-party only.** No competitor CSS, markup, font, asset or logo is shipped.
Each template only re-points design tokens and a few layout knobs, so markup,
accessibility and server-authoritative pricing are identical across all of them.
The ids are the ones this spec originally used; the admin labels describe the
*layout* a store owner is picking (e.g. `bell_trade` → "Carrier blue").

Preview one without switching the live store: append `?tg_template=<id>` to the
sell page URL. Unknown ids fall through to the default rather than erroring.

To add a template: add an entry in `widgetTemplate.ts` and a matching
`[data-template="…"]` block in `templates.css`.

---

# PART K — RELATED DOCS INDEX

| File | When to open |
|------|----------------|
| **PROJECT_HANDOFF.md** | Full handoff (this file) |
| PROJECT_MASTER_GUIDE.md | Shorter day-to-day reference |
| STEPS_WE_MADE.md | Build history only |
| HOW_TO_SAVE_TO_LAPTOP.md | Download zip steps |
| REUSELY_REPLICA_REPORT.md | Feature pass/fail vs Reusely |
| PRODUCTION_AUDIT_REPORT.md | Security + production blockers |
| trade-in-platform/CONNECT_SHOPTECHGENIUS.md | Live Shopify mount |
| trade-in-platform/TRADEIN_CHECKLIST.md | Manual QA |

---

# PART L — HANDOFF ACCEPTANCE CHECKLIST

New owner should be able to:

- [ ] Unzip project and run backend + frontend locally
- [ ] Hit `/api/health` successfully
- [ ] Log into `/admin` with seeded admin
- [ ] Submit a widget offer and see it in Offers
- [ ] Open Pricing and understand frontend price source
- [ ] Run (or understand) live competitor scrape
- [ ] Explain quote is server-authoritative
- [ ] Know which env vars are required for production
- [ ] Run `npm run images:audit` and see 0 cross-model collisions
- [ ] Switch the storefront template in Settings and see the widget change
- [ ] Know the remaining blockers are ops-side: hosting, email/CRM webhooks,
      carrier label APIs, payout rails (PART H)
- [ ] Download `TechGenius-TradeIn-FULL-PROJECT.zip` as backup

---

# PART M — CONTACT / AGENT

- **Owner:** Sai Yaganti  
- **Agent run URL:** https://cursor.com/agents/bc-019fafda-9feb-7864-8cfa-a4ebcd9bb397  
- **Branch:** `cursor/tech-genius-trade-in-b397`  
- **Backup zip:** `/agent/TechGenius-TradeIn-FULL-PROJECT.zip`  

---

*End of complete project handoff. This file is intentionally self-contained.*

---

# PART N — CATALOG DE-DUPLICATION (DONE)

The TechAPI import layered regional SKUs on top of the seeded marketing names,
so one handset appeared many times: 13 rows for "iPhone 12", 12 for "iPhone 12
Pro", 11 for "Pixel 10 Pro".

**This was a pricing bug, not just clutter.** Each duplicate row carried its own
price table, and the TechAPI rows were seeded with *retail* prices:

| Row | Source | Flawless 128GB |
|-----|--------|---------------:|
| `iphone-12` (kept) | data-driven-baseline | **$250** |
| `apple-iphone-12` | gorecell | $205 |
| `apple-iphone-12-6gb-128gb-5g` | techapi-import | **$773** |

60 storage slots quoted 3–4× the correct number. Which tile the shopper tapped
decided their offer.

**Result:** 544 enabled rows → **419, one per model.**

### How a canonical row is chosen

In order: rows referenced by an existing offer → rows the pricing engine knows
(`price_baselines.product_id`, because `catalogPriceSync` only refreshes
`enabled = 1` rows) → cleanest name → most/most-recent prices → real photo over
silhouette → id, for determinism.

### Safety

- Duplicates are **disabled (`enabled = 0`), not deleted** — the same way this
  codebase already retires junk rows. Offer history keeps resolving, scraper
  device-id mappings survive, and reversing it is one `UPDATE`.
- Price gaps on the canonical are filled from duplicates, but **never
  overwritten**, never from `techapi-import`, and never above 2× what the
  canonical already charges for that grade. 72 fills were refused on those
  grounds; 88 were accepted.
- Conflicts it did not resolve are printed for staff review.
- `--dry-run` is the default.

### Commands

```bash
cd trade-in-backend
npm run catalog:dedupe         # preview
npm run catalog:dedupe:apply   # commit
npm run test:quote-guard       # retired devices must not be priceable
```

### Related fix: retired devices were still quotable

`/api/quote` and `/api/widget/submit` are public and take a `device_id`, and the
quote engine never checked `enabled`. Hiding a tile therefore did not stop
anyone holding the id from being quoted $758 off a retired row. `quoteEngine.ts`
now refuses non-enabled devices at the single shared choke point, so every
caller (widget, bulk, offers, admin) inherits it.

---

# PART O — FRAMER `/sell` EMBED (READY TO MOUNT)

Deliverables are in **`~/Downloads/TechGenius-Framer-Sell/`**:
`tg-trade-in.js`, `tg-trade-in.css`, `FRAMER_SETUP.md`, `FRAMER_PROMPT.txt`,
`framer-embed.html`, `TechGeniusTradeIn.tsx`.

`techgenius.ca/sell` currently has the hero and three steps but **no wizard**.
This mounts the wizard beneath them.

### What changed to make it mountable

| Problem | Fix |
|---------|-----|
| API origin baked in at build time — a rebuild for every host change | Resolved at **runtime**: `data-api` on the mount div, `data-org` for tenancy, or `window.TG_TRADE_IN_API`. One built file works anywhere. |
| Bundle 9.9 MB (every product photo inlined as a data: URI) | `npm run build:embed:lite` → **388 KB** (125 KB gzip). Photos load from the API's `/devices`, which is running anyway since prices are server-side. |
| 12 hardcoded `/devices/…` paths resolved against the **host page**, so category and brand tiles 404'd on techgenius.ca | `assetUrl()` resolves them against the API origin. |
| 14 devices pointed at jsdelivr URLs that return **404** | `images:backfill --check-remote` verifies remote URLs and replaces dead ones with per-slug silhouettes. Catalog is now 0 remote / 0 broken. |
| 100 devices (24%) showed a storage chip literally labelled `"default"` | The picker is hidden when the only tier is the placeholder; the value still goes to the server so quotes are unchanged. `displayStorage()` keeps it out of every customer-facing string. |

### Verified

Built lite bundle served from a **different origin** than the API, driven in a
real browser: widget mounts, 200 device tiles, **0 duplicate names, 0 broken
images, 0 failed requests, 0 console errors**, quote flow reaches the details
step, and both the real-capacity and placeholder-storage paths complete.

### The one remaining prerequisite

The backend must be deployed to public HTTPS with `TG_CORS_ORIGINS` including
`https://techgenius.ca` **and** `https://www.techgenius.ca`. Framer runs on
Framer's servers; it cannot reach a laptop. Full steps in `FRAMER_SETUP.md`.

---

# PART P — PRICE INTEGRITY (DONE) + WHAT IS STILL OPEN

A catalog audit found contradictions that quote customers the wrong money.
`npm run audit:catalog` (price table) and `npm run audit:quotes` (what the
engine actually returns) both check for these; run them before any launch and
after every import or price sync.

### Fixed

| Defect | Was | Now |
|--------|----:|----:|
| Better condition quoted BELOW a worse one | **68** | **0** |
| Grade inversions in the `prices` table | 71 | 0 |
| Storage label split (`1024GB` vs `1TB` on one device, 2.8× apart) | 5 rows | 0 |
| De-dupe gap-fills breaking the storage ladder | 18 | 0 |

**The important lesson, and why the first repair was not enough.** Auditing and
cleaning the `prices` table looked like a fix, but quotes do not read that table
first: `resolveFrontendBasePrice` reads live `scraped_prices` and only falls back
to `prices` on a miss. A clean table still sat behind inverted quotes, and the
next scrape would have undone the repair anyway. The durable fix is
`resolveLadderCappedPrice` in `quoteEngine.ts`, which caps at **read time** — so
it holds for whichever source wins and survives future syncs.

`enforceGradeLadder` in `competitorPricing.ts` additionally clamps at sync time,
so stored data stops drifting.

Clamping always moves the **worse** grade **down**, never the better one up:
these are payouts, so when sources disagree the cheaper reading is the safe one.

### Still open — business calls, not bugs

1. **4 devices cannot be quoted** (no prices): Moto G Power, Moto G Stylus,
   MacBook Air 15" (2024), Mac Mini (2020). They are pickable, so a customer
   reaches a dead end. Either price them or disable them.
2. **RAM is modelled as storage on 54 laptops/computers.** `MacBook Pro 14" M5`
   lists `["4TB","2TB","1TB","32GB","24GB","16GB"]` — the last three are memory
   configs. The shopper sees them under "Storage capacity", and the scraped
   prices attached to them are RAM-tier prices, which is most of the 68
   remaining storage-ladder warnings. Needs a decision: do you buy back by SSD
   size, by RAM, or both as separate questions?
3. **68 storage-ladder warnings** — after removing the RAM artifact above, the
   rest are GoRecell's own prices disagreeing across capacities. A live sync
   against production data should settle them; they are upstream, not local.
4. **56 prices above a category-plausible ceiling** — mostly high-end MacBooks
   at $1.8k–2.6k, which are probably correct. Worth one human pass.

### Commands

```bash
npm run audit:catalog      # price-table health
npm run audit:quotes       # what customers are actually quoted (slower, ~45s)
npm run fix:prices         # preview repairs
npm run fix:prices:apply   # commit them (backs the DB up first)
```

---

# PART Q — GENERATED DEVICE IMAGES (REBUILT)

38 devices have no photograph and use a generated tile. The old generator
produced what was effectively a black rectangle — a white outline around a
near-black fill, identical for every model. In an image-first picker that reads
as a broken or dead device, which is the tile a shopper skips.

Two causes, both fixed:

1. **Font loading only checked three Linux paths.** On macOS every lookup fell
   through to `ImageFont.load_default()`, a fixed bitmap font that silently
   ignores the requested size — so labels were unreadable. Now covers
   macOS/Linux/Windows, with auto-shrink to fit the tile width.
2. **The drawing itself.** Now renders a lit screen with a brand-tinted
   wallpaper, a metallic bezel, a glass reflection, a floor shadow, and
   category-correct geometry (phone / tablet / watch with straps and crown /
   laptop with deck / console / headset). Colour comes from the **brand**
   (Google green, Samsung blue, Apple graphite) and shape from the category —
   previously both came from the category, so every phone looked identical and
   Galaxy watches were painted Google-green.

Files keep the `_silhouette-` prefix, so `npm run images:audit` can still tell a
real photograph from a generated stand-in, and each carries a "Photo coming
soon" badge rather than pretending to be a product shot.

---

# PART R — TWO THINGS REUSELY GETS WRONG THAT THIS NOW GETS RIGHT

Both started as data defects. Both were fixed as *guarantees* rather than
patches, so they cannot quietly come back.

## 1. Never offer a device you cannot buy

4 devices (Moto G Power, Moto G Stylus, MacBook Air 15" 2024, Mac Mini 2020)
were pickable but had no prices. A shopper chose one, answered every condition
question, and got an error instead of an offer.

`GET /api/catalog/devices` now excludes devices with no priced configuration.

Deliberately a **listing filter, not `enabled = 0`**: the price syncs only touch
enabled rows, so disabling would freeze a device out of pricing permanently.
This way the moment a sync gives it a price it returns to the catalog on its
own — self-healing rather than a list someone has to remember to revisit.

Admin passes `include_unquotable=1` and still sees all 419, so the hidden ones
are a visible to-do list rather than a silent disappearance. Customer catalog:
415. Admin: 419.

## 2. Ask a question the shopper can answer

The importer put memory configurations in the same field as drive capacities:

| Device | Stored `storages` |
|--------|-------------------|
| MacBook Pro 14" M5 | `["4TB","2TB","1TB","32GB","24GB","16GB"]` |
| Galaxy Book4 | `["16GB","8GB"]` — no drive sizes at all |

So the widget asked laptop sellers for **"Storage capacity: 16GB"**, and the
audits compared 16GB of RAM against 1TB of SSD as one ladder — which
manufactured **65 of the 68** storage-ladder warnings.

Now each value is labelled by what it is (`1TB SSD`, `32GB RAM`), and the
question adapts: *Storage capacity* for drives only, *Memory (RAM)* for memory
only, *Configuration* when a device lists both. The prices attached to each tier
are real scraped tiers and are untouched — only the labelling changed, so no
quote moved.

Both audits now compare within one spec axis at a time.

### Effect on the ladder warnings

| | before | after |
|---|---:|---:|
| Better condition quoted below a worse one | 68 | **0** |
| Bigger capacity quoted below a smaller one | 68 | **3** |

The remaining 3 are genuine GoRecell quirks worth a few dollars on old iPhones
(iPhone SE 2nd Gen, iPhone 7). They are upstream data, not a local defect, and a
live sync should settle them.

### Still a judgement call for the owner

A laptop's value depends on **both** RAM and SSD, but the price table keys on a
single tier, so the widget asks for one. The labelling makes that honest rather
than confusing, and staff confirm the configuration at hand-off anyway. Pricing
laptops on both axes at once would need a second price dimension — worth doing
if laptops become a meaningful share of intake.

## Also fixed here

Admin's catalog page fetched `/api/catalog/devices` as a bare relative path. The
dev server proxies `/api`, so it worked locally and would have 404'd in
production, where admin and the API sit on different origins. It now goes
through `apiUrl` like every other admin call.

---

# PART S — PUBLISHED CONDITIONS + TWO-SPEC LAPTOP PRICING

## Grading now matches the store's published conditions

The widget previously used invented grade names ("Pristine", "Great Shape",
"Noticeable Wear") and battery thresholds that did not match the store's own
sell/trade-in conditions. A customer read one thing on the site and was graded
by another. The published wording is now the source of truth.

| Internal key | Customer-facing | Why the key is unchanged |
|---|---|---|
| `flawless` | **Like New** | Keys map to the scraped GoRecell/UniverCell tiers. Renaming them would break every price lookup. |
| `good` | **Good** | |
| `average` | **Acceptable** | |
| `fair` | **Unacceptable** | |
| `defective` | **As-Is** | Not a published condition — see below. |

**Battery thresholds now follow the published text exactly:** 85%+ for Like New,
84%+ for Good, 83% or below is Acceptable. (Previously 90/85/80.)

**All four published conditions require no liquid damage and no iCloud lock or
blacklist.** A device failing any of those is therefore outside *every* published
condition, so it grades As-Is rather than being squeezed into a band it does not
meet. `isGradeLockedToDefective` enforces that, and the customer is told which
rule applied.

**New checklist question: "Unlocked Canadian model?"** Like New and Good both
require it; Acceptable only requires the device to work on Canadian networks. An
import can therefore still reach Good, but not Like New — it is not rejected,
just graded honestly.

`gradeDefinitions` in `data/catalog.ts` holds the published bullet points and is
what the customer reads on the grade step, so the criteria they see are the
criteria the code applies. Tests in `__tests__/tradein.test.ts` assert each
threshold and each disqualifier.

## Laptops are priced on both specs

A laptop's value depends on drive size **and** memory, but the importer put both
in one field, so the widget asked "Storage capacity: 16GB". It now asks two
questions — **Storage (SSD)** and **Memory (RAM)** — and both must be answered.

We hold a real scraped price for each tier separately, but never for a
combination. Rather than add them up and pay out a number no competitor ever
quoted, the quote uses the **limiting spec**: the cheaper of the two tiers.

```
MacBook Pro 14" M5 — flawless
             16GB     24GB     32GB
1TB         $1176    $1323    $1323
2TB         $1176    $1372    $1470
4TB         $1176    $1372    $1568
```

That is monotonic in both axes (raising either spec can only raise the offer)
and never exceeds a real quoted tier. `test:quote-guard` asserts both
properties. `offer_items.memory` records the configuration for hand-off, and
single-axis devices are completely unaffected.

---

# PART T — FULL-PLATFORM SWEEP + SCRAPER HEALTH

Every endpoint the console and widget call was exercised against the live
database, every admin page and control driven in a browser, and the customer
journey run start to finish. Repeatable gates:

```bash
cd trade-in-backend
npm run smoke:api          # 44 endpoint checks incl. the full buyback loop
npm run health:scrapers    # source freshness, coverage, end-to-end quote
npm run audit:quotes       # what customers are actually offered
npm run audit:catalog      # price-table contradictions
npm run images:audit       # one correct photo per model
npm run catalog:dedupe     # one row per model
npm run test:quote-guard   # retired devices unquotable; two-axis pricing sane
```

## Verified working on real data

- **44/44 endpoints.** Widget submit → received → inspected → completed →
  shipping label → auto-invoice → inventory. Portal unlock works; wrong email
  403s. Operator blocked from pricing and team; unkeyed requests 401.
- **13/13 admin pages** load with zero console errors and zero failed requests.
  ~70 controls clicked; none dead.
- **Customer journey** category → device → details → checklist → vision →
  grade → offer, ending on a real price with zero errors.
- **Price integrity end to end:** live GoRecell $470 → stored $470 → quoted
  **$479** for an unlocked 512GB iPhone 15 (beat 2%, +4% unlocked). The number
  on screen matches the server exactly.

## Scraper health

All four adapters were run live and independently spot-checked: UniverCell,
Bell, TELUS and GoRecell all return current prices matching the adapters.

Three real problems were found and fixed:

**1. A partial scrape could destroy good pricing.** `catalogPriceSync` deleted
every price row for any storage tier the latest GoRecell response happened not
to include — regardless of which source wrote it. One flaky page load could wipe
manual, baseline and seeded prices and strip those capacities off the device
permanently. The delete is now restricted to rows the sync itself owns
(`source LIKE 'gorecell%'`), and the tiers offered are recomputed from what is
actually priced afterwards, so a partial scrape narrows the picker only when a
tier genuinely has no price left.

**2. Silent staleness.** The weekly job's only failure handling was
`console.error`, and nothing surfaced how old the data was. A scrape that stops
looks identical to one that works — the prices are simply frozen.
`npm run health:scrapers` now reports per-source age, catalog coverage, and
whether the live quote source itself is stale, exiting non-zero when it matters.

**3. Three phantom price sources.** `tech-genius-local`, `local-market` and
`international-market` were seeded enabled but produced 0 rows on every recorded
run: the CSS-selector scraper meant to fill them targets GoRecell markup that
does not exist, because GoRecell serves prices as `query_data` JSON. They are
now seeded disabled, and `POST /api/scraper/run` answers 410 pointing at the
working endpoints rather than reporting success while importing nothing.

## Fake data removed from the customer path

`fallbackSourcePointsForQuote` invented market points — base price × fixed
factors, stamped `capturedAt: now`, under those same phantom source names — and
the widget fell back to a quote derived from them whenever the API call failed.
An outage therefore produced an invented cash offer that looked entirely real.

The offer now comes from the server or not at all: if the quote fails the
customer sees an honest "we couldn't price this right now" panel with a retry
and the shop's phone number. The helper is unreachable from any production path
and labelled accordingly.

Also fixed: the notification bell surfaced notifications whose offer no longer
existed, sending staff to a 404. It now only shows notifications whose offer is
still present.

## Known and accepted

- **3 storage-ladder warnings** — GoRecell's own prices disagreeing by $5–10
  across capacities on old iPhones. Upstream data, not a local defect.
- **4 devices hidden** from the customer catalog until priced (Moto G Power,
  Moto G Stylus, MacBook Air 15" 2024, Mac Mini 2020). Visible to staff via
  `include_unquotable=1`; they return automatically once a sync prices them.
- **Competitor coverage is uneven** — GoRecell covers 327 of 419 devices;
  UniverCell/Bell/TELUS only 12 each. Fine while GoRecell is the quote source,
  but switching `frontend_price_source` to one of the others would leave most of
  the catalog on the fallback table.

---

# PART U — EVERY GATE GREEN

| Gate | Result |
|------|--------|
| Backend / frontend typecheck | OK |
| Frontend tests | 37 passing |
| Lint | **0 warnings** |
| App build / embed build | OK |
| API smoke (real data) | **44 / 44** |
| Scraper health | **HEALTHY** |
| Quote guard | pass |
| Image resolver / audit | pass · 0 cross-model collisions |
| Catalog de-dupe | 0 duplicate models |
| Catalog health | **0 blocking, 0 suspect** |
| Effective quotes | **0 blocking, 0 unquotable** |

## The last three fixes

**Smaller capacity could out-quote a larger one.** GoRecell does not publish
every grade for every capacity, so the gaps are derived from that capacity's own
anchor — and nothing in that derivation can see sibling capacities. It listed no
"fair" 32GB iPhone 7, so ours came out at $6 against the genuine 128GB fair price
of $5. `storageCap` in `quoteEngine.ts` now clamps a smaller capacity down to the
smallest larger one, mirroring the grade ladder: it keeps the authoritative
number (the larger tier is real scraped data, the smaller inferred), cannot
overpay, and compares capacities only — 16GB of RAM is not a smaller 1TB drive.
Cost is ~14 ms per quote. Locked by `test:quote-guard`.

**Two lint warnings, fixed rather than silenced.** `AdminLayout` read `store`
inside a mount-once effect; it now uses a functional update, so switching
location no longer risks re-fetching the org. `OfferDetailPage` called a
non-memoised `load()`; it is now a `useCallback` keyed on `id`, so the effect
depends on it honestly instead of going stale when the route param changes.

**The catalog audit was crying wolf.** It reported 72 blocking issues while
customers were actually being quoted correctly, because it read the stored table
without accounting for the read-time caps, compared laptop RAM against SSD
capacity, and counted devices already hidden from the catalog. It now separates
what is broken (0) from what is merely inconsistent in storage but capped at
quote time (3), and its implausible-price ceilings are tuned above what a real
flagship fetches — a 2TB iPhone 17 Pro Max genuinely trades at ~$1300, so the
old $900 ceiling flagged 56 correct GoRecell prices and trained you to ignore
the report. Suspect prices: 0.

## Framer embed — verified on a foreign origin

Served from a different origin than the API, as Framer will: mounts, reads
`data-api`, loads category art and 198 device tiles from the API, runs the
published checklist and grading, handles the two-axis laptop flow, honours both
the server-set template and `?tg_template=` preview, and reaches a real server
offer. **0 HTTP failures, 0 console errors.**

`~/Downloads/TechGenius-Framer-Sell/` is rebuilt with all of the above.
