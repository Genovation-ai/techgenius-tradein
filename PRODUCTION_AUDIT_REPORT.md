# Final Production Readiness Audit — Tech Genius Trade-In

**Date:** 2026-08-09  
**Branch:** `cursor/tech-genius-trade-in-b397`  
**Scope:** `trade-in-platform` + `trade-in-backend`  
**Method:** Code review + live API E2E against SQLite DB + unit/embed builds  

---

## Overall Status

| Area | Status | Notes |
|------|--------|-------|
| Production readiness | ⚠️ PARTIAL | Core pricing/offers work; deploy + secrets + hosting still required |
| UI readiness | ✅ PASS | Widget + admin usable; some dead chrome (search/store selects) |
| Backend readiness | ✅ PASS | Express + SQLite APIs verified live |
| Database readiness | ✅ PASS | Real persisted catalog, prices, offers, customers |
| API readiness | ✅ PASS | Auth, catalog, quote, widget, admin CRUD smoke-tested |
| Framer readiness | ⚠️ PARTIAL | Embed packaging ready; **no permanent host URLs yet** |
| Shopify readiness | ⚠️ PARTIAL | Theme embed/Liquid ready; **no Shopify Admin API**; not live on store |
| Security status | ⚠️ PARTIAL | **Quote inflation fixed**; default secrets still for local/dev |
| Performance status | ⚠️ PARTIAL | Embed JS ~9MB (bundled device photos) — OK for CDN, heavy for mobile |
| Test status | ✅ PASS | Frontend 14/14; deviceMatch; gorecell live scrape tests |

**Verdict:** Not “fully live in production” yet, but **functionally ready to host** once secrets + permanent CDN + Shopify page mount are done. Do not claim Shopify/Framer are connected until those ops steps complete.

---

## Critical Fixes Applied This Audit

| Issue | Severity | Fix | Verification |
|-------|----------|-----|--------------|
| Widget accepted client `quoted_price` ($99999 attack) | Critical | Server re-quotes via `quoteEngine` + `widget.ts` | Submit with 99999 → stored **$392** |
| Checkout invented local Offer IDs if API failed | High | Checkout now **requires** API success | Code path in `TradeInFlow.tsx` |
| Production could boot with default secrets | High | `NODE_ENV=production` (or `TG_REQUIRE_SECRETS=1`) **exits** | `server.ts` |
| Framer defaults pointed at expiring catbox URLs | Critical (deploy) | Defaults cleared; iframe template requires permanent `IFRAME_SRC` | `framer/*` |
| Fake 350ms AI delay with no media | Medium | Removed | `aiScan.ts` |
| Inflated audit offer in DB | — | Deleted | DB cleanup |

---

## Feature Matrix

| Feature | UI | Backend | Database | Real Data | Tested | Status |
|---------|----|---------|----------|-----------|--------|--------|
| Health check | — | ✅ | — | ✅ | ✅ | ✅ PASS |
| Admin login/logout | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ PASS |
| Catalog categories | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ PASS |
| Catalog devices + price matrix | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ PASS |
| Public `/api/quote` | ✅ | ✅ | ✅ | GoRecell-backed | ✅ | ✅ PASS |
| Widget submit (server-priced) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ PASS |
| Offer tracking (masked email) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ PASS |
| Admin offers list / status move | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ PASS |
| Admin customers | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ PASS |
| Admin pricing / competitors | ✅ | ✅ | ✅ | Scraped | ✅ | ✅ PASS |
| Admin catalog matrix | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ PASS |
| Admin reports summary | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ PASS |
| Admin inventory | ✅ | ✅ | ✅ | Empty until completed offers | ✅ | ⚠️ PARTIAL |
| Admin settings | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ PASS |
| Admin dashboard pipeline | ✅ | ✅ | ✅ | Via offers | ✅ | ✅ PASS |
| Weekly catalog scrape job | — | ✅ | ✅ | GoRecell | Unit/live prior | ✅ PASS |
| Competitor scrapers (Bell/TELUS/UniverCell) | Admin button | ✅ | ✅ | Live when run | Prior live tests | ⚠️ PARTIAL (ops) |
| On-device photo check | ✅ | Local CV | — | Client-side | Manual | ⚠️ PARTIAL |
| Offline static catalog fallback | ✅ | — | — | Static seed prices | Code review | ⚠️ PARTIAL (browse only; submit blocked) |
| Promo codes (DB) | ✅ | ✅ | ✅ | Seeded + FE map | Partial | ⚠️ PARTIAL |
| Twenty CRM | — | — | localStorage outbox | Fake outbox | Code review | ❌ FAIL (not connected) |
| Shopify Admin/Storefront API | — | — | — | — | — | 🚧 BLOCKED / N/A (embed-only by design) |
| Shopify theme live mount | Docs | — | — | — | Live site check docs | 🚧 BLOCKED (needs staff upload) |
| Framer permanent hosting | Packaging | — | — | — | — | 🚧 BLOCKED (needs CDN URL) |
| Email notifications | — | — | — | — | — | ❌ FAIL (not implemented) |
| User registration | — | — | — | — | — | 🚧 BLOCKED / N/A (admin-only auth) |
| Admin global search | ✅ | ✅ `/api/search` | ✅ | ✅ | ✅ | ✅ PASS |
| Admin store select | ✅ | ✅ `store_id` filter | ✅ | ✅ | ✅ | ✅ PASS (Offers, Inventory, Invoices, Payouts) |
| Storefront template picker | ✅ | ✅ `/api/settings/widget-template` | ✅ | ✅ | ✅ | ✅ PASS |
| Per-model unique device images | ✅ | ✅ resolver + audit | ✅ | ✅ | ✅ | ✅ PASS (0 cross-model collisions) |

---

## Fake / Mock Data Report

| Item | Location | Disposition |
|------|----------|-------------|
| Static `devices[]` + `basePrice` | `trade-in-platform/src/data/catalog.ts` | **Retained** as offline browse fallback only; checkout blocked offline |
| Synthetic market points | `pricingBackend.ts` / empty `pricingSnapshot.ts` | **Retained** for local estimate UI; server quote is authoritative |
| Frontend `PROMO_CODES` map | `catalog.ts` | **Retained** for UX hints; server uses DB `promo_codes` on quote/submit |
| Seed / gorecell-catalog placeholders | Backend seed + importer | **Retained** for devices without live scrapes; mapped devices use live GoRecell |
| Twenty CRM outbox | `twenty.ts` / `offers.ts` | **Identified** — not a real CRM; localStorage only |
| Dashboard fake stats | — | **None found** — real SQL aggregates |
| Widget client prices | Was production bug | **Removed** — server re-quote |

---

## AI-Pattern / Messy Code Report

| Pattern | Action |
|---------|--------|
| Sparkles / “Genius Vision” marketing AI chrome | Cleaned in prior design pass |
| Artificial `setTimeout(350)` simulating scan | **Removed** |
| Dead `BrandStep` / `ModelStep` / `workflow.ts` | **Identified** — unused; left in place (no behavior risk) |
| `/api/dashboard` unused by FE | **Identified** — API works; FE uses offers |
| Verbose generic comments | Mostly intentional domain docs (GoRecell formula) — kept |
| Duplicate quote logic FE/BE | Server now single `quoteEngine`; FE display still estimates then server confirms |

---

## Security Notes

1. **Fixed:** Offer amount inflation via `/api/widget/submit`.
2. **Required before public deploy:** set `TG_API_KEY`, `TG_CRON_SECRET`, `TG_ADMIN_PASSWORD`, `TG_CORS_ORIGINS`, `NODE_ENV=production`.
3. **API key in admin SPA:** expected for this architecture (header token); rotate in production.
4. **No `.env` committed**; defaults only in source for local.

---

## Shopify & Framer Readiness (Honest)

### Shopify
- ✅ Embed build: `npm run build:embed` → `dist-embed/tg-trade-in.js` + `.css`
- ✅ Liquid snippet + page HTML in `shopify/`
- ❌ No Shopify GraphQL/REST product/order sync (not in scope of current architecture)
- 🚧 Live page mount requires store admin action per `CONNECT_SHOPTECHGENIUS.md`

### Framer
- ✅ Code component + iframe embed templates
- 🚧 Must host built app on permanent HTTPS and set URLs in Framer
- ❌ Temporary catbox defaults **removed** (were unsafe for production)

---

## Performance

- Embed bundle ~9.3 MB JS (gzip ~6.7 MB) due to **inlined device images** — intentional for Framer/Shopify without asset hosting, but heavy. Consider CDN image URLs post-launch if mobile load is an issue.

---

## Remaining Go-Live Checklist

1. Host backend with real secrets + persisted DB volume  
2. Set `VITE_TRADE_IN_API_URL` and rebuild embed  
3. Upload embed assets to Shopify theme; mount Sell My Device  
4. Host embed/iframe on permanent CDN; wire Framer `/sell`  
5. Run full catalog sync on production DB  
6. Soft-launch: one mail-in + one drop-off real offer  
7. Optionally remove dead steps / wire admin search later  

---

## Issues Found (Summary Table)

| Path | Problem | Severity | Fix / Status |
|------|---------|----------|--------------|
| `routes/widget.ts` | Trusted client prices | Critical | **Fixed** — server re-quote |
| `TradeInFlow.tsx` | Local fake offer IDs | High | **Fixed** — API required |
| `server.ts` | Weak prod secret warning | High | **Fixed** — exit in production |
| `framer/*` | Expiring host defaults | Critical | **Fixed** — cleared |
| `aiScan.ts` | Fake delay | Medium | **Fixed** |
| `AdminLayout.tsx` | Dead search/store UI | Medium | **Fixed** — search calls `/api/search`; store selector now scopes Offers, Inventory, Invoices and Payouts via shared `withStoreScope`/`onStoreChange` |
| `BrandStep.tsx` / `ModelStep.tsx` | Dead components | Low | **Fixed** — files removed |
| `InvoicesPage.tsx` | Dead `printUrl` with unreachable `void key` | Low | **Fixed** — removed; `openPrint` is the real path |
| `admin/api.ts` `uploads[]` | Missing `angle` field broke `tsc -b` | High | **Fixed** — `npm run build` was failing before this |
| `image_aliases.py` | iPhone 12 SKUs → `iphone-13.png` (+9 more cross-model collisions) | High | **Fixed** — see PROJECT_HANDOFF PART I; gated by `npm run images:audit` |
| `deviceImgSrc` / `deviceImage` | Every broken image became an iPhone 15 | Medium | **Fixed** — neutral initial-letter tile |
| `twenty.ts` | CRM not real | Medium | Open / out of scope |
| Offline `catalog.ts` | Static prices | Medium | Mitigated (submit blocked) |
| Embed size | Large bundle (~10 MB with inlined photos) | Medium | Accepted for now |
