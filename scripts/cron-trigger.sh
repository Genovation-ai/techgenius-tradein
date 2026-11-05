#!/usr/bin/env bash
# Call a cron endpoint on the deployed backend with the shared secret.
#
# Usage from a Railway cron service, a GitHub Actions scheduled workflow, or
# any outside scheduler:
#
#   APP_URL=https://techgenius.up.railway.app \
#   TG_CRON_SECRET=... \
#   ./scripts/cron-trigger.sh sync-catalog
#
# Endpoints (all defined in trade-in-backend/src/routes/cron.ts, all guarded
# by cronSecretAuth):
#   scrape         POST /api/cron/scrape         — competitor scrape (~5m)
#   sync-catalog   POST /api/cron/sync-catalog   — full GoRecell sync (~15m)
#   weekly         POST /api/cron/weekly         — catalog + competitors
#   train          POST /api/cron/train          — self-learning baseline
#
# Exits non-zero on HTTP failure so Railway marks the run failed and the next
# tick is a fresh attempt rather than piling up.

set -euo pipefail

ENDPOINT="${1:?endpoint required (scrape|sync-catalog|weekly|train)}"
APP_URL="${APP_URL:?APP_URL required (e.g. https://techgenius.up.railway.app)}"
SECRET="${TG_CRON_SECRET:?TG_CRON_SECRET required}"

URL="${APP_URL%/}/api/cron/${ENDPOINT}"
echo "[cron-trigger] POST ${URL}"

# --max-time matches the longest endpoint timeout (sync-catalog, 30m).
# -sS prints errors but not the progress meter; -w gives us the status.
# Body is logged to stderr; the exit code is the cron run's verdict.
status=$(curl -sS -o /tmp/cron-trigger-$$.out -w "%{http_code}" \
  --max-time 1800 \
  -X POST "${URL}" \
  -H "x-cron-secret: ${SECRET}" \
  -H "content-type: application/json" \
  -d '{}')

echo "[cron-trigger] status=${status}"
cat /tmp/cron-trigger-$$.out
rm -f /tmp/cron-trigger-$$.out

[[ "${status}" =~ ^2[0-9]{2}$ ]]
