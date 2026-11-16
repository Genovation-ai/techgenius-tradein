"""Deep workflow test (printing, quotes, tenant isolation, repairs, admin) against a LOCAL instance.

Start the server with TG_API_KEY=local-test-key TG_CRON_SECRET=local-cron-secret on a COPY of the db, then:
  python3 scripts/deep_workflow_test.py http://localhost:4199 /path/to/copy/tradein.db
"""
import json, sys, urllib.request, urllib.error, time

API = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4199"
MASTER = "local-test-key"
CRON = "local-cron-secret"
results = []


def call(method, path, body=None, key=None, headers=None, raw=False):
    h = {"content-type": "application/json"}
    if key:
        h["x-api-key"] = key
    if headers:
        h.update(headers)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            txt = r.read().decode("utf-8", "replace")
            code = r.status
    except urllib.error.HTTPError as e:
        txt = e.read().decode("utf-8", "replace")
        code = e.code
    if raw:
        return code, txt
    try:
        return code, json.loads(txt)
    except Exception:
        return code, txt


def check(section, label, ok, detail=""):
    results.append((section, label, bool(ok), detail))
    print(f"  {'ok  ' if ok else 'FAIL'}  [{section}] {label}  {detail}")


XSS = '<img src=x onerror=alert(1)>'

# ---------- A. mail-in loop with printing ----------
S = "A print"
code, devs = call("GET", "/api/catalog/devices?limit=400&category_id=smartphone")
dev = next(d for d in devs if d["id"] == "iphone-15") if any(d["id"] == "iphone-15" for d in devs) else devs[0]
DEV, STO = dev["id"], dev["storages"][0]
code, offer = call("POST", "/api/widget/submit", {
    "contact": {"first_name": XSS, "last_name": "O'Brien", "email": "deep@test.invalid", "phone": "9055550100"},
    "offer_type": "mail-in", "payout_method": "etransfer",
    "items": [{"device_id": DEV, "device_name": f"Phone {XSS}", "storage": STO,
               "condition_grade": "good", "quoted_price": 999999}]})
OID = offer.get("id") if isinstance(offer, dict) else None
check(S, "widget submit (mail-in)", code in (200, 201) and OID, f"{code} {OID}")
code, od = call("GET", f"/api/offers/{OID}", key=MASTER)
item = od["items"][0]
check(S, "client quoted_price ignored, server re-priced", item["quoted_price"] < 5000, f"stored {item['quoted_price']}")
code, lab = call("POST", f"/api/offers/{OID}/shipping-label", {"courier": "Canada Post"}, key=MASTER)
check(S, "generate shipping label", code == 200 and lab.get("tracking_number"), f"{code} {lab.get('tracking_number') if isinstance(lab, dict) else lab}")
code, html = call("GET", f"/api/offers/{OID}/shipping-label", key=MASTER, raw=True)
check(S, "label print page renders", code == 200 and "Print label" in html and OID in html, f"{code} {len(html)}b")
check(S, "label print page escapes customer input", XSS not in html, "raw markup present" if XSS in html else "escaped")
check(S, "label page has a ship-to address", "No shipping address set" not in html, "company_address missing in settings" if "No shipping address set" in html else "")
for st in ["in_transit", "delivered", "being_inspected", "completed"]:
    code, r = call("PATCH", f"/api/offers/{OID}/status", {"status": st}, key=MASTER)
    check(S, f"status -> {st}", code == 200, str(code))
code, od = call("GET", f"/api/offers/{OID}", key=MASTER)
INV = (od.get("invoice") or {}).get("id")
check(S, "invoice auto-issued on completion", bool(INV), str(INV))
code, inv = call("GET", f"/api/invoices/{INV}", key=MASTER)
check(S, "invoice amount equals offer total", code == 200 and abs(inv["amount"] - od["total_value"]) < 0.01, f"{inv.get('amount')} vs {od.get('total_value')}")
code, html = call("GET", f"/api/invoices/{INV}/print", key=MASTER, raw=True)
check(S, "invoice print page renders", code == 200 and "Total payout" in html, f"{code} {len(html)}b")
check(S, "invoice print page escapes customer input", XSS not in html, "RAW <img onerror> in page" if XSS in html else "escaped")
code, r = call("POST", f"/api/invoices/from-offer/{OID}", {}, key=MASTER)
check(S, "duplicate invoice refused", code == 409, str(code))
code, r = call("PATCH", f"/api/payouts/{OID}", {"payout_status": "paid"}, key=MASTER)
check(S, "payout -> paid", code == 200, str(code))
code, inv = call("GET", f"/api/invoices/{INV}", key=MASTER)
check(S, "invoice marked paid with payout", inv.get("status") == "paid", inv.get("status"))
code, r = call("PATCH", f"/api/payouts/{OID}", {"payout_status": "banana"}, key=MASTER)
check(S, "bad payout status refused", code == 400, str(code))
code, r = call("GET", f"/api/widget/offers/{OID}", raw=True)
check(S, "public tracker does not leak contact", "deep@test.invalid" not in r, f"{code}")

# ---------- B. quote behaviour ----------
S = "B quote"
def q(**kw):
    b = {"device_id": DEV, "storage": STO, "condition_grade": "flawless"}
    b.update(kw)
    return call("POST", "/api/quote", b)
code, base = q()
check(S, "base quote", code == 200, f"{base.get('quoted_price')} vs competitor {base.get('competitor_price')} ({base.get('price_source')}/{base.get('price_mode')})")
if base.get("competitor_price"):
    check(S, "beat mode quote is below competitor", base["quoted_price"] < base["competitor_price"] or base["price_mode"] != "beat", f"{base['quoted_price']} < {base['competitor_price']}")
code, boosted = q(carrier="Unlocked", payout_method="store-credit", promo_code="WELCOME10")
check(S, "unlocked+store-credit+promo never exceeds competitor", not boosted.get("competitor_price") or boosted["quoted_price"] <= boosted["competitor_price"], f"{boosted.get('quoted_price')} <= {boosted.get('competitor_price')}")
code, b1 = q(battery_health=70)
code, b2 = q(battery_health="70")
check(S, "battery health as string == as number", b1.get("quoted_price") == b2.get("quoted_price") and b1["quoted_price"] < base["quoted_price"], f"{b1.get('quoted_price')} / {b2.get('quoted_price')} / base {base.get('quoted_price')}")
prev = None; mono = True; ladder = []
for g in ["flawless", "good", "average", "fair", "defective"]:
    code, r = q(condition_grade=g)
    p = r.get("quoted_price") if code == 200 else None
    ladder.append(p)
    if p is not None and prev is not None and p > prev: mono = False
    if p is not None: prev = p
check(S, "grade ladder never rises as condition worsens", mono, str(ladder))
code, r = call("POST", "/api/quote", {"device_id": DEV})
check(S, "missing fields -> 400", code == 400, str(code))
code, r = q(device_id="no-such-device")
check(S, "unknown device -> 404", code == 404, str(code))
code, r = q(condition_grade="'; DROP TABLE prices;--")
check(S, "hostile grade handled", code in (200, 400, 404), str(code))
code, r = q(battery_health=-50)
check(S, "negative battery does not crash", code == 200, str(code))

# ---------- C. tenant isolation ----------
S = "C tenant"
slug = f"deeptest{int(time.time())}"
code, su = call("POST", "/api/saas/signup", {"company_name": "Deep Test Shop", "slug": slug,
    "admin_name": "T", "email": f"{slug}@test.invalid", "password": "Str0ng-Passw0rd!x"})
check(S, "public signup creates a tenant", code == 201, f"{code} {su if code != 201 else su['org']['id']}")
B = su.get("token") if isinstance(su, dict) else None
if B:
    code, r = call("GET", f"/api/offers/{OID}", key=B)
    check(S, "other tenant cannot read our offer", code == 404, str(code))
    code, r = call("GET", f"/api/offers/{OID}/shipping-label", key=B, raw=True)
    check(S, "other tenant cannot print our label", code in (403, 404), f"{code} leaks={'deep@test.invalid' in r}")
    code, r = call("GET", f"/api/invoices/{INV}/print", key=B, raw=True)
    check(S, "other tenant cannot print our invoice", code in (403, 404), f"{code} leaks={'deep@test.invalid' in r}")
    code, r = call("GET", f"/api/offers/{OID}/history", key=B, raw=True)
    check(S, "other tenant cannot read our offer history", code in (403, 404) or r.strip() == "[]", f"{code} {len(r)}b")
    code, r = call("PATCH", f"/api/offers/{OID}/status", {"status": "cancelled"}, key=B)
    c2, od2 = call("GET", f"/api/offers/{OID}", key=MASTER)
    check(S, "other tenant cannot change our offer status", od2["status"] == "completed", f"{code} status now {od2['status']}")
    if od2["status"] != "completed":
        call("PATCH", f"/api/offers/{OID}/status", {"status": "completed"}, key=MASTER)
    code, r = call("PATCH", f"/api/offers/{OID}", {"notes": "pwned"}, key=B)
    c2, od2 = call("GET", f"/api/offers/{OID}", key=MASTER)
    check(S, "other tenant cannot edit our offer", od2.get("notes") != "pwned", f"{code}")
    code, r = call("PATCH", f"/api/payouts/{OID}", {"payout_status": "failed"}, key=B)
    c2, od2 = call("GET", f"/api/offers/{OID}", key=MASTER)
    check(S, "other tenant cannot change our payout", od2.get("payout_status") == "paid", f"{code} now {od2.get('payout_status')}")
    code, r = call("PATCH", f"/api/invoices/{INV}", {"status": "void"}, key=B)
    c2, inv2 = call("GET", f"/api/invoices/{INV}", key=MASTER)
    check(S, "other tenant cannot void our invoice", inv2.get("status") == "paid", f"{code} now {inv2.get('status')}")
    code, r = call("POST", f"/api/offers/{OID}/shipping-label", {"tracking_number": "HIJACK"}, key=B)
    c2, od2 = call("GET", f"/api/offers/{OID}", key=MASTER)
    check(S, "other tenant cannot rewrite our tracking", od2.get("tracking_number") != "HIJACK", f"{code}")
    iid = od["items"][0]["id"]
    code, r = call("PATCH", f"/api/offers/{OID}/items/{iid}/regrade", {"condition_grade": "flawless", "price": 9999}, key=B)
    c2, od2 = call("GET", f"/api/offers/{OID}", key=MASTER)
    check(S, "other tenant cannot regrade our item", od2["items"][0].get("final_price") != 9999 and od2["total_value"] < 9000, f"{code} total {od2['total_value']}")
    # shared global tables
    code, before = call("GET", "/api/pricing/frontend-source", key=MASTER)
    code, r = call("PUT", "/api/pricing/frontend-source", {"mode": "match", "beat_percent": 0}, key=B)
    c2, after = call("GET", "/api/pricing/frontend-source", key=MASTER)
    check(S, "other tenant cannot change the shop's pricing rule", after == before, f"{code} {before} -> {after}")
    call("PUT", "/api/pricing/frontend-source", {"source": before["source"], "mode": before["mode"], "beat_percent": before["beatPercent"]}, key=MASTER)
    code, r = call("PUT", "/api/pricing/", {"device_id": DEV, "storage": "ZZTEST", "condition_grade": "flawless", "base_price": 12345}, key=B)
    c2, rows = call("GET", f"/api/pricing/device/{DEV}", key=MASTER)
    leaked = any(x["storage"] == "ZZTEST" for x in rows)
    check(S, "other tenant cannot write the shop's price table", not leaked, f"{code}")
    code, r = call("POST", "/api/pricing/adjustments", {"adjust_percent": 50}, key=B)
    c2, adj = call("GET", "/api/pricing/adjustments", key=MASTER)
    bad = [a for a in adj if a.get("adjust_percent") == 50]
    check(S, "other tenant cannot add a global +50% adjustment", not bad, f"{code}")
    for a in bad: call("DELETE", f"/api/pricing/adjustments/{a['id']}", key=MASTER)
    code, sb = call("GET", "/api/settings", key=MASTER)
    code, r = call("PUT", "/api/settings", {"company_address": "1 Attacker St"}, key=B)
    c2, sa = call("GET", "/api/settings", key=MASTER)
    def addr(s): return (s.get("company_address") if isinstance(s, dict) else None)
    check(S, "other tenant cannot change the shop's settings", addr(sa) == addr(sb), f"{code} {addr(sb)!r} -> {addr(sa)!r}")
    code, r = call("GET", "/api/customers", key=B)
    check(S, "other tenant sees none of our customers", code == 200 and "deep@test.invalid" not in json.dumps(r), str(code))
    code, r = call("POST", "/api/scraper/run", {}, key=B)
    check(S, "scraper run (shared) reachable by tenant?", True, f"info: {code}")

# ---------- D. repairs ----------
S = "D repair"
code, probs = call("GET", f"/api/repair/problems?device_id={DEV}")
plist = probs if isinstance(probs, list) else probs.get("problems", []) if isinstance(probs, dict) else []
check(S, "problem list", code == 200 and len(plist) > 0, f"{code} n={len(plist)}")
if plist:
    pid = plist[0].get("id") or plist[0].get("key") or plist[0].get("problem")
    code, rq = call("POST", "/api/repair/quote", {"device_id": DEV, "problem": pid})
    check(S, "repair quote", code == 200, f"{code} {json.dumps(rq)[:120]}")
    code, bk = call("POST", "/api/repair/book", {"contact": {"first_name": "Deep", "email": "deep@test.invalid"}, "device_id": DEV, "problem": pid})
    check(S, "repair booking", code == 201, f"{code} {json.dumps(bk)[:100]}")
    if code == 201:
        RID = bk["id"]
        code, tr = call("GET", f"/api/repair/{RID}")
        check(S, "repair tracker", code == 200, str(code))
        code, r = call("GET", "/api/repairs", key=MASTER)
        check(S, "repairs admin list", code == 200, str(code))
        code, r = call("PATCH", f"/api/repairs/{RID}/status", {"status": "in_progress"}, key=MASTER)
        check(S, "repair status change", code in (200, 400), f"{code} {json.dumps(r)[:90]}")
code, r = call("GET", "/api/repairs/pricing", key=MASTER)
check(S, "repair pricing admin", code == 200, str(code))
code, r = call("GET", "/api/repairs/pricing/market/status", key=MASTER)
check(S, "repair market status", code == 200, str(code))

# ---------- E. everything else ----------
S = "E admin"
for label, path in [("cron health", "/api/cron/health")]:
    code, r = call("GET", path, headers={"x-cron-secret": CRON})
    check(S, label, code == 200, str(code))
code, r = call("GET", "/api/cron/health")
check(S, "cron without secret refused", code in (401, 403), str(code))
code, r = call("POST", "/api/cron/train", headers={"x-cron-secret": CRON})
check(S, "cron train", code == 200, f"{code} {json.dumps(r)[:90]}")
code, r = call("POST", "/api/pricing-engine/quote", {"device_id": DEV, "storage": STO, "condition": "good"}, key=MASTER)
check(S, "pricing-engine quote", code == 200, f"{code} {json.dumps(r)[:110]}")
code, r = call("GET", "/api/pricing-engine/baselines", key=MASTER)
check(S, "pricing-engine baselines", code == 200, str(code))
code, r = call("GET", f"/api/pricing/competitors/matrix?product_id={DEV}&variant={STO}", key=MASTER)
check(S, "competitor matrix", code == 200 and r.get("matrix"), f"{code} sources={list((r.get('matrix') or {}).keys())}")
code, r = call("GET", "/api/pricing/freshness", key=MASTER)
check(S, "pricing freshness", code == 200, f"{code} stale={r.get('stale')}")
code, r = call("PUT", "/api/pricing/frontend-source", {"beat_percent": "abc"}, key=MASTER)
check(S, "beat_percent garbage refused", code == 400, str(code))
code, r = call("PUT", "/api/pricing/frontend-source", {"beat_percent": 99}, key=MASTER)
check(S, "beat_percent out of range refused", code == 400, str(code))
code, r = call("PUT", "/api/pricing/frontend-source", {"source": "ebay"}, key=MASTER)
check(S, "unknown price source refused", code == 400, str(code))
code, r = call("PUT", "/api/pricing/", {"device_id": DEV, "storage": STO, "condition_grade": "flawless", "base_price": -500}, key=MASTER)
c2, rows = call("GET", f"/api/pricing/device/{DEV}", key=MASTER)
neg = [x for x in rows if x["base_price"] < 0]
check(S, "negative price refused", code == 400 and not neg, f"{code} negative rows={len(neg)}")
code, r = call("PUT", "/api/pricing/", {"device_id": DEV, "storage": STO, "condition_grade": "flawless", "base_price": "abc"}, key=MASTER)
check(S, "non-numeric price refused (not 500)", code == 400, f"{code} {json.dumps(r)[:80]}")
code, r = call("POST", "/api/pricing/adjustments", {"adjust_percent": "abc"}, key=MASTER)
check(S, "non-numeric adjustment refused", code == 400, f"{code}")
code, r = call("POST", "/api/pricing/bulk", {}, key=MASTER)
check(S, "bulk prices without body -> 400 not 500", code == 400, f"{code}")
code, lg = call("POST", "/api/auth/login", {"email": "admin@techgenius.ca", "password": "TechGenius2026!"})
code, r = call("GET", "/api/auth/me", key=lg.get("token"))
check(S, "login + auth me", code == 200, str(code))
code, r = call("POST", "/api/auth/login", {"email": "admin@techgenius.ca", "password": "wrong"})
check(S, "bad login refused", code == 401, str(code))
code, r = call("POST", "/api/auth/forgot-password", {"email": "nobody@test.invalid"})
check(S, "forgot-password does not reveal accounts", code == 200, str(code))
code, r = call("GET", "/api/saas/plans")
check(S, "saas plans", code == 200, str(code))
code, r = call("GET", "/api/saas/slug-available?slug=tech-genius")
check(S, "slug availability", code == 200, json.dumps(r)[:60])
code, r = call("GET", "/api/saas/usage", key=MASTER)
check(S, "saas usage", code == 200, str(code))
code, r = call("GET", "/api/saas/billing/status", key=MASTER)
check(S, "billing status", code == 200, json.dumps(r)[:100])
code, r = call("GET", "/api/offers/shipping/status", key=MASTER)
check(S, "shipping readiness", code == 200, json.dumps(r)[:120])
code, r = call("GET", "/api/integrations/backups", key=MASTER)
check(S, "backups list", code == 200, json.dumps(r)[:90])
code, r = call("GET", "/api/integrations/email/outbox", key=MASTER)
check(S, "email outbox", code == 200, str(code))
code, r = call("GET", "/api/integrations/crm/outbox", key=MASTER)
check(S, "crm outbox", code == 200, str(code))
code, r = call("GET", "/api/scraper/status", key=MASTER)
check(S, "scraper status", code == 200, json.dumps(r)[:100])
code, r = call("GET", "/api/notifications", key=MASTER)
check(S, "notifications list", code == 200, str(code))
code, r = call("GET", "/api/catalog/conditions")
check(S, "catalog conditions", code == 200, str(code))
code, r = call("POST", "/api/uploads", {"filename": "x.exe", "mime_type": "application/x-msdownload", "content_base64": "AAAA"}, key=MASTER)
check(S, "executable upload refused", code == 400, str(code))
code, r = call("POST", "/api/settings/promos", {"code": "DEEPTEST5", "discount_percent": 5}, key=MASTER)
check(S, "promo create", code in (200, 201), f"{code} {json.dumps(r)[:80]}")
code, r = call("POST", "/api/customers", {"first_name": "Deep", "last_name": "Cust", "email": "deepcust@test.invalid"}, key=MASTER)
check(S, "customer create", code in (200, 201), str(code))
code, invs = call("GET", "/api/inventory", key=MASTER)
rows = invs if isinstance(invs, list) else invs.get("rows", [])
import sqlite3
_db = sqlite3.connect(sys.argv[2]) if len(sys.argv) > 2 else None
ids = {x[0] for x in _db.execute("select i.id from inventory i join offer_items oi on oi.id=i.offer_item_id where oi.offer_id=?", (OID,))} if _db else set()
mine = [r for r in rows if r.get("id") in ids]
check(S, "completed offer landed in inventory", len(mine) >= 1, f"n={len(mine)}")
if mine:
    code, r = call("POST", f"/api/inventory/{mine[0]['id']}/sell", {"sell_price": 500}, key=MASTER)
    check(S, "inventory sell", code == 201, str(code))
    code, r = call("POST", f"/api/inventory/{mine[0]['id']}/sell", {"sell_price": 500}, key=MASTER)
    check(S, "double sell refused", code == 409, str(code))
code, r = call("POST", "/api/offers/handoff", {"contact": {"first_name": "Walk", "last_name": "In"}, "items": [{"device_id": DEV, "storage": STO, "condition_grade": "good"}]}, key=MASTER)
check(S, "staff hand-off offer", code in (200, 201), f"{code} {json.dumps(r)[:90]}")
code, r = call("POST", "/api/bulk/quote", {"items": [{"device_name": "iPhone 13", "storage": "128GB", "condition_grade": "good", "quantity": 3}]}, key=MASTER)
check(S, "bulk quote", code == 200, json.dumps(r)[:110])
code, r = call("GET", "/api/reports/summary", key=MASTER)
check(S, "reports summary", code == 200, str(code))
code, r = call("GET", "/admin/", raw=True)
check(S, "admin SPA served", code == 200 and "<html" in r.lower(), f"{code} {len(r)}b")

fails = [r for r in results if not r[2]]
print(f"\nTOTAL {len(results)}  PASS {len(results)-len(fails)}  FAIL {len(fails)}")
for f in fails:
    print(f"  FAIL [{f[0]}] {f[1]} :: {f[3]}")
