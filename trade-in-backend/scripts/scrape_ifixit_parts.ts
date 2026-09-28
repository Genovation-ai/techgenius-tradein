/**
 * Fill the gaps MobileSentrix leaves, using iFixit's own device→parts map.
 *
 * Run after scripts/scrape_sentrix_prices.ts. Reads the file that wrote,
 * works only on devices it left unpriced, and appends to the same file — so
 * the seeded config carries both sources and the better one keeps its row.
 *
 *   npx tsx scripts/scrape_ifixit_parts.ts [--api URL] [--delay MS]
 */
import fs from "node:fs";
import path from "node:path";
import {
  IFIXIT_SOURCE,
  isThePart,
  partShelves,
  readProduct,
  resolveWiki,
  slugsIn,
} from "../src/services/repairMarketIfixit.js";
import { isPlausiblePrice } from "../src/services/repairMarketSentrix.js";

const arg = (flag: string, fallback: string) => {
  const i = process.argv.indexOf(flag);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const API = arg("--api", "https://reclaim-hq.up.railway.app");
const DELAY = Number(arg("--delay", "350"));
const OUT = path.resolve("config/repair-market-prices.json");

interface Row {
  source: string; device_id: string; problem: string; product_title: string;
  price: number; currency: string; price_cad: number; fx_rate: number;
  source_url: string; scraped_at: string; in_stock: number | null; alternatives: number;
}

async function getText(url: string): Promise<string> {
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/122 Safari/537.36", "Accept-Language": "en-CA,en;q=0.9" },
      redirect: "follow", signal: AbortSignal.timeout(25_000),
    });
    return r.ok ? await r.text() : "";
  } catch { return ""; }
}

async function main() {
  const existing: Row[] = fs.existsSync(OUT) ? (JSON.parse(fs.readFileSync(OUT, "utf8")) as Row[]) : [];
  // Per device AND part. A phone whose battery is priced and whose screen is
  // not is still worth visiting — skipping it because it has "a price" is how
  // most of the catalogue would stay half-filled.
  const priced = new Set(existing.map((r) => `${r.device_id}|${r.problem}`));
  const devicesSeen = new Set(existing.map((r) => r.device_id));
  console.log(`already priced: ${existing.length} rows across ${devicesSeen.size} devices`);

  const res = await fetch(`${API}/api/catalog/devices?limit=2000`);
  const payload = (await res.json()) as { devices?: unknown } | unknown[];
  const devices = ((Array.isArray(payload) ? payload : payload.devices) as Array<{
    id: string; name: string; enabled?: number | boolean;
  }>).filter((d) => d.enabled !== 0 && d.enabled !== false);
  console.log(`devices in catalogue: ${devices.length}\n`);

  const rows: Row[] = [];
  const now = new Date().toISOString();
  let resolved = 0;

  for (let i = 0; i < devices.length; i++) {
    const dev = devices[i];
    const wiki = await resolveWiki(dev.name);
    await new Promise((r) => setTimeout(r, DELAY));
    if (!wiki) continue;
    resolved++;
    for (const shelf of await partShelves(wiki)) {
      if (priced.has(`${dev.id}|${shelf.problem}`)) continue;
      await new Promise((r) => setTimeout(r, DELAY));
      const slugs = slugsIn(await getText(shelf.url));
      for (const slug of slugs.slice(0, 3)) {
        await new Promise((r) => setTimeout(r, DELAY));
        const p = await readProduct(slug);
        if (!p || p.currency !== "CAD") continue;
        if (!isThePart(shelf.problem, p.title)) continue;
        if (!isPlausiblePrice(shelf.problem, p.price)) continue;
        priced.add(`${dev.id}|${shelf.problem}`);
        rows.push({
          source: IFIXIT_SOURCE, device_id: dev.id, problem: shelf.problem, product_title: p.title,
          price: p.price, currency: p.currency, price_cad: Math.round(p.price * 100) / 100, fx_rate: 1,
          source_url: p.url, scraped_at: now, in_stock: null, alternatives: slugs.length,
        });
        break;
      }
    }
    if ((i + 1) % 10 === 0 || i === devices.length - 1) {
      fs.writeFileSync(OUT, JSON.stringify([...existing, ...rows], null, 1));
      console.log(`  ${i + 1}/${devices.length} devices · ${resolved} found at iFixit · ${rows.length} prices added`);
    }
  }

  fs.writeFileSync(OUT, JSON.stringify([...existing, ...rows], null, 1));
  console.log(`\nadded ${rows.length} iFixit prices across ${new Set(rows.map((r) => r.device_id)).size} devices`);
  console.log(`file now holds ${existing.length + rows.length} prices across ${new Set([...existing, ...rows].map((r) => r.device_id)).size} devices`);
}

void main();
