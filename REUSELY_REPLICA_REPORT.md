# Reusely Replica — Full Functional Verification

**Date:** 2026-08-09 (updated)  
**Branch:** `cursor/tech-genius-trade-in-b397`  
**Scope:** Tech Genius trade-in platform as a Reusely-style ops replica  
**Method:** Feature mapping + live API/DB E2E + fake-data hunt  

**Verdict:** **PARTIAL READY for Tech Genius Burlington buyback ops.** Core Reusely modules now work with real SQLite data (widget, offers, inventory, invoices, payouts, team RBAC, bulk/hand-off, shipping labels, uploads, portal, notifications). External delivery (SMTP/CRM webhooks, Shopify/Framer mount, carrier APIs) remains **BLOCKED** until credentials/hosting are configured — events queue as blocked, never fake-success.

Statuses: ✅ PASS · ⚠️ PARTIAL · ❌ FAIL · 🚧 BLOCKED

---

## Feature matrix

| Reusely Functionality | Replica UI | Backend | Database | Real Data | Tested | Status |
|-----------------------|------------|---------|----------|-----------|--------|--------|
| Buyback widget | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ PASS |
| Server-authoritative quote | ✅ | ✅ | ✅ | GoRecell | ✅ 99999→341 | ✅ PASS |
| Offer pipeline | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ PASS |
| Hand-off (walk-in) | ✅ Bulk/Hand-off | ✅ `/offers/handoff` | ✅ | ✅ | ✅ | ✅ PASS |
| Bulk quote / bulk offer | ✅ | ✅ `/api/bulk/*` | ✅ | ✅ | ✅ | ✅ PASS |
| Inventory + Sell Instantly | ✅ | ✅ `/inventory/:id/sell` | ✅ sales | ✅ | ✅ | ✅ PASS |
| Invoices (auto on complete) | ✅ | ✅ | ✅ | ✅ | ✅ INV-… | ✅ PASS |
| Payouts board | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ PASS |
| Shipping label (printable) | ✅ | ✅ HTML label | ✅ | ✅ | ✅ | ✅ PASS |
| File uploads | ✅ Offer detail | ✅ | ✅ uploads | ✅ | ✅ | ✅ PASS |
| Team RBAC (admin/manager/operator) | ✅ Team page | ✅ caps middleware | ✅ | ✅ | ✅ 403 pricing | ✅ PASS |
| Customer portal (email unlock) | ✅ Track panel | ✅ `/widget/portal` | ✅ | ✅ | ✅ / wrong email 403 | ✅ PASS |
| In-app notifications | ✅ Bell | ✅ | ✅ | ✅ | ✅ | ✅ PASS |
| Email delivery | Settings status | Outbox + webhook | ✅ | Queued | ✅ blocked w/o webhook | ⚠️ PARTIAL |
| CRM / Twenty | Sync button | Outbox + webhook | ✅ | Queued | ✅ blocked w/o URL | ⚠️ PARTIAL |
| Catalog + pricing | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ PASS |
| Dashboard KPIs = DB | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ PASS |
| Global search | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ PASS |
| Reports | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ PASS |
| Promo uses increment | — | ✅ on submit | ✅ | ✅ | Prior | ✅ PASS |
| Carrier shipping API | — | Printable only | — | — | — | ⚠️ PARTIAL |
| Payout provider APIs | Manual statuses | — | ✅ | — | ✅ | ⚠️ PARTIAL |
| Multi-store data partition | Store select | `store_id` filter | ✅ | ✅ | ✅ | ✅ PASS (Offers, Inventory, Invoices, Payouts) |
| Storefront template picker | ✅ Settings | ✅ `/api/settings/widget-template` | ✅ | ✅ | ✅ | ✅ PASS |
| Per-model unique device images | ✅ | ✅ resolver + audit gate | ✅ | ✅ | ✅ | ✅ PASS |
| Shopify live mount | Docs/embed | — | — | — | — | 🚧 BLOCKED |
| Framer permanent host | Templates | — | — | — | — | 🚧 BLOCKED |
| Sell Instantly wholesale network | Local sell only | ✅ | ✅ | ✅ | ✅ | ⚠️ PARTIAL (local) |

---

## Roles verified

| Role | Login | Caps enforced | Notes |
|------|-------|---------------|-------|
| Admin | `admin@techgenius.ca` | Full | ✅ |
| Manager | `manager@techgenius.ca` | No `team:write` | ✅ seeded |
| Operator | `operator@techgenius.ca` | No pricing/team/scraper | ✅ 403 on `/api/pricing`, `/api/team` |

---

## E2E highlights (2026-08-09)

1. Hand-off create → label → complete → **invoice auto-issued** + inventory created  
2. Sell Instantly → `sales` row + inventory `sold`  
3. Portal unlock with matching email; wrong email **403**  
4. Upload PDF persisted under `data/uploads`  
5. Email/CRM outbox **blocked** (honest) without webhooks  
6. Operator cannot read pricing or team  

---

## Remaining issues (even small)

1. **Email** needs `TG_EMAIL_WEBHOOK` (+ optional token) for live send  
2. **CRM** needs `TG_CRM_WEBHOOK_URL` for Twenty/other  
3. **Carrier label APIs** (Canada Post/UPS purchase) not integrated — printable HTML only  
4. **Payout rails** (Interac/PayPal) are status tracking, not money movement  
5. ~~Store selector does not partition every list UI~~ — **fixed:** Offers,
   Inventory, Invoices and Payouts all scope on `store_id` now. Dashboard,
   Reports and Customers remain org-wide (no `store_id` on those endpoints).  
6. **Shopify/Framer** still ops-blocked for public mount  
7. Embed bundle ~10 MB (inlined device photos, now including silhouettes)  
8. Offline static catalog browse fallback remains (submit still API-required)  
9. Manager cannot create admins (intentional); confirm product intent  
10. Invoice print opens via authenticated fetch/blob window (not public URL)  
11. **Catalog has duplicate rows for some models** (e.g. "Apple iPhone 12" and
    "iPhone 12", plus 9 TechAPI regional SKUs of the same handset). Each now
    shows a correct photo of the right model, so this is a catalog-hygiene /
    shopper-clarity issue rather than a wrong-image one — worth a de-dupe pass
    before public launch.  

---

## Config for production parity

```bash
TG_API_KEY=…
TG_ADMIN_PASSWORD=…
TG_CRON_SECRET=…
TG_EMAIL_WEBHOOK=https://…   # optional live email
TG_EMAIL_WEBHOOK_TOKEN=…     # optional
TG_CRM_WEBHOOK_URL=https://… # optional Twenty/CRM
TG_CRM_WEBHOOK_TOKEN=…
NODE_ENV=production
```

Dev staff seeds: admin / manager (`Manager2026!`) / operator (`Operator2026!`).

---

## Acceptance

| Bar | Result |
|-----|--------|
| Looks like Reusely ops console | ✅ Core modules present |
| Behaves with real data end-to-end | ✅ Core buyback + new modules |
| Full SaaS Reusely clone | ❌ External payouts/email/CRM/Shopify still blocked |
| Mark READY for TG soft-launch | **PARTIAL READY** — host API + secrets + webhooks + store mount |
