/**
 * Check the scraped price file against the rules the code enforces, and drop
 * whatever no longer passes.
 *
 * The scrapers are long-running, so a filter tightened while one is in flight
 * leaves rows behind that the current rules would reject — a macro camera
 * quoted as "the back camera", say. This re-applies the rules to the finished
 * file, so what ships is provably what the code would accept today rather than
 * what it accepted an hour ago.
 *
 *   npx tsx scripts/verify_repair_prices.ts [--write]
 */
import fs from "node:fs";
import path from "node:path";
import { isPlausiblePrice, SENTRIX_PARTS, SENTRIX_SOURCE } from "../src/services/repairMarketSentrix.js";
import { IFIXIT_SOURCE, isThePart } from "../src/services/repairMarketIfixit.js";

const FILE = path.resolve("config/repair-market-prices.json");
const WRITE = process.argv.includes("--write");

interface Row {
  source: string; device_id: string; problem: string; product_title: string;
  price: number; currency: string; price_cad: number; fx_rate: number;
  source_url: string; scraped_at: string; in_stock?: number | null; alternatives?: number;
}

const rows: Row[] = JSON.parse(fs.readFileSync(FILE, "utf8"));
const keep: Row[] = [];
const dropped: Array<{ row: Row; why: string }> = [];

for (const r of rows) {
  const reject = (why: string) => dropped.push({ row: r, why });

  if (!(r.price_cad > 0)) { reject("no usable price"); continue; }
  if (r.currency !== "CAD" || r.fx_rate !== 1) { reject(`not a CAD-native price (${r.currency} @ ${r.fx_rate})`); continue; }
  if (!isPlausiblePrice(r.problem, r.price_cad)) { reject(`below the floor for ${r.problem}`); continue; }

  if (r.source === SENTRIX_SOURCE) {
    // The slug is in the URL, so the listing rules apply to it exactly.
    const slug = r.source_url.replace(/^https?:\/\/[^/]+\//, "");
    const spec = SENTRIX_PARTS[r.problem];
    if (!spec) { reject(`unknown part type ${r.problem}`); continue; }
    if (!spec.must.test(slug)) { reject("listing is not this part"); continue; }
    if (spec.not.test(slug)) { reject("listing is a trimming or a variant of this part"); continue; }
  } else if (r.source === IFIXIT_SOURCE) {
    if (!isThePart(r.problem, r.product_title)) { reject("product name is not this part"); continue; }
  } else {
    reject(`unknown source ${r.source}`);
    continue;
  }

  // One row per source, device and part — the table's unique key.
  if (keep.some((k) => k.source === r.source && k.device_id === r.device_id && k.problem === r.problem)) {
    reject("duplicate of a row already kept");
    continue;
  }
  keep.push(r);
}

const devices = new Set(keep.map((r) => r.device_id));
console.log(`checked ${rows.length} rows`);
console.log(`  keep    ${keep.length} across ${devices.size} devices`);
console.log(`  dropped ${dropped.length}`);
const why: Record<string, number> = {};
for (const d of dropped) why[d.why] = (why[d.why] || 0) + 1;
for (const [w, n] of Object.entries(why).sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(4)}  ${w}`);
for (const d of dropped.slice(0, 8)) console.log(`      e.g. ${d.row.device_id}/${d.row.problem}: ${d.row.product_title.slice(0, 64)}`);

const bySource: Record<string, { rows: number; devices: Set<string> }> = {};
for (const r of keep) {
  bySource[r.source] ??= { rows: 0, devices: new Set() };
  bySource[r.source].rows++;
  bySource[r.source].devices.add(r.device_id);
}
console.log("\nby source:");
for (const [s, v] of Object.entries(bySource)) console.log(`  ${s.padEnd(16)} ${v.rows} prices across ${v.devices.size} devices`);

if (WRITE) {
  fs.writeFileSync(FILE, JSON.stringify(keep, null, 1));
  console.log(`\nwrote ${keep.length} verified rows to ${FILE}`);
} else if (dropped.length) {
  console.log("\n(run with --write to drop them)");
}
