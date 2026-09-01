/**
 * Probe Bell catalog titles for our target devices + stress-test CORS proxy.
 * Run: npx tsx scripts/probe_bell_catalog.ts
 */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const SBE_BASE = "https://ws1-bell.sbeglobalcare.com/gc-ws-connect-1.9/rest/gcWsConnect/";

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function corsFetch(uri: string, auth = false, attempt = 1): Promise<unknown> {
  const params = auth
    ? new URLSearchParams({ key: "TradeIn_SBE", baseAddress: SBE_BASE, uri })
    : new URLSearchParams({ baseAddress: SBE_BASE, uri });
  const path = auth ? "CorsProxyAuthenticate" : "corsproxy";
  const res = await fetch(`https://www.bell.ca/ajax/toolbox/${path}?${params}`, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
      Referer: "https://www.bell.ca/Mobility/Trade-in-program",
    },
  });
  const raw = await res.text();
  const trimmed = raw.trim();
  if (!res.ok || trimmed.startsWith("<!") || trimmed.startsWith("<html")) {
    if (attempt < 4) {
      await sleep(400 * attempt * attempt);
      return corsFetch(uri, auth, attempt + 1);
    }
    throw new Error(`Bell proxy bad response HTTP ${res.status}: ${trimmed.slice(0, 80)}`);
  }
  try {
    return JSON.parse(JSON.parse(raw) as string);
  } catch {
    return JSON.parse(raw);
  }
}

const targets = [
  "iPhone 15 128GB",
  "iPhone 15 256GB",
  "iPhone 15 Pro 128GB",
  "iPhone 15 Pro Max 256GB",
  "iPhone 16 128GB",
  "Galaxy S24 Ultra 256GB",
  "Galaxy S25 Ultra 256GB",
  "Pixel 9 128GB",
  "Pixel 9 Pro 128GB",
];

async function main() {
  const auth = (await corsFetch("login?org_code={0}&entity_code={1}&username={2}&password={3}", true)) as {
    session_id?: string;
  };
  console.log("session", !!auth.session_id);
  const cat = (await corsFetch(
    `getCatalogProductsLite?session_id=${auth.session_id}&category_code=TRADEIN&view_manufacturer=true&view_references_type=WEB_TAG&cache=true`,
  )) as { products?: Array<{ product_code: string; product_title: string }> };
  const products = cat.products || [];
  console.log("catalog size", products.length);

  for (const t of targets) {
    const needle = t.toLowerCase();
    const hits = products.filter((p) => {
      const title = p.product_title.toLowerCase();
      return needle.split(" ").every((w) => title.includes(w.replace("gb", "gb")));
    });
    console.log("\nTARGET", t);
    for (const h of hits.slice(0, 8)) console.log(" ", h.product_code, h.product_title);
    if (!hits.length) {
      // fuzzy: show similar
      const soft = products
        .filter((p) => p.product_title.toLowerCase().includes(needle.split(" ")[0]!))
        .filter((p) => p.product_title.toLowerCase().includes(needle.split(" ")[1] || ""))
        .slice(0, 10);
      console.log("  (soft)", soft.map((s) => s.product_title));
    }
  }

  // Stress: 15 sequential estimates with delay
  const sample = products.find((p) => /iphone 15 128gb/i.test(p.product_title));
  if (sample) {
    console.log("\nStress estimates for", sample.product_title);
    let ok = 0;
    let fail = 0;
    for (let i = 0; i < 12; i++) {
      try {
        await sleep(350);
        const est = (await corsFetch(
          `getBuyBackProductsEstimate?session_id=${auth.session_id}&buyer_code=REDEEM&product_code=${sample.product_code}`,
        )) as { products?: Array<{ buyback_value_max?: number }> };
        const price = est.products?.[0]?.buyback_value_max;
        console.log(`  #${i + 1} $${price}`);
        ok += 1;
      } catch (e) {
        fail += 1;
        console.log(`  #${i + 1} FAIL`, e instanceof Error ? e.message : e);
      }
    }
    console.log(`stress ok=${ok} fail=${fail}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
