import { getDb } from "../db/migrate.js";
import { isPlausiblePrice } from "./repairMarketSentrix.js";

/**
 * Part prices from iFixit, asked for the way iFixit files them.
 *
 * The first version of this guessed product slugs from our device names —
 * "MacBook Air M2" became "macbook-air-m2-battery" — and iFixit calls that part
 * "macbook-air-13-a2681-2022-battery", keyed on a board number no name of ours
 * contains. So laptops, consoles, watches and tablets all missed, and the
 * source looked like it stocked nothing when it stocks plenty.
 *
 * iFixit will simply say which parts fit which device, so this asks:
 *
 *   search        our name          -> their device wiki
 *   wiki API      the wiki          -> parts.categories, tagged and linked
 *   category page a category        -> the product slugs in it
 *   product page  a slug            -> name, price, currency
 *
 * Nothing is inferred at any step; every edge is one iFixit published. The
 * Canadian storefront is read throughout, so prices come back in CAD already
 * and no exchange rate sits underneath them.
 */

const UA = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/122 Safari/537.36",
  "Accept-Language": "en-CA,en;q=0.9",
};

export const IFIXIT_SOURCE = "ifixit";

/**
 * Their shelf label, our problem id. Deliberately short: a tag has to mean one
 * repair unambiguously to appear here. "Case Components" holds back covers and
 * hinges and feet together, so it maps to nothing rather than to back_glass.
 */
export const TAG_TO_PROBLEM: Record<string, string> = {
  batteries: "battery",
  screens: "screen",
  displays: "screen",
  "charging ports": "charging_port",
  "rear cameras": "rear_camera",
  cameras: "rear_camera",
};

export function problemForTag(tag: string): string | null {
  return TAG_TO_PROBLEM[tag.trim().toLowerCase()] ?? null;
}

/**
 * What the product itself must be, once the shelf has narrowed it. The shelf
 * is right about fitment and vague about function: Surface Pro 9's "Cameras"
 * holds a "Camera and Wi-Fi Deck", which is a motherboard component and not
 * the repair a customer means by a broken camera.
 */
const PART_NAME: Record<string, { must: RegExp; not: RegExp }> = {
  screen: { must: /\b(screen|display|lcd|oled)\b/i, not: /\b(adhesive|protector|cable|bracket|hinge|bezel|cover|component)\b/i },
  battery: { must: /\bbatter/i, not: /\b(adhesive|strip|tab|cable|connector|tester)\b/i },
  charging_port: { must: /\b(charging|charge|usb-c|lightning)\b.*\b(port|connector|assembly|board)\b/i, not: /\b(adhesive|cable only|tester)\b/i },
  rear_camera: { must: /\b(rear|back|main|wide)\b.*\bcamera\b/i, not: /\b(deck|wi-?fi|bracket|lens|cover|adhesive|front)\b/i },
};

export function isThePart(problem: string, productName: string): boolean {
  const spec = PART_NAME[problem];
  if (!spec) return false;
  return spec.must.test(productName) && !spec.not.test(productName);
}

const slugify = (s: string) =>
  s.toLowerCase().replace(/[“”‘’'"]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const BRAND = /^(apple|samsung|google|lenovo|microsoft|motorola|oneplus|lg|asus|dell|hp|acer|sony|nintendo|valve|meta|msi|razer)\s+/i;

/**
 * Pick the wiki that IS our device, not merely one that mentions it. Searching
 * "Galaxy Tab S8" ranks the Ultra first, so the first hit is the wrong default.
 */
export function pickWiki<T extends { title?: string; display_title?: string; url: string }>(
  ourName: string,
  results: T[],
): T | null {
  if (!results.length) return null;
  const want = slugify(ourName.replace(BRAND, ""));
  const keyOf = (r: T) => slugify((r.display_title || r.title || "").replace(BRAND, ""));
  return results.find((r) => keyOf(r) === want) ?? results.find((r) => keyOf(r).startsWith(want + "-")) ?? null;
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(25_000) });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

async function getText(url: string): Promise<string> {
  try {
    const r = await fetch(url, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(25_000) });
    return r.ok ? await r.text() : "";
  } catch {
    return "";
  }
}

interface SearchResult {
  namespace?: string;
  title?: string;
  display_title?: string;
  url: string;
}

/** Our device name -> the path segment of their device wiki, or null. */
export async function resolveWiki(deviceName: string): Promise<string | null> {
  const d = await getJson<{ results?: SearchResult[] }>(
    `https://www.ifixit.com/api/2.0/search/${encodeURIComponent(deviceName)}?limit=10`,
  );
  const cats = (d?.results || []).filter((r) => r.namespace === "CATEGORY" && r.url.includes("/Device/"));
  const best = pickWiki(deviceName, cats);
  return best ? best.url.split("/Device/")[1] : null;
}

/** The part shelves iFixit says fit that device, already mapped to our problems. */
export async function partShelves(wiki: string): Promise<Array<{ problem: string; url: string }>> {
  const o = await getJson<{ parts?: { categories?: Array<{ tag: string; url: string }> } }>(
    `https://www.ifixit.com/api/2.0/wikis/CATEGORY/${wiki}`,
  );
  const out: Array<{ problem: string; url: string }> = [];
  const seen = new Set<string>();
  for (const c of o?.parts?.categories || []) {
    const problem = problemForTag(c.tag);
    // One shelf per problem: "Screens" and "Displays" both map to screen.
    if (!problem || seen.has(problem)) continue;
    seen.add(problem);
    out.push({ problem, url: c.url });
  }
  return out;
}

/** The product slugs listed on a shelf. */
export function slugsIn(html: string): string[] {
  return [...new Set([...html.matchAll(/\/products\/([a-z0-9][a-z0-9-]{3,})/g)].map((m) => m[1]))];
}

export interface IfixitPrice {
  title: string;
  price: number;
  currency: string;
  url: string;
}

export async function readProduct(slug: string): Promise<IfixitPrice | null> {
  const url = `https://www.ifixit.com/en-ca/products/${slug}`;
  const body = await getText(url);
  if (!body) return null;
  for (const m of body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const d = JSON.parse(m[1]) as {
        "@type"?: string;
        name?: string;
        offers?: { price?: string | number; priceCurrency?: string } | Array<{ price?: string | number; priceCurrency?: string }>;
      };
      if (d["@type"] !== "Product" && d["@type"] !== "ProductGroup") continue;
      const offers = Array.isArray(d.offers) ? d.offers[0] : d.offers;
      const price = Number(offers?.price);
      if (!Number.isFinite(price) || price <= 0) continue;
      return { title: (d.name || slug).replace(/&quot;/g, '"'), price, currency: offers?.priceCurrency || "CAD", url };
    } catch {
      /* not this block */
    }
  }
  return null;
}

export interface IfixitSyncResult {
  devices: number;
  resolved: number;
  priced: number;
  devicesPriced: number;
  errors: string[];
}

/**
 * Walk the catalogue and record what iFixit sells for each device.
 *
 * Only devices that have no Canadian price already are looked up, because the
 * supplier the shop actually buys from is the better number when both exist,
 * and because it keeps the run short enough to be a polite visitor.
 */
export async function syncIfixitParts(opts: {
  delayMs?: number;
  onlyMissing?: boolean;
  onProgress?: (p: { done: number; total: number; priced: number }) => void;
} = {}): Promise<IfixitSyncResult> {
  const delay = opts.delayMs ?? 400;
  const onlyMissing = opts.onlyMissing ?? true;
  const db = getDb();
  try {
    // The problems iFixit can answer at all. A device is worth visiting if any
    // one of them is still unpriced — checking "has no price of any kind" would
    // skip a phone whose battery is priced and whose screen is not, which is
    // most of them once the Canadian supplier has had its turn.
    const fillable = [...new Set(Object.values(TAG_TO_PROBLEM))];
    const devices = db
      .prepare(
        onlyMissing
          ? `SELECT d.id, d.name FROM devices d
              WHERE d.enabled = 1
                AND EXISTS (
                  SELECT 1 FROM (SELECT value AS problem FROM json_each(?)) p
                   WHERE NOT EXISTS (
                     SELECT 1 FROM repair_market_prices m
                      WHERE m.device_id = d.id AND m.problem = p.problem AND m.price_cad > 0
                   )
                )
              ORDER BY d.name`
          : `SELECT d.id, d.name FROM devices d WHERE d.enabled = 1 ORDER BY d.name`,
      )
      .all(...(onlyMissing ? [JSON.stringify(fillable)] : [])) as Array<{ id: string; name: string }>;

    // A part already priced — by the Canadian supplier, or by an earlier run —
    // is left alone rather than re-read.
    const alreadyPriced = db.prepare(
      "SELECT 1 FROM repair_market_prices WHERE device_id = ? AND problem = ? AND price_cad > 0 LIMIT 1",
    );

    const upsert = db.prepare(
      `INSERT INTO repair_market_prices
         (source, device_id, problem, product_title, price, currency, price_cad, fx_rate, source_url, scraped_at, in_stock, alternatives)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
       ON CONFLICT(source, device_id, problem) DO UPDATE SET
         product_title = excluded.product_title, price = excluded.price, currency = excluded.currency,
         price_cad = excluded.price_cad, fx_rate = excluded.fx_rate, source_url = excluded.source_url,
         scraped_at = excluded.scraped_at, alternatives = excluded.alternatives`,
    );

    const errors: string[] = [];
    const now = new Date().toISOString();
    let resolved = 0;
    let priced = 0;
    const devicesPriced = new Set<string>();

    for (let i = 0; i < devices.length; i++) {
      const dev = devices[i];
      try {
        const wiki = await resolveWiki(dev.name);
        await new Promise((r) => setTimeout(r, delay));
        if (!wiki) continue;
        resolved++;

        for (const shelf of await partShelves(wiki)) {
          if (onlyMissing && alreadyPriced.get(dev.id, shelf.problem)) continue;
          await new Promise((r) => setTimeout(r, delay));
          const slugs = slugsIn(await getText(shelf.url));
          if (!slugs.length) continue;
          for (const slug of slugs.slice(0, 3)) {
            await new Promise((r) => setTimeout(r, delay));
            const p = await readProduct(slug);
            if (!p) continue;
            // The shelf vouches for fitment; the name has to vouch for function.
            if (!isThePart(shelf.problem, p.title)) continue;
            if (!isPlausiblePrice(shelf.problem, p.price)) continue;
            // en-ca quotes CAD, so nothing is converted and the rate is 1. A
            // listing that comes back in another currency is skipped rather
            // than converted with a rate this run never fetched.
            if (p.currency !== "CAD") continue;
            upsert.run(
              IFIXIT_SOURCE, dev.id, shelf.problem, p.title, p.price, p.currency,
              Math.round(p.price * 100) / 100, 1, p.url, now, slugs.length,
            );
            priced++;
            devicesPriced.add(dev.id);
            break;
          }
        }
      } catch (e) {
        errors.push(`${dev.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
      opts.onProgress?.({ done: i + 1, total: devices.length, priced });
    }

    return { devices: devices.length, resolved, priced, devicesPriced: devicesPriced.size, errors: errors.slice(0, 20) };
  } finally {
    db.close();
  }
}
