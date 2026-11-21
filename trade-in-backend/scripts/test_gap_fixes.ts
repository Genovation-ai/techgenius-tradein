/**
 * Regression checks for the gaps closed in the 2026-11 review: client-priced
 * offers, public catalogue writes, photo uploads, promo values, store ids.
 * LOCAL instance only (it disables a device and creates offers).
 *
 *   MCP_URL=http://localhost:4199 MCP_KEY=<master> npx tsx scripts/test_gap_fixes.ts
 */
const BASE = process.env.MCP_URL || "http://localhost:4199";
const KEY = process.env.MCP_KEY!;
let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean, detail = "") => {
  cond ? pass++ : fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}  ${detail}`);
};
async function call(method: string, path: string, body?: unknown, auth = true) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(auth ? { "x-api-key": KEY } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json: any = {};
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: r.status, json, headers: r.headers };
}
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
).toString("base64");
const HTML = Buffer.from("<html><script>alert(1)</script></html>").toString("base64");

async function main() {
  console.log("== offers are priced on the server ==");
  const quote = await call("POST", "/api/quote", { device_id: "iphone-15", storage: "128GB", condition_grade: "good" }, false);
  const serverPrice = Number(quote.json.quoted_price ?? quote.json.quotedPrice ?? quote.json.price);
  const made = await call("POST", "/api/offers", {
    items: [{ device_id: "iphone-15", storage: "128GB", condition_grade: "good", quoted_price: 99999, device_name: "iPhone 15" }],
  });
  ok("client quoted_price ignored", made.status === 201 && made.json.total_value !== 99999 && made.json.total_value > 0, `${made.status} total=${made.json.total_value} quote=${serverPrice}`);
  ok("total equals the server quote", made.json.total_value === serverPrice);
  const noPrice = await call("POST", "/api/offers", { items: [{ device_name: "Mystery", quoted_price: 500 }] });
  ok("unpriceable item refused", noPrice.status === 400, String(noPrice.status));
  const badCust = await call("POST", "/api/offers", { customer_id: "nope", items: [{ device_id: "iphone-15", storage: "128GB", condition_grade: "good" }] });
  ok("unknown customer_id refused", badCust.status === 404, String(badCust.status));
  const offerRow = await call("GET", `/api/offers/${made.json.id}`);
  ok("store falls back to the main store", "tg-burlington" === (String(offerRow.json.store_id ?? offerRow.json.offer?.store_id)), String(offerRow.json.store_id ?? offerRow.json.offer?.store_id));
  const bogus = await call("POST", "/api/offers", { store_id: "someone-elses-store", items: [{ device_id: "iphone-15", storage: "128GB", condition_grade: "good" }] });
  const bogusRow = await call("GET", `/api/offers/${bogus.json.id}`);
  ok("foreign store_id not used", (bogusRow.json.store_id ?? bogusRow.json.offer?.store_id) === "tg-burlington");

  console.log("== public catalogue writes ==");
  await call("PUT", "/api/catalog/devices/apple-iphone-12-mini", { enabled: false });
  for (const path of ["/api/widget/ensure-device", "/api/catalog/devices/ensure"]) {
    const again = await call("POST", path, { name: "iPhone 12 mini" }, false);
    ok(`${path}: disabled device stays disabled`, again.status === 400, `${again.status} ${again.json.error ?? ""}`);
    const cat = await call("POST", path, { name: "Zorblax 9000 Pro", category_id: "made-up-category" }, false);
    ok(`${path}: unknown category refused`, cat.status === 400, String(cat.status));
  }
  const dev = await call("GET", "/api/catalog/devices?all=1");
  const list = (Array.isArray(dev.json) ? dev.json : dev.json.devices ?? []) as Array<{ id: string; enabled: number }>;
  ok("device not re-enabled", !list.some((d) => d.id === "apple-iphone-12-mini"));
  await call("PUT", "/api/catalog/devices/apple-iphone-12-mini", { enabled: true });

  console.log("== widget photos ==");
  const sub = await call("POST", "/api/widget/submit", {
    contact: { first_name: "Gap", last_name: "Test", email: "gap.test@example.com" },
    items: [{ device_id: "iphone-15", device_name: "iPhone 15", storage: "128GB", condition_grade: "good" }],
  }, false);
  ok("widget submit", sub.status === 201, String(sub.status));
  const fake = await call("POST", `/api/widget/offers/${sub.json.id}/media`, { files: [{ mime_type: "image/png", content_base64: HTML }] }, false);
  ok("HTML disguised as PNG dropped", fake.status === 201 && fake.json.count === 0, `count=${fake.json.count}`);
  const real = await call("POST", `/api/widget/offers/${sub.json.id}/media`, { files: [{ mime_type: "image/png", content_base64: PNG, angle: "front" }] }, false);
  ok("real PNG kept", real.json.count === 1, `count=${real.json.count}`);
  const many = Array.from({ length: 8 }, () => ({ mime_type: "image/png", content_base64: PNG }));
  await call("POST", `/api/widget/offers/${sub.json.id}/media`, { files: many }, false);
  const over = await call("POST", `/api/widget/offers/${sub.json.id}/media`, { files: many }, false);
  ok("photo cap per offer", over.status === 409, String(over.status));
  await call("PATCH", `/api/offers/${sub.json.id}/status`, { status: "in_transit" });
  const late = await call("POST", `/api/widget/offers/${sub.json.id}/media`, { files: [{ mime_type: "image/png", content_base64: PNG }] }, false);
  ok("no photos once the offer has moved on", late.status === 409, String(late.status));

  console.log("== admin uploads ==");
  const lie = await call("POST", "/api/uploads", { offer_id: made.json.id, mime_type: "image/jpeg", filename: "x.jpg", content_base64: HTML });
  ok("upload with mismatched bytes refused", lie.status === 400, String(lie.status));
  const up = await call("POST", "/api/uploads", { offer_id: made.json.id, mime_type: "image/png", filename: "x.png", content_base64: PNG });
  ok("valid upload accepted", up.status === 201, String(up.status));
  const missing = await call("POST", "/api/uploads", { offer_id: "TG-NOPE", mime_type: "image/png", filename: "x.png", content_base64: PNG });
  ok("upload to unknown offer refused", missing.status === 404, String(missing.status));

  console.log("== promos ==");
  ok("500% promo refused", (await call("POST", "/api/settings/promos", { code: "GAPHUGE", discount_percent: 500 })).status === 400);
  ok("text promo refused", (await call("POST", "/api/settings/promos", { code: "GAPTEXT", discount_amount: "abc" })).status === 400);
  ok("sane promo saved", (await call("POST", "/api/settings/promos", { code: "GAPOK", discount_percent: 5, active: 0 })).status < 300);

  console.log("== public repair routes are rate limited ==");
  const rp = await fetch(`${BASE}/api/repair/problems`, { headers: { "x-forwarded-for": "198.51.100.200" } });
  ok("limit header present", !!rp.headers.get("x-ratelimit-limit"), String(rp.headers.get("x-ratelimit-limit")));

  console.log(`\nPASS ${pass}  FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
