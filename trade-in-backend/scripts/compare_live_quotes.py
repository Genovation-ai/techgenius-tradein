"""Compare live quotes with a fresh competitor scrape.

Save the JSON from POST /api/cron/scrape as <dir>/live_scrape.json, then:
  python3 scripts/compare_live_quotes.py <dir>
"""
import json, sys, urllib.request, urllib.error

SCR = sys.argv[1]
API = "https://www.gadgetswap.store"
d = json.load(open(f"{SCR}/live_scrape.json"))

# competitor condition -> our store grade
C2S = {"excellent": "flawless", "good": "good", "fair": "average", "cracked": "fair", "broken": "defective"}
comp = {}  # (pid, variant, grade) -> {competitor: price}
for p in d["providerResults"]:
    for r in p["rows"]:
        g = C2S.get(r["condition"])
        if not g or not r.get("product_id"):
            continue
        comp.setdefault((r["product_id"], r["variant"], g), {})[r["competitor_name"]] = r["trade_in_price"]


def quote(pid, var, grade):
    body = json.dumps({"device_id": pid, "storage": var, "condition_grade": grade}).encode()
    req = urllib.request.Request(API + "/api/quote", data=body, method="POST", headers={"content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return {"error": e.code}


rows = []
for (pid, var, grade), cp in sorted(comp.items()):
    q = quote(pid, var, grade)
    ours = q.get("quoted_price")
    rows.append((pid, var, grade, ours, cp.get("gorecell"), cp.get("univercell"), cp.get("bell")))

order = ["flawless", "good", "average", "fair", "defective"]
rows.sort(key=lambda r: (r[0], r[1], order.index(r[2])))
print(f"{'device':22} {'stor':6} {'grade':9} {'OURS':>6} {'GoRecell':>9} {'UniverCell':>10} {'Bell(max)':>9}  vs best scraped")
over = under = 0
for pid, var, grade, ours, gr, uc, bl in rows:
    rivals = [x for x in (gr, uc) if x]  # Bell only publishes one max number, not per-grade
    best = max(rivals) if rivals else None
    if ours is None or best is None:
        flag = "n/a"
    else:
        diff = (ours - best) / best * 100
        flag = f"{diff:+.1f}%"
        if diff > 0.5: over += 1
        elif diff < -15: under += 1
    f = lambda v: f"{v:>6.0f}" if isinstance(v, (int, float)) else f"{'-':>6}"
    print(f"{pid[:22]:22} {var:6} {grade:9} {f(ours)} {f(gr):>9} {f(uc):>10} {f(bl) if grade == 'flawless' else '':>9}  {flag}")
print(f"\nrows {len(rows)} | above best scraped rival: {over} | more than 15% below best rival: {under}")
json.dump(rows, open(f"{SCR}/compare.json", "w"))
