# Tech Genius Trade-In Platform

A white-label device trade-in and buyback platform for electronics repair shops. A
customer gets an instant quote for their old phone, laptop or console; the shop manages
every trade-in, payout and shipment from one dashboard. Built multi-tenant, so one
deployment serves many shops, each with its own branding, pricing and settings.

---

## What it does

**For the customer** — an embeddable widget, carrying the shop's logo and colours:
- Instant quotes across phones, tablets, laptops, consoles and wearables.
- Condition grading that adjusts the offer.
- Choice of mail-in (with a real carrier shipping label) or in-store drop-off — whichever
  the shop offers.
- Address lookup so shipping details are real, not mistyped.

**For the shop** — an admin dashboard:
- Every trade-in lead, with customer, device, quote and status.
- Payout tracking (e-transfer, store credit, cash) and a configurable workflow.
- Branding, store locations, device catalogue and pricing.
- Shipping settings, including the option to turn mail-in off entirely.
- API keys for embedding the widget.

**For the operator** — the SaaS layer:
- Subscription billing through Stripe: checkout, customer portal, and a signature-verified
  webhook.
- Free trials, per-plan limits and usage metering.
- Analytics across tenants.
- Automatic daily database backups that are **verified by being restored**, not just copied.

---

## Architecture

```
trade-in-platform/   React + Vite frontend — customer widget and /admin dashboard
trade-in-backend/    Express + TypeScript API — quotes, tenancy, billing, shipping
framer-deliverable/  Framer embed assets for the marketing site
```

- **Backend:** Node + Express + TypeScript, SQLite via better-sqlite3, Stripe for billing,
  EasyPost for carrier labels, OpenStreetMap (Photon + Nominatim) for address lookup.
- **Frontend:** React + Vite, builds both the admin app and a standalone embeddable widget.
- **Tests:** Vitest — backend and frontend suites, run on every change.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full design.

---

## Running locally

Requires Node 20+.

```bash
# Backend  (http://localhost:4000)
cd trade-in-backend
npm install
npm run db:migrate
npm run db:seed        # seeds the device catalogue
npm run dev

# Frontend (http://localhost:5173)
cd trade-in-platform
npm install
npm run dev
```

Run the tests:

```bash
cd trade-in-backend && npm test
cd trade-in-platform && npm test
```

---

## Configuration

Everything runs with no external accounts in development. Production features switch on
as their keys are provided — each is optional and degrades gracefully when absent.

| Variable | Enables | Without it |
|----------|---------|------------|
| `TG_STRIPE_SECRET_KEY` + price IDs | Subscription billing | Billing endpoints report what's missing |
| `TG_STRIPE_WEBHOOK_SECRET` | Verified Stripe webhooks | Webhook rejects unsigned calls |
| `RESEND_API_KEY` | Customer emails | Emails queue instead of sending |
| `TG_EASYPOST_API_KEY` | Real carrier shipping labels | Printable label + manual reference |
| `TG_GEOCODER_URL` | Self-hosted address lookup | Falls back to public OpenStreetMap |

`GET /api/saas/billing/status` and `GET /api/offers/shipping/status` each report exactly
which variables are still missing, by name.

Secrets live in `.env` (gitignored). Never commit real keys.

---

## Deployment

Runs on any Node host with a persistent volume for the SQLite database. The backend
serves the built frontend. Set the environment variables above on the host, point a
volume at the database path, and the daily backup schedule starts automatically.

---

## Project documentation

| Document | Purpose |
|----------|---------|
| [PROJECT_HANDOFF.md](./PROJECT_HANDOFF.md) | Complete handoff — everything in one file |
| [PROJECT_MASTER_GUIDE.md](./PROJECT_MASTER_GUIDE.md) | Goal, map, and how to run |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System design |
| [PRODUCTION_AUDIT_REPORT.md](./PRODUCTION_AUDIT_REPORT.md) | Production readiness |

---

© Genovation AI. All rights reserved.
