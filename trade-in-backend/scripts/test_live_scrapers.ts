/**
 * Live competitor scrape test — iPhone 15 / 128GB baseline.
 * Run: npx tsx scripts/test_live_scrapers.ts
 */
import { migrate } from "../src/db/migrate.js";
import { buildAdapters } from "../src/pricing-engine/orchestrator.js";
import type { ToScrape } from "../src/pricing-engine/types.js";

const TARGET: ToScrape = {
  productId: "iphone-15",
  make: "Apple",
  model: "iPhone 15",
  variant: "128GB",
  meta: { gorecellProductId: "9982" },
};

const REPAIR_URL = "https://univercell.ai/repair/mobile/apple/iphone-15";

async function fetchUnivercellRepairParts(): Promise<Array<{ name: string; price: string }>> {
  const res = await fetch(REPAIR_URL, {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html" },
  });
  const html = await res.text();
  const parts: Array<{ name: string; price: string }> = [];
  const idx = html.indexOf("repairOptions");
  if (idx >= 0) {
    const start = html.indexOf("[", idx);
    const end = html.indexOf("],", start);
    if (start >= 0 && end >= 0) {
      const raw = html.slice(start, end + 1).replace(/\\"/g, '"');
      try {
        const opts = JSON.parse(raw) as Array<{ name: string; price: string }>;
        for (const o of opts) parts.push({ name: o.name, price: o.price.replace(/^\$+/, "$") });
      } catch {
        /* fall through */
      }
    }
  }
  if (!parts.length) {
    for (const m of html.matchAll(
      /\\"name\\":\\"([^\\]+)\\"[^}]{0,120}\\"price\\":\\"([^\\]+)\\"/g,
    )) {
      parts.push({ name: m[1], price: m[2].replace(/^\$+/, "$") });
    }
  }
  return parts;
}

migrate();

async function main() {
  const providers = ["univercell", "bell", "telus", "gorecell"];
  const adapters = buildAdapters(providers);
  let failures = 0;

  console.log("\n=== Live trade-in scrape: iPhone 15 128GB ===\n");
  for (const adapter of adapters) {
    const result = await adapter.scrape([TARGET], { timeoutMs: 90_000 });
    console.log(`--- ${adapter.name} (${result.engine}) ---`);
    if (result.rows.length === 0) {
      console.log("  (no prices)");
      failures += 1;
      console.log("  ✗ expected prices from live market source");
    } else {
      for (const r of result.rows) {
        console.log(`  ${r.condition.padEnd(10)} $${r.trade_in_price} CAD  [${r.variant}]`);
      }
    }
    for (const e of result.errors) console.log(`  ! ${e}`);
    console.log("");
  }

  console.log("=== UniverCell repair parts (iPhone 15) — reference for repair cost deductions ===\n");
  const parts = await fetchUnivercellRepairParts();
  for (const p of parts) {
    console.log(`  ${p.name.padEnd(42)} ${p.price}`);
  }
  if (!parts.length) {
    failures += 1;
    console.log("  ✗ expected repair parts");
  }

  console.log("\n=== GoRecell repair note ===");
  console.log(
    "  GoRecell buyback prices come from product-page query_data (wc-query-flow).",
  );
  console.log(
    "  No public repair/part catalog — use UniverCell repair prices as comps.\n",
  );

  if (failures) {
    console.error(`FAILED with ${failures} issue(s)`);
    process.exit(1);
  }
  console.log("PASS — live scrape smoke\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
