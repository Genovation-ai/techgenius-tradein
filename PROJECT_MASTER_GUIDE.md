# Tech Genius Trade-In Platform — Master Project Guide

**Last updated:** 2026-08-11  
**Branch:** `cursor/tech-genius-trade-in-b397`  
**Agent run:** https://cursor.com/agents/bc-019fafda-9feb-7864-8cfa-a4ebcd9bb397  
**Owner:** Sai Yaganti  

This file is the single clean reference for **what this project is**, **what each part does**, **every major step we built**, and **how to run it on your laptop**.

---

## 1. Goal of the project

Build a **complete Reusely-style trade-in / buyback operations system** for **Tech Genius Burlington**, so the store can:

1. Let customers **sell / trade in devices** on the website (widget embed on Shopify / Framer).
2. Give **server-authoritative cash offers** based on competitor scrapes (especially GoRecell), with an optional “beat competitor by X%” rule.
3. Run **day-to-day buyback ops** in an admin panel: offers, hand-off/walk-in, inventory, invoices, payouts, team roles, shipping labels, notifications, reports.
4. Stay **honest** — no fake success for email/CRM when webhooks are missing; no fake prices.

**Business target:** Replace / rival Reusely-style SaaS ops for a local shop, with Tech Genius branding, live competitor pricing, and a customer-facing sell flow.

---

## 2. What is what (project map)

```
/agent/
├── PROJECT_MASTER_GUIDE.md          ← this file (goal + steps + how to run)
├── HOW_TO_SAVE_TO_LAPTOP.md         ← download + unzip instructions
├── REUSELY_REPLICA_REPORT.md        ← feature verification vs Reusely
├── PRODUCTION_AUDIT_REPORT.md       ← production readiness audit
├── trade-in-platform/               ← FRONTEND (React / Vite)
└── trade-in-backend/                ← BACKEND (Express / SQLite)
```

### 2.1 Frontend — `trade-in-platform/`

| Path | What it is |
|------|------------|
| `src/components/TradeInFlow.tsx` | Main customer sell flow (category → device → grade → offer → checkout) |
| `src/components/*Step.tsx` | Individual steps (device pick, valuation, AI media scan, etc.) |
| `src/admin/` | Reusely-style admin UI (offers, catalog, pricing, settings, team…) |
| `src/lib/tradeInApi.ts` | Calls backend catalog, quote, widget submit |
| `src/lib/pricingBackend.ts` | Client-side quote helpers / snapshot meta |
| `src/data/catalog.ts` | Offline fallback catalog |
| `src/data/deviceImages.ts` | Device image resolution + bundles |
| `public/devices/` | Product photos (~400 files) served as `/devices/...` |
| `vite.embed.config.ts` | Builds Shopify/Framer embed (`tg-trade-in.js`) |
| `INTEGRATE_SHOPIFY.md` / `CONNECT_SHOPTECHGENIUS.md` | How to mount on shoptechgenius.ca |
| `INTEGRATE_FRAMER.md` | Framer mount notes |

**Stack:** React 19, Vite 8, TypeScript, Framer Motion, Vitest.

### 2.2 Backend — `trade-in-backend/`

| Path | What it is |
|------|------------|
| `src/server.ts` | Express app entry (public widget + protected admin APIs) |
| `src/db/schema.ts` | SQLite schema + default settings |
| `src/db/migrate.ts` | Migrations |
| `data/tradein.db` | Live SQLite database (catalog, prices, offers, orgs…) |
| `src/routes/` | HTTP routes: catalog, pricing, offers, widget, saas, scraper… |
| `src/services/quoteEngine.ts` | Server quote (authoritative) |
| `src/services/competitorPricing.ts` | Frontend price source: match/beat competitors |
| `src/services/tenancy.ts` | Multi-tenant orgs / API keys / widget config |
| `src/pricing-engine/` | Scrapling dual-engine + adapters (GoRecell, UniverCell, Bell, TELUS) |
| `scripts/build_device_image.py` | Auto-build product image from device name |
| `scripts/backfill_device_images.py` | Map catalog devices → `/devices` images |
| `scripts/scrapling_worker.py` | Scraper worker |

**Stack:** Node/Express, better-sqlite3, Playwright, Cheerio, Zod, Python scrapers.

### 2.3 Default local credentials (dev)

| Item | Value |
|------|--------|
| Backend port | `4100` |
| Admin email | `admin@techgenius.ca` |
| Admin password | `TechGenius2026!` |
| Dev API key | `tg-dev-key-2026` |
| Cron secret (dev) | same as API key unless `TG_CRON_SECRET` set |

Also seeded roles: `manager@techgenius.ca`, `operator@techgenius.ca` (see Reusely report).

---

## 3. How the system works (clean flow)

### Customer (widget)

1. Opens sell page → `TradeInFlow`
2. Picks category / brand / device (images from catalog `image_url` or `/devices/...`)
3. Storage + carrier + condition questions (+ optional multi-angle photos / AI scan)
4. Frontend calls `POST /api/quote` → **backend** returns cash offer
5. Customer submits → `POST /api/widget/submit` → offer stored
6. Can track offer via portal (`/api/widget/portal`)

### Admin (ops)

1. Login at `/admin`
2. Manage offers, hand-off walk-ins, inventory, invoices, payouts
3. Pricing page: scrape competitors, choose **which source the frontend reflects**, beat %
4. Catalog: devices, images, bootstrap device-by-name
5. Settings / SaaS org branding + widget keys

### Pricing truth

- Setting `frontend_price_source` = `gorecell` | `univercell` | `bell` | `telus` | `best` | `manual`
- Setting `frontend_price_mode` = `match` | `beat`
- Setting `frontend_beat_percent` = undercut % (e.g. `2`)
- Quotes use this config; customers never see competitor names/prices — only Tech Genius offer

---

## 4. Step-by-step build history (what we made)

Ordered from earliest foundation → latest SaaS work (from git commits on this branch).

### Phase A — Customer trade-in UI & hosting

| Step | Commit theme | What we did |
|------|----------------|-------------|
| A1 | Real device photos | Device picker uses real product images, not green placeholders |
| A2 | Beat competitor UX | Image-first device pick + smarter on-device vision |
| A3 | Bundle photos into embed | Inlined images so Framer/Shopify always show devices |
| A4 | Framer / Shopify packs | Upload packs, CDN hosting docs, Netlify alternative, iframe workarounds |
| A5 | Shop redesign | UI redesigned to feel like local Tech Genius shop (not generic SaaS) |

### Phase B — Independent pricing + CRM mapping

| Step | Commit theme | What we did |
|------|----------------|-------------|
| B1 | Pricing engine scaffold | Independent pricing engine + Twenty CRM outbox mapping |
| B2 | Snapshot → quote | Wire pricing snapshot into quote engine (scraper-ready) |
| B3 | Scrapling scaffold | Python Scrapling-based price scraper scaffold |

### Phase C — Full Reusely-replacement backend

| Step | Commit theme | What we did |
|------|----------------|-------------|
| C1 | Backend core | API + SQLite DB + pipeline + pricing + inventory + customers |
| C2 | Scraper + auth + public quote | API key auth, public quote endpoint, scraper |
| C3 | Seed catalog | Devices, brands, categories, price points + static device image serving |
| C4 | TechAPI importer | Scrapling-based TechAPI catalog import |
| C5 | Widget ↔ backend + admin | Wire widget to API; Reusely-style admin panel |
| C6 | Admin login | Email/password admin login |
| C7 | Dual-engine + training | Scrapling dual-engine scrape + self-learning pricing |

### Phase D — Live competitor scrapers

| Step | Commit theme | What we did |
|------|----------------|-------------|
| D1 | Live scrapers | UniverCell, Bell, TELUS, GoRecell adapters |
| D2 | Full GoRecell catalog | Import catalog + images + competitor pricing admin UI |
| D3 | Reliability hardening | Shared matcher, fail-closed capacity, safer pipeline |
| D4 | GoRecell fix | Read live prices from product-page `query_data` |
| D5 | Full-catalog sync | Per-storage GoRecell sync + weekly scrape job |
| D6 | Grade naming | Tech Genius grade names; water-damage As-Is lock |

### Phase E — Ops completeness (Reusely modules)

| Step | Commit theme | What we did |
|------|----------------|-------------|
| E1 | Security + build fixes | Harden security; fix build errors |
| E2 | Admin polish | Menu alignment + deeper hardening |
| E3 | Notifications / search / KPIs | Close replica gaps on dashboard |
| E4 | RBAC, invoices, payouts, bulk | Remaining Reusely modules |
| E5 | Production audit | Document readiness; ignore upload binaries |
| E6 | Pricing perfection | Cracked→fair mapping, `1TB`↔`1024GB`, beat −2% parity, promo rules, store-credit +5% |

### Phase F — SaaS / catalog intelligence

| Step | Commit theme | What we did |
|------|----------------|-------------|
| F1 | Device-by-name bootstrap | `ensureDeviceFromName` + `build_device_image.py` auto images |
| F2 | Bulk hand-off wiring | Bulk quote/offer uses device-by-name bootstrap |
| F3 | Multi-angle vision | Front/back/left/right capture → structured issues → grade; AI scan on offers |
| F4 | Multi-tenant SaaS | Orgs, org stores/settings/keys, signup, widget config by org slug |

### Phase G — Image correctness + templates (done)

| Step | Intent | Status |
|------|--------|--------|
| G1 | Device image repair | **Done.** Root cause was the device *id*: the slug flattens `(Apple iPhone 13,2)` to `…-apple-iphone-132`, so every iPhone 12 SKU matched `iphone.?13`. Resolver now derives each stem from the device's own model name, cross-model fallbacks and catch-alls are gone, models with no photo get a labelled silhouette, and the frontend no longer substitutes `iphone-15`. `npm run images:audit` reports **0 cross-model collisions**. |
| G2 | Selectable frontend templates | **Done.** `frontend_template` setting + per-org override, admin picker in Settings, public `GET /api/widget/template`, `data-template` skins in `templates.css`. Seven first-party presets; no competitor CSS shipped. |
| G3 | Store scoping | **Done.** Invoices and Payouts now pass `store_id` like Offers and Inventory, through a shared `withStoreScope` / `onStoreChange` helper. |
| G4 | Catalog de-duplication | **Done.** 544 rows → **419, one per model**. Duplicates carried TechAPI *retail* prices, so the wrong iPhone 12 tile quoted $773 instead of $245 — a money bug, not clutter. Duplicates are disabled (reversible); price gaps filled only from trusted sources. `npm run catalog:dedupe`. |
| G5 | Retired devices unquotable | **Done.** `/api/quote` and `/api/widget/submit` are public and never checked `enabled`, so a retired row stayed priceable by id. Guard added in `quoteEngine.ts`; `npm run test:quote-guard`. |
| G6 | Framer `/sell` embed | **Done.** Runtime `data-api` (no rebuild per host), lite bundle **10 MB → 388 KB**, 14 dead CDN images replaced, host-relative asset paths fixed, placeholder `"default"` storage hidden. Deliverables in `~/Downloads/TechGenius-Framer-Sell/`. |

---

## 5. Important APIs (cheat sheet)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/health` | Public | Health check |
| GET | `/api/catalog/devices` | Public | Device catalog (+ prices) |
| POST | `/api/quote` | Public | Authoritative quote |
| POST | `/api/widget/submit` | Public | Create offer from widget |
| POST | `/api/widget/ensure-device` | Public | Bootstrap device by name |
| GET | `/api/saas/widget-config?org=` | Public | White-label widget config |
| GET | `/api/widget/template` | Public | Frontend template the widget renders with |
| GET/PUT | `/api/pricing/frontend-source` | Admin key | Choose price source frontend reflects |
| GET/PUT | `/api/settings/widget-template` | Admin key | Choose the storefront template |
| POST | `/api/scraper/run-live` | Admin | Live competitor scrape |
| POST | `/api/cron/weekly` | Cron secret | Weekly scrape + catalog sync |

---

## 6. Run on your laptop (no errors checklist)

### Prerequisites

- Node.js 20+ (or 22+)
- Python 3.10+ (for image build / scrapers)
- npm

### Backend

```bash
cd trade-in-backend
npm install
npm run db:migrate
npm run dev
# → http://127.0.0.1:4100
curl http://127.0.0.1:4100/api/health
```

### Frontend

```bash
cd trade-in-platform
npm install
# point widget at local API if needed:
# export VITE_TRADE_IN_API_URL=http://127.0.0.1:4100
npm run dev
# open the printed local URL, then /admin for ops
```

### Admin login

- URL: `/admin`
- Email: `admin@techgenius.ca`
- Password: `TechGenius2026!`

### Build embed for Shopify

```bash
cd trade-in-platform
npm run build:embed
# output under dist-embed / documented in CONNECT_SHOPTECHGENIUS.md
```

---

## 7. Related docs (read in this order)

1. **This file** — goal + map + history  
2. `HOW_TO_SAVE_TO_LAPTOP.md` — how to download the zip  
3. `REUSELY_REPLICA_REPORT.md` — feature pass/fail vs Reusely  
4. `PRODUCTION_AUDIT_REPORT.md` — production blockers  
5. `trade-in-platform/CONNECT_SHOPTECHGENIUS.md` — live Shopify mount  
6. `trade-in-platform/TRADEIN_CHECKLIST.md` — QA checklist  

---

## 8. Known blockers (honest)

| Area | Status |
|------|--------|
| Email send | Needs `TG_EMAIL_WEBHOOK` |
| CRM / Twenty | Needs `TG_CRM_WEBHOOK_URL` |
| Carrier label purchase APIs | Printable HTML only |
| Payout money movement | Status tracking only |
| Shopify/Framer public mount | Needs your hosting credentials |
| Git remote `origin` | Not configured in this cloud workspace (local commits exist; push needs a remote) |
| Device image uniqueness | ✅ Repaired — `npm run images:audit` gates it |
| Frontend template picker | ✅ Shipped — Admin → Settings → Storefront template |

---

## 9. Archive contents

The downloadable archive `TechGenius-TradeIn-FULL-PROJECT.zip` includes:

- All source for `trade-in-platform` and `trade-in-backend`
- SQLite DB (`trade-in-backend/data/tradein.db`) when present
- Device images under `public/devices`
- This master guide + reports
- **Excludes** `node_modules`, most `dist` build junk, and `.git` (to keep zip small). Re-install with `npm install` after unzip.

End of master guide.
