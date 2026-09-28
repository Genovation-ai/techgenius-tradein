/**
 * Scrape MobileSentrix Canada's published part prices into config/.
 *
 * The deployment has no credential this machine can present, and the weekly
 * job only starts helping next week, so the first load of prices ships in the
 * repository the same way the GoRecell product map does: written here, seeded
 * on boot, refreshed in place by the weekly sync afterwards.
 *
 * Reads the catalogue over the public API rather than a database, so it can be
 * run from anywhere against whatever the deployment is actually serving.
 *
 *   npx tsx scripts/scrape_sentrix_prices.ts [--api URL] [--delay MS] [--per N]
 */
import fs from "node:fs";
import path from "node:path";
import {
  assignExclusively,
  findListings,
  gradeTier,
  isPlausiblePrice,
  loadSentrixProducts,
  norm,
  rankListings,
  readPrice,
  SENTRIX_PARTS,
  SENTRIX_SOURCE,
} from "../src/services/repairMarketSentrix.js";

const arg = (flag: string, fallback: string) => {
  const i = process.argv.indexOf(flag);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const API = arg("--api", "https://reclaim-hq.up.railway.app");
const DELAY = Number(arg("--delay", "500"));
const PER_PAIR = Number(arg("--per", "2"));
const OUT = path.resolve("config/repair-market-prices.json");

const BRAND_PREFIX =
  /^(apple|samsung|google|motorola|oneplus|lg|microsoft|sony|nintendo|valve|lenovo|asus|dell|hp|acer|meta|msi|razer|tcl|huawei|nothing|blackberry|alienware)-/;

interface Row {
  source: string;
  device_id: string;
  problem: string;
  product_title: string;
  price: number;
  currency: string;
  price_cad: number;
  fx_rate: number;
  source_url: string;
  scraped_at: string;
  in_stock: number;
  alternatives: number;
}

async function main() {
  const products = await loadSentrixProducts();
  if (!products) {
    console.error("Could not read the supplier's product list (it may be rate-limiting). Nothing written.");
    process.exit(1);
  }
  console.log(`products listed: ${products.length}`);

  const res = await fetch(`${API}/api/catalog/devices?limit=2000`);
  const payload = (await res.json()) as { devices?: unknown } | unknown[];
  const devices = ((Array.isArray(payload) ? payload : payload.devices) as Array<{
    id: string;
    name: string;
    brand_id?: string | null;
    enabled?: number | boolean;
  }>).filter((d) => d.enabled !== 0 && d.enabled !== false);
  console.log(`devices in catalogue: ${devices.length}`);

  const claims: Array<{ deviceId: string; deviceKey: string; problem: string; slug: string }> = [];
  for (const d of devices) {
    const key = norm(d.name).replace(BRAND_PREFIX, "");
    for (const problem of Object.keys(SENTRIX_PARTS))
      for (const slug of findListings(products, d.name, d.brand_id ?? null, problem))
        claims.push({ deviceId: d.id, deviceKey: key, problem, slug });
  }
  const assigned = assignExclusively(claims);

  const jobs: Array<{ deviceId: string; problem: string; slugs: string[]; total: number }> = [];
  for (const [deviceId, perProblem] of assigned)
    for (const [problem, slugs] of perProblem)
      jobs.push({ deviceId, problem, slugs: rankListings(slugs).slice(0, PER_PAIR), total: slugs.length });
  console.log(`device/part pairs matched: ${jobs.length} across ${assigned.size} devices`);
  console.log(`fetching up to ${jobs.reduce((a, j) => a + j.slugs.length, 0)} pages at ${DELAY}ms apart\n`);

  const rows: Row[] = [];
  const now = new Date().toISOString();
  let rejected = 0;
  let noPrice = 0;

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const found: Array<{ title: string; price: number; currency: string; inStock: boolean; url: string; tier: number }> = [];
    for (const slug of job.slugs) {
      const p = await readPrice(slug);
      if (!p) noPrice++;
      else if (!isPlausiblePrice(job.problem, p.price)) rejected++;
      else found.push({ ...p, tier: gradeTier(slug) });
      await new Promise((r) => setTimeout(r, DELAY));
    }
    if (found.length) {
      found.sort((a, b) => a.tier - b.tier || a.price - b.price);
      const best = found[0];
      rows.push({
        source: SENTRIX_SOURCE,
        device_id: job.deviceId,
        problem: job.problem,
        product_title: best.title,
        price: best.price,
        currency: best.currency,
        // Already Canadian: nothing converted, so the recorded rate is 1.
        price_cad: Math.round(best.price * 100) / 100,
        fx_rate: 1,
        source_url: best.url,
        scraped_at: now,
        in_stock: best.inStock ? 1 : 0,
        alternatives: job.total,
      });
    }
    if ((i + 1) % 25 === 0 || i === jobs.length - 1) {
      fs.writeFileSync(OUT, JSON.stringify(rows, null, 1));
      console.log(`  ${i + 1}/${jobs.length} pairs · ${rows.length} priced · ${rejected} implausible · ${noPrice} no price`);
    }
  }

  fs.writeFileSync(OUT, JSON.stringify(rows, null, 1));
  console.log(`\nwrote ${rows.length} prices across ${new Set(rows.map((r) => r.device_id)).size} devices to ${OUT}`);
  if (rows.length === 0) console.error("Nothing priced — the supplier was most likely rate-limiting. Not shipping an empty file.");
}

void main();
