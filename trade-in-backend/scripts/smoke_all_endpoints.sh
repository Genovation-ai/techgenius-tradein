#!/usr/bin/env bash
# Exercise every endpoint the admin console and widget actually call, against
# the live database. Prints one line per check and a failure count at the end.
#
#   API=http://localhost:4110  (or TG_API_PORT=4110) bash scripts/smoke_all_endpoints.sh
set -uo pipefail
API="${API:-http://localhost:${TG_API_PORT:-4100}}"
PASS=0; FAIL=0; FAILED=()

TOKEN=$(curl -s -m 10 -X POST "$API/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"admin@techgenius.ca","password":"TechGenius2026!"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token",""))' 2>/dev/null)
if [ -z "$TOKEN" ]; then echo "FATAL: admin login failed against $API"; exit 1; fi

# check <label> <expected-status> <curl args...>
check() {
  local label="$1"; local want="$2"; shift 2
  local code
  code=$(curl -s -m 25 -o /tmp/tg_body.$$ -w "%{http_code}" "$@")
  if [ "$code" = "$want" ]; then
    PASS=$((PASS+1)); printf "  ok    %-46s %s\n" "$label" "$code"
  else
    FAIL=$((FAIL+1)); FAILED+=("$label (got $code want $want)")
    printf "  FAIL  %-46s %s  %s\n" "$label" "$code" "$(head -c 120 /tmp/tg_body.$$)"
  fi
  rm -f /tmp/tg_body.$$
}
G() { check "$1" "$2" "$3" -H "x-api-key: $TOKEN"; }

echo "== public / widget =="
check "health"                       200 "$API/api/health"
check "catalog categories"           200 "$API/api/catalog/categories"
check "catalog brands"               200 "$API/api/catalog/brands?category_id=smartphone"
check "catalog devices"              200 "$API/api/catalog/devices?limit=5"
check "catalog devices + prices"     200 "$API/api/catalog/devices?limit=5&include_prices=true"
check "widget template"              200 "$API/api/widget/template"
check "saas widget-config"           200 "$API/api/saas/widget-config?org=tech-genius"

DEV=$(curl -s "$API/api/catalog/devices?limit=1&category_id=smartphone" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d[0]["id"])')
STO=$(curl -s "$API/api/catalog/devices?limit=1&category_id=smartphone" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d[0]["storages"][0])')
check "public quote" 200 "$API/api/quote" -X POST -H 'Content-Type: application/json' \
  -d "{\"device_id\":\"$DEV\",\"storage\":\"$STO\",\"condition_grade\":\"flawless\"}"

echo "== ops reads =="
G "dashboard"            200 "$API/api/dashboard"
G "offers list"          200 "$API/api/offers?limit=5"
G "customers"            200 "$API/api/customers"
G "inventory"            200 "$API/api/inventory"
G "invoices"             200 "$API/api/invoices"
G "payouts"              200 "$API/api/payouts"
G "reports summary"      200 "$API/api/reports/summary"
G "notifications"        200 "$API/api/notifications/summary"
G "global search"        200 "$API/api/search?q=iphone"
G "team"                 200 "$API/api/team"
G "capabilities"         200 "$API/api/team/me/capabilities"
G "settings"             200 "$API/api/settings"
G "settings promos"      200 "$API/api/settings/promos"
G "settings workflow"    200 "$API/api/settings/workflow"
G "widget-template read" 200 "$API/api/settings/widget-template"
G "integrations status"  200 "$API/api/integrations/status"
G "pricing competitors"  200 "$API/api/pricing/competitors"
G "pricing frontend-src" 200 "$API/api/pricing/frontend-source"
G "pricing adjustments"  200 "$API/api/pricing/adjustments"
G "saas org"             200 "$API/api/saas/org"
G "saas org keys"        200 "$API/api/saas/org/api-keys"
G "saas org stores"      200 "$API/api/saas/org/stores"

echo "== writes / full buyback loop =="
OFFER=$(curl -s -m 25 -X POST "$API/api/widget/submit" -H 'Content-Type: application/json' -d "{
  \"contact\":{\"first_name\":\"Smoke\",\"last_name\":\"Test\",\"email\":\"smoke@techgenius.test\",\"phone\":\"9055550111\"},
  \"offer_type\":\"drop-off\",\"payout_method\":\"etransfer\",
  \"items\":[{\"device_id\":\"$DEV\",\"device_name\":\"Smoke Device\",\"storage\":\"$STO\",\"condition_grade\":\"flawless\",\"quoted_price\":99999}]}" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin).get("id",""))')
if [ -n "$OFFER" ]; then
  PASS=$((PASS+1)); printf "  ok    %-46s %s\n" "widget submit" "$OFFER"
else
  FAIL=$((FAIL+1)); FAILED+=("widget submit"); printf "  FAIL  %-46s\n" "widget submit"
fi

G "offer detail"        200 "$API/api/offers/$OFFER"
check "portal unlock"   200 "$API/api/widget/portal" -X POST -H 'Content-Type: application/json' \
  -d "{\"offer_id\":\"$OFFER\",\"email\":\"smoke@techgenius.test\"}"
check "portal wrong email is refused" 403 "$API/api/widget/portal" -X POST -H 'Content-Type: application/json' \
  -d "{\"offer_id\":\"$OFFER\",\"email\":\"wrong@example.com\"}"

for S in in_transit delivered being_inspected completed; do
  check "offer -> $S" 200 "$API/api/offers/$OFFER/status" -X PATCH -H "x-api-key: $TOKEN" \
    -H 'Content-Type: application/json' -d "{\"status\":\"$S\"}"
done
# A 200 is not proof the status moved: PATCH /:id once accepted `status` and
# answered 200 while changing nothing. Assert the stored value.
FINAL=$(curl -s -m 10 "$API/api/offers/$OFFER" -H "x-api-key: $TOKEN" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("status",""))')
if [ "$FINAL" = "completed" ]; then
  PASS=$((PASS+1)); printf "  ok    %-46s %s\n" "offer status actually persisted" "$FINAL"
else
  FAIL=$((FAIL+1)); FAILED+=("offer status did not persist (got $FINAL)")
  printf "  FAIL  %-46s %s\n" "offer status actually persisted" "$FINAL"
fi
check "status on PATCH /:id is refused, not ignored" 400 "$API/api/offers/$OFFER" -X PATCH \
  -H "x-api-key: $TOKEN" -H 'Content-Type: application/json' -d '{"status":"returned"}'
check "offer history is recorded" 200 "$API/api/offers/$OFFER/history" -H "x-api-key: $TOKEN"
check "shipping label" 200 "$API/api/offers/$OFFER/shipping-label" -X POST -H "x-api-key: $TOKEN" \
  -H 'Content-Type: application/json' -d '{"courier":"Canada Post"}' 
G "invoices after complete" 200 "$API/api/invoices"
G "inventory after complete" 200 "$API/api/inventory"

echo "== leads / audit trail / bulk =="
# Abandoned buyback: capture, upsert, list, and reject a lead with no contact route.
check "lead captured" 201 "$API/api/widget/lead" -X POST -H 'Content-Type: application/json' \
  -d '{"first_name":"Smoke","email":"smoke.lead@techgenius.test","quoted_total":100,"items":[{"device_name":"iPhone 15"}]}'
check "lead upserts, no duplicate" 200 "$API/api/widget/lead" -X POST -H 'Content-Type: application/json' \
  -d '{"email":"smoke.lead@techgenius.test","quoted_total":150,"items":[{"device_name":"iPhone 15"}]}'
check "lead without contact refused" 400 "$API/api/widget/lead" -X POST -H 'Content-Type: application/json' \
  -d '{"quoted_total":100}'
G "leads list" 200 "$API/api/offers/leads?status=open"
LEADCOUNT=$(curl -s -m 10 "$API/api/offers/leads?status=open" -H "x-api-key: $TOKEN" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(len([r for r in d['rows'] if r['email']=='smoke.lead@techgenius.test']))")
if [ "$LEADCOUNT" = "1" ]; then
  PASS=$((PASS+1)); printf "  ok    %-46s %s\n" "exactly one lead after two posts" "$LEADCOUNT"
else
  FAIL=$((FAIL+1)); FAILED+=("lead upsert produced $LEADCOUNT rows, expected 1")
  printf "  FAIL  %-46s %s\n" "exactly one lead after two posts" "$LEADCOUNT"
fi

G "inventory item history" 200 "$API/api/inventory/$(sqlite3 data/tradein.db 'select id from inventory limit 1;')/history"
check "bulk inventory update" 200 "$API/api/inventory/bulk" -X PATCH -H "x-api-key: $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"ids\":[\"$(sqlite3 data/tradein.db 'select id from inventory limit 1;')\"],\"status\":\"available\"}"
check "bulk rejects a bad status" 400 "$API/api/inventory/bulk" -X PATCH -H "x-api-key: $TOKEN" \
  -H 'Content-Type: application/json' -d '{"ids":["x"],"status":"nonsense"}'
check "bulk requires ids" 400 "$API/api/inventory/bulk" -X PATCH -H "x-api-key: $TOKEN" \
  -H 'Content-Type: application/json' -d '{"status":"available"}'

check "bulk quote" 200 "$API/api/bulk/quote" -X POST -H "x-api-key: $TOKEN" \
  -H 'Content-Type: application/json' -d "{\"items\":[{\"device_name\":\"iPhone 12\",\"storage\":\"128GB\",\"condition_grade\":\"good\",\"quantity\":2}]}"

echo "== RBAC =="
OP=$(curl -s -m 10 -X POST "$API/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"operator@techgenius.ca","password":"Operator2026!"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token",""))')
check "operator blocked from pricing" 403 "$API/api/pricing/competitors" -H "x-api-key: $OP"
check "operator blocked from team"    403 "$API/api/team"                -H "x-api-key: $OP"
check "no key is rejected"            401 "$API/api/offers"

echo
echo "cleanup offer $OFFER"
python3 - "$OFFER" <<'PY'
import sqlite3, sys, pathlib
oid = sys.argv[1]
db = pathlib.Path(__file__).resolve().parent.parent / "data" / "tradein.db" if False else pathlib.Path("data/tradein.db")
if not db.exists(): db = pathlib.Path(__file__).resolve().parent.parent / "data" / "tradein.db"
c = sqlite3.connect(db)
c.execute("DELETE FROM sales WHERE inventory_id IN (SELECT id FROM inventory WHERE offer_item_id IN (SELECT id FROM offer_items WHERE offer_id=?))", (oid,))
c.execute("DELETE FROM inventory WHERE offer_item_id IN (SELECT id FROM offer_items WHERE offer_id=?)", (oid,))
c.execute("DELETE FROM invoices WHERE offer_id=?", (oid,))
c.execute("DELETE FROM offer_items WHERE offer_id=?", (oid,))
c.execute("DELETE FROM offers WHERE id=?", (oid,))
c.execute("DELETE FROM customers WHERE email='smoke@techgenius.test'")
c.execute("DELETE FROM abandoned_leads WHERE email='smoke.lead@techgenius.test'")
c.execute("DELETE FROM activity_log WHERE entity_id=?", (oid,))
# Side-effect tables too, or the notification bell keeps pointing at an offer
# that no longer exists.
for tbl in ("notifications", "email_outbox", "crm_outbox", "uploads"):
    try:
        c.execute(f"DELETE FROM {tbl} WHERE offer_id=?", (oid,))
    except sqlite3.OperationalError:
        pass
c.commit(); c.close(); print("  cleaned")
PY

echo
echo "=================================================="
echo "PASS: $PASS   FAIL: $FAIL"
for f in "${FAILED[@]:-}"; do [ -n "$f" ] && echo "   ✗ $f"; done
echo "=================================================="
exit $([ "$FAIL" -eq 0 ] && echo 0 || echo 1)
