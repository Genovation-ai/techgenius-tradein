import { getDb } from "../db/migrate.js";

/**
 * Real part prices for repairs, from a published source.
 *
 * The repair formula needs a part cost. The shop's own supplier has no public
 * price list, and every Canadian repair chain gates its prices behind a lead
 * form — reading those would mean submitting fake leads to competitors. iFixit
 * publishes part prices as structured data and has a public search API, so
 * that is the source: a real figure, with the product it came from, the
 * currency, the Bank of Canada rate used to convert it, and the day it was
 * read.
 *
 * Products are addressed by slug, not found by search. The search API returns
 * iFixit's informational Item wikis, which carry no price, and its top hit for
 * "iPhone 15 screen" is the 15 Pro's. A store slug — ipad-air-2-screen — names
 * the exact model, so a 404 is a miss and a 200 is the right part, and the
 * product's own name is checked against the model on top of that. A device
 * with no exact product gets no row. A wrong price is worse than none: it
 * becomes a quote, and the quote becomes a promise.
 */

const UA = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/122 Safari/537.36" };

// Not the part: fittings, tools and consumables whose names mention it. "Kit"
// is allowed — iFixit names the part itself "Screen … Replacement Kit".
const ACCESSORY = /\b(adhesive|gasket|strips?|tools?|template|screws?|cable|flex|bracket|sim|tray|foam|tape|protector|case|holder|clip|magnet)\b/i;

// The store's product slugs, by part. Built from the model rather than found
// by search: iFixit's search returns its informational Item wikis, which carry
// no price, and its top hit for "iPhone 15 screen" is the 15 Pro's. A slug
// names the exact model, so a 404 is a miss and a 200 is the right part.
export const MARKET_PARTS: Record<string, { slugs: string[]; titleMust: RegExp }> = {
  screen: { slugs: ["{m}-screen", "{m}-lcd-screen", "{m}-oled-screen"], titleMust: /\bscreen\b|\bdisplay\b|\blcd\b|\boled\b/i },
  battery: { slugs: ["{m}-battery", "{m}-replacement-battery"], titleMust: /\bbattery\b/i },
  charging_port: { slugs: ["{m}-charging-port", "{m}-lightning-connector", "{m}-usb-c-port", "{m}-charging-assembly"], titleMust: /\b(charging|lightning|usb-c|port|connector)\b/i },
  back_glass: { slugs: ["{m}-back-glass", "{m}-rear-glass", "{m}-back-cover", "{m}-rear-cover"], titleMust: /\b(back|rear) (glass|cover|panel)\b/i },
  rear_camera: { slugs: ["{m}-rear-camera", "{m}-back-camera", "{m}-main-camera"], titleMust: /\b(rear|back|main|wide) camera\b/i },
};

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * The catalogue's name, reduced to what a parts listing would call it.
 *
 * Ours say "Apple iPad Air 2", "Apple iPad mini Wi-Fi + Cellular", "Galaxy
 * A53 5G"; the store says "iPad Air 2", "iPad mini", "Galaxy A53". The brand
 * word, the radio, and the capacity are ours and never theirs.
 */
function modelKey(deviceName: string): string {
  return norm(
    deviceName
      .replace(/^\s*(apple|google|samsung|motorola|oneplus|lg)\s+/i, "")
      .replace(/\bwi-?fi\b|\bcellular\b|\blte\b|\b[45]g\b|\b\d+\s?gb\b|\+/gi, " ")
      .replace(/\(([^)]*)\)/g, " $1 "),
  );
}

/** "ipad air 2" -> "ipad-air-2"; Google's store slugs keep the brand. */
function slugFor(deviceName: string): string[] {
  const k = modelKey(deviceName).replace(/\s+/g, "-");
  const out = [k];
  if (/^pixel\b/.test(k)) out.push("google-" + k);
  if (/^galaxy\b/.test(k)) out.push("samsung-" + k);
  return out;
}

/** The product's name must still carry the model: "iphone 15" and not "iphone 15 pro". */
function modelMatches(deviceName: string, title: string): boolean {
  const d = modelKey(deviceName);
  const t = norm(title);
  if (!d || !t.includes(d)) return false;
  const after = t.slice(t.indexOf(d) + d.length).trim().split(" ")[0] || "";
  return !/^(pro|plus|max|mini|ultra|fe|xl|a|e|lite|edge|fold|flip)$/.test(after);
}

async function getText(url: string): Promise<{ status: number; body: string } | null> {
  try {
    const r = await fetch(url, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(25_000) });
    return { status: r.status, body: r.ok ? await r.text() : "" };
  } catch {
    return null;
  }
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(25_000) });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

export async function usdToCad(): Promise<{ rate: number; date: string } | null> {
  const d = await getJson<{ observations: Array<{ d: string; FXUSDCAD: { v: string } }> }>(
    "https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=1",
  );
  const o = d?.observations?.[d.observations.length - 1];
  if (!o) return null;
  const rate = Number(o.FXUSDCAD.v);
  return Number.isFinite(rate) && rate > 0 ? { rate, date: o.d } : null;
}

interface Found {
  title: string;
  url: string;
  price: number;
  currency: string;
}

async function findPart(deviceName: string, problem: string): Promise<Found | null> {
  const spec = MARKET_PARTS[problem];
  if (!spec) return null;
  for (const base of slugFor(deviceName)) {
    for (const pattern of spec.slugs) {
      const slug = pattern.replace("{m}", base);
      const page = await getText(`https://www.ifixit.com/products/${slug}`);
      if (!page || page.status !== 200 || !page.body) continue;
      const blocks = page.body.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
      for (const b of blocks) {
        try {
          const d = JSON.parse(b.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, "")) as {
            "@type"?: string;
            name?: string;
            offers?: { price?: string | number; priceCurrency?: string } | Array<{ price?: string | number; priceCurrency?: string }>;
          };
          if (d["@type"] !== "Product" && d["@type"] !== "ProductGroup") continue;
          const name = d.name || "";
          // The slug named the model; the product name must agree, and must be
          // the part rather than a kit of tools that mentions it.
          if (!modelMatches(deviceName, name) || !spec.titleMust.test(name) || ACCESSORY.test(name)) continue;
          const off = Array.isArray(d.offers) ? d.offers[0] : d.offers;
          const price = Number(off?.price);
          if (Number.isFinite(price) && price > 0) {
            return { title: name, url: `https://www.ifixit.com/products/${slug}`, price, currency: off?.priceCurrency || "USD" };
          }
        } catch {
          /* not this block */
        }
      }
    }
  }
  return null;
}

export interface MarketSyncResult {
  devices: number;
  looked: number;
  found: number;
  fx: { rate: number; date: string } | null;
  errors: string[];
}

/**
 * Read a part price for every device and every part type we can, and store
 * what is real. Rate-limited to be a polite reader of someone else's site.
 */
export async function syncRepairMarketPrices(opts: {
  delayMs?: number;
  onProgress?: (p: { done: number; total: number; device: string; found: number }) => void;
  categories?: string[];
} = {}): Promise<MarketSyncResult> {
  const fx = await usdToCad();
  if (!fx) return { devices: 0, looked: 0, found: 0, fx: null, errors: ["No FX rate from the Bank of Canada; nothing written"] };

  const db = getDb();
  const cats = opts.categories ?? ["smartphone", "tablet"];
  const devices = db
    .prepare(`SELECT id, name FROM devices WHERE enabled = 1 AND category_id IN (${cats.map(() => "?").join(",")}) ORDER BY name`)
    .all(...cats) as Array<{ id: string; name: string }>;
  const upsert = db.prepare(
    `INSERT INTO repair_market_prices (source, device_id, problem, product_title, price, currency, price_cad, fx_rate, source_url, scraped_at)
     VALUES ('ifixit', ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source, device_id, problem) DO UPDATE SET
       product_title = excluded.product_title, price = excluded.price, currency = excluded.currency,
       price_cad = excluded.price_cad, fx_rate = excluded.fx_rate, source_url = excluded.source_url,
       scraped_at = excluded.scraped_at`,
  );

  const delay = opts.delayMs ?? 400;
  const errors: string[] = [];
  let looked = 0;
  let found = 0;
  const now = new Date().toISOString();

  for (let i = 0; i < devices.length; i++) {
    const dev = devices[i];
    let foundHere = 0;
    for (const problem of Object.keys(MARKET_PARTS)) {
      looked++;
      try {
        const part = await findPart(dev.name, problem);
        if (part) {
          const cad = part.currency === "CAD" ? part.price : part.price * fx.rate;
          upsert.run(dev.id, problem, part.title, part.price, part.currency, Math.round(cad * 100) / 100, fx.rate, part.url, now);
          found++;
          foundHere++;
        }
      } catch (e) {
        errors.push(`${dev.id}/${problem}: ${e instanceof Error ? e.message : String(e)}`);
      }
      await new Promise((r) => setTimeout(r, delay));
    }
    opts.onProgress?.({ done: i + 1, total: devices.length, device: dev.id, found: foundHere });
  }
  db.close();
  return { devices: devices.length, looked, found, fx, errors: errors.slice(0, 20) };
}
