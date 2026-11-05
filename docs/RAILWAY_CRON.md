# Railway cron: wiring the scraper to fire on a schedule

The backend already exposes the endpoints. `scripts/cron-trigger.sh` is the client. This page is the three-step dashboard setup that joins the two in production.

## The endpoints (already deployed)

All are `POST`, all take `x-cron-secret: $TG_CRON_SECRET` or `Authorization: Bearer $TG_CRON_SECRET`, all live in [`trade-in-backend/src/routes/cron.ts`](../trade-in-backend/src/routes/cron.ts).

| Endpoint              | What it does                                            | Typical run |
|-----------------------|---------------------------------------------------------|-------------|
| `/api/cron/sync-catalog` | Scrape every GoRecell-mapped device, update prices.  | 10–20 min   |
| `/api/cron/scrape`       | Competitor scrape (UniverCell / Bell / TELUS).       | 3–5 min     |
| `/api/cron/weekly`       | `sync-catalog` + competitor targets, together.       | 15–25 min   |
| `/api/cron/train`        | Retrain the self-learning pricing baseline.          | seconds     |

The in-process weekly scheduler in [`jobs/weeklyScrape.ts`](../trade-in-backend/src/jobs/weeklyScrape.ts) also fires `weekly` every Sunday 03:00 when `TG_WEEKLY_SCRAPE` is unset or `1`. Pick **one** — in-process or a Railway cron — so prices don't get scraped twice.

## Step 1. Set `TG_CRON_SECRET` on the backend service

Dashboard → the backend service → **Variables** → **New Variable**:

- `TG_CRON_SECRET` → a long random string (`openssl rand -hex 32` is fine).

The middleware currently falls back to the hardcoded dev key `tg-dev-key-2026` when this is unset ([`middleware/cronAuth.ts`](../trade-in-backend/src/middleware/cronAuth.ts)). Any public deployment should overwrite that.

## Step 2. Add a cron service

Dashboard → **New Service** → **Empty Service**, in the same project so it sees the same env group.

- **Source**: this repo, same branch as the backend (`master`).
- **Build Command**: *(empty — the image already has bash and curl.)*
- **Start Command**:
  ```bash
  ./scripts/cron-trigger.sh sync-catalog
  ```
- **Cron Schedule**: `0 10 * * *` for 03:00 America/Vancouver (Railway uses UTC). Pick a different hour per endpoint if running more than one.
- **Service Variables**: reference the shared ones.
  - `TG_CRON_SECRET` → *(same value as step 1; use Shared Variables or paste it)*
  - `APP_URL` → `https://<backend-domain>` (public domain of the backend service).

Railway runs the start command once per tick and tears the container down between runs, so there is no idle cost beyond the container minute.

## Step 3. Disable the in-process scheduler

On the backend service, add:

- `TG_WEEKLY_SCRAPE` → `0`.

Otherwise the in-process Sunday-03:00 job and the Railway cron will both fire. Keeping one source of truth makes the `scrape_runs` log readable.

## Verifying it works

From any machine with the secret:

```bash
APP_URL=https://<backend-domain> TG_CRON_SECRET=... \
  ./scripts/cron-trigger.sh sync-catalog
```

A successful run prints the result JSON and exits 0. In Railway, the cron service's latest run page shows the same output. In the admin, `/admin/pricing` flips GoRecell from "never reported" or "late" to "ok" once rows land in `scraped_prices`.

## Catalog coverage

The sync only visits devices that have a `gorecell_product_map:<id>` row. The latest database patch — [`remapOrphanGorecellEntries`](../trade-in-backend/src/db/patches.ts) — moves stale map keys onto their enabled twin on boot, so a redeploy is enough to pick up the 32 Galaxy S20–S25 / recent iPhone / Tab S8–S9 / Fold6-Flip6 / Watch6-7 mappings the rename orphaned. Coverage after the first boot: 368 of 416 enabled devices. The remaining 48 (older Pixels, older iPads, an Apple Watch SE 2nd gen) have no GoRecell product and are expected to sit unmapped until they do.
