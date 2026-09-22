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

// What a product slug must contain to be this part. Matched against the
// store's own list of every product it sells (its sitemap), not guessed:
// "google-pixel-4a-battery-genuine" and "galaxy-a51-screen" are real slugs
// no pattern would have produced.
export const MARKET_PARTS: Record<string, { slugHas: RegExp; titleMust: RegExp }> = {
  screen: { slugHas: /-(screen|display|lcd|oled)\b/, titleMust: /\bscreen\b|\bdisplay\b|\blcd\b|\boled\b/i },
  battery: { slugHas: /-battery\b/, titleMust: /\bbattery\b/i },
  charging_port: { slugHas: /-(charging-port|charging-assembly|lightning-connector|usb-c-port|charge-port)\b/, titleMust: /\b(charging|lightning|usb-c|port|connector)\b/i },
  back_glass: { slugHas: /-(back-glass|rear-glass|back-cover|rear-cover|back-panel)\b/, titleMust: /\b(back|rear) (glass|cover|panel)\b/i },
  rear_camera: { slugHas: /-(rear-camera|back-camera|main-camera)\b/, titleMust: /\b(rear|back|main|wide) camera\b/i },
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
  let k = modelKey(deviceName).replace(/\s+/g, "-");
  // The store files the iPhone SE by the year it shipped, not its generation.
  // These are facts about the product, not guesses.
  k = k.replace(/^iphone-se-3rd-gen$/, "iphone-se-2022").replace(/^iphone-se-2nd-gen$/, "iphone-se-2020").replace(/^iphone-se-1st-gen$/, "iphone-se");
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

/**
 * Every product the store sells, by slug, read from its sitemap. Loaded once
 * per run and matched locally, so the run makes one request per real product
 * rather than several guesses per device. The Canadian sitemap is read too:
 * a slug present there is priced in CAD on its en-ca page, which is the
 * store's own Canadian price and needs no conversion.
 */
export async function loadProductIndex(): Promise<{ all: Set<string>; ca: Set<string> } | null> {
  const all = new Set<string>();
  const ca = new Set<string>();
  const files = ["products", "products_2", "products_3", "products_4", "products_en-ca"];
  for (const f of files) {
    const xml = await getText(`https://www.ifixit.com/sitemap/${f}.xml`);
    if (!xml || xml.status !== 200) continue;
    for (const m of xml.body.matchAll(/<loc>https:\/\/www\.ifixit\.com\/(en-ca\/)?products\/([^<]+)<\/loc>/g)) {
      (m[1] ? ca : all).add(m[2]);
    }
  }
  if (all.size < 1000) return null; // the sitemap did not come back whole; do not run on a partial list
  return { all, ca };
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

const VARIANT = /^(pro|plus|max|mini|ultra|fe|xl|a|e|lite|edge|fold|flip)(-|$)/;

/** Slugs in the index that are this exact model and this part. */
function candidateSlugs(index: { all: Set<string>; ca: Set<string> }, deviceName: string, problem: string): string[] {
  const spec = MARKET_PARTS[problem];
  const out: string[] = [];
  // A product can be in either sitemap or both; a Canadian-only listing is
  // still a listing.
  const every = new Set<string>([...index.all, ...index.ca]);
  for (const base of slugFor(deviceName)) {
    const prefix = base + "-";
    for (const slug of every) {
      if (!slug.startsWith(prefix)) continue;
      const rest = slug.slice(prefix.length);
      // "iphone-15-pro-screen" must not serve "iphone 15": the token after the
      // model may not be a variant word. A model code (a1566) or a year is fine.
      if (VARIANT.test(rest)) continue;
      if (!spec.slugHas.test(slug) || ACCESSORY.test(slug.replace(/-/g, " "))) continue;
      out.push(slug);
    }
  }
  // Prefer the plain part over kits and bundles, and the Canadian listing over
  // the converted one, then shorter slugs (the base product) first.
  return out.sort((a, b) => Number(index.ca.has(b)) - Number(index.ca.has(a)) || a.length - b.length);
}

async function findPart(
  index: { all: Set<string>; ca: Set<string> },
  deviceName: string,
  problem: string,
): Promise<Found | null> {
  const spec = MARKET_PARTS[problem];
  if (!spec) return null;
  for (const slug of candidateSlugs(index, deviceName, problem).slice(0, 4)) {
    const inCa = index.ca.has(slug);
    const url = `https://www.ifixit.com/${inCa ? "en-ca/" : ""}products/${slug}`;
    const page = await getText(url);
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
        if (!modelMatches(deviceName, name) || !spec.titleMust.test(name) || ACCESSORY.test(name)) continue;
        const off = Array.isArray(d.offers) ? d.offers[0] : d.offers;
        const price = Number(off?.price);
        if (Number.isFinite(price) && price > 0) {
          return { title: name, url, price, currency: off?.priceCurrency || (inCa ? "CAD" : "USD") };
        }
      } catch {
        /* not this block */
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
  const index = await loadProductIndex();
  if (!index) return { devices: 0, looked: 0, found: 0, fx, errors: ["Could not read the store's product list; nothing written"] };

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
        const part = await findPart(index, dev.name, problem);
        if (part) {
          // A Canadian listing is already in CAD and the rate recorded is 1;
          // a US one is converted at today's Bank of Canada rate.
          const native = part.currency === "CAD";
          const cad = native ? part.price : part.price * fx.rate;
          upsert.run(dev.id, problem, part.title, part.price, part.currency, Math.round(cad * 100) / 100, native ? 1 : fx.rate, part.url, now);
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
