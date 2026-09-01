/**
 * CLI: sync exact per-storage GoRecell prices for the full catalog.
 *
 *   npx tsx scripts/sync_gorecell_catalog_prices.ts
 *   npx tsx scripts/sync_gorecell_catalog_prices.ts --limit 20
 *   npx tsx scripts/sync_gorecell_catalog_prices.ts --filter iphone-15
 */
import { syncGorecellCatalogPrices } from "../src/services/catalogPriceSync.js";

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return undefined;
}

const limit = Number(argValue("--limit") || 0) || undefined;
const filter = argValue("--filter");
const delayMs = Number(argValue("--delay") || 120);
const matchOnly = process.argv.includes("--match-only");

console.log("GoRecell full-catalog price sync starting…", { limit, filter, delayMs, matchOnly });

const result = await syncGorecellCatalogPrices({
  limit,
  deviceFilter: filter,
  delayMs,
  applyBeat: !matchOnly,
  beatPercent: 2,
  setFrontend: true,
  onProgress: (p) => {
    if (p.done % 10 === 0 || !p.ok || p.done === p.total) {
      console.log(`  [${p.done}/${p.total}] ${p.deviceId} ${p.ok ? "✓" : "✗"}`);
    }
  },
});

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
