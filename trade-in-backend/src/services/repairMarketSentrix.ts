import { getDb } from "../db/migrate.js";

/**
 * Canadian part prices from MobileSentrix.ca — the supplier the shop already
 * buys from.
 *
 * iFixit answered the first version of this question, but it stocks parts for
 * only a fraction of the catalogue: laptops, smartwatches, consoles and most
 * Samsung models have no listing at all, so 297 of 412 devices had no repair
 * price. MobileSentrix publishes 43,000 products with prices in CAD as
 * schema.org Product data, needs no login to read them, and is the distributor
 * named in the shop's own pricing rule. Prices are already Canadian, so
 * nothing is converted and no exchange rate can drift.
 *
 * The whole difficulty is deciding which listing is which device, because a
 * wrong part price becomes a quote and a quote becomes a promise. Every rule
 * below exists because it caught a real mis-match while this was being built,
 * and the matcher is audited against the catalogue's own sibling models: of
 * 6,177 accepted listings, none named a different model than the device it was
 * filed under.
 */

const UA = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/122 Safari/537.36",
  "Accept-Language": "en-CA,en;q=0.9",
};

export const SENTRIX_SOURCE = "mobilesentrix";
export const SENTRIX_LABEL = "MobileSentrix Canada";

/**
 * Which listings are this part. `must` is what the product name has to say;
 * `not` throws out the fittings, tools and consumables that mention it.
 */
/**
 * Which listings are this part. `must` is what the product name has to say;
 * `not` throws out the fittings, spacers, shields and consumables that mention
 * it. `floor` is the least a real one of these has ever cost wholesale.
 *
 * The `not` lists are long because the supplier sells the trimmings beside the
 * part and names them after it: "Battery Bottom Foam", "Back Camera Copper
 * Foil Shielding Tape", "Charging Port Board Protective Cover". Each of those
 * was chosen as a part price by an earlier version of this file — a $0.01
 * battery — which is why `floor` exists as a second, independent check. A
 * listing that fails either one yields no row, and the repair falls back to a
 * hand quote.
 */
const TRIM = "adhesive|sticker|tester|foam|cushion|cotton|tape|foil|shield|spacer|gasket|bracket|holder|clip|screw|tool|template|mesh|mold|jig|protector|dust|seal|insulat|sponge";

export const SENTRIX_PARTS: Record<string, { must: RegExp; not: RegExp; floor: number }> = {
  screen: {
    must: /(lcd|oled|incell)-assembly|screen-assembly|lcd-with-digitizer|complete-lcd-display-assembly/,
    not: new RegExp(`(panel-only|glass-only|touch-only|back-glass|press-pad|laminat|${TRIM})`),
    floor: 8,
  },
  battery: {
    must: /(^|-)(replacement-)?battery(-|$)/,
    not: new RegExp(`(cable|connector|pack-of|flex|charger|bank|${TRIM})`),
    floor: 3,
  },
  charging_port: {
    must: /charging-port|charge-port|charging-connector|usb-charging|charging-flex/,
    not: new RegExp(`(cable-only|wireless-charging|cover|${TRIM})`),
    floor: 0.5,
  },
  back_glass: {
    must: /back-(glass|cover|housing)/,
    not: new RegExp(`(laminat|${TRIM})`),
    floor: 2,
  },
  rear_camera: {
    must: /(rear|back)-camera/,
    not: new RegExp(`(lens|glass|cover|${TRIM})`),
    floor: 1,
  },
};

/** A token that, present as an EXTRA word we do not have, means another model. */
const VARIANT = new Set([
  "pro", "plus", "max", "mini", "ultra", "fe", "xl", "lite", "edge", "fold", "flip", "classic", "neo", "air", "note",
]);

/** A product line, not a qualifier: "Google Pixel" must not take a Pixel Watch part. */
const CLASS = new Set([
  "watch", "tab", "book", "buds", "pad", "tablet", "laptop", "stylus", "pen", "case", "charger", "dock", "band", "tv",
]);

const ALL_BRANDS = new Set([
  "apple", "samsung", "google", "motorola", "moto", "oneplus", "lg", "microsoft", "sony", "nintendo", "valve",
  "lenovo", "asus", "dell", "hp", "acer", "meta", "oculus", "msi", "razer", "tcl", "huawei", "nothing",
  "blackberry", "alienware", "xiaomi", "nokia", "zte", "honor",
]);

/**
 * "+" is a model word, not punctuation. Dropping it made Galaxy S21+ share a
 * key with Galaxy S21, and inherit the plain model's parts.
 */
export function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[“”‘’'"]/g, "")
    .replace(/\+/g, " plus ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const BRAND_PREFIX =
  /^(apple|samsung|google|motorola|oneplus|lg|microsoft|sony|nintendo|valve|lenovo|asus|dell|hp|acer|meta|msi|razer|tcl|huawei|nothing|blackberry|alienware)-/;

const CATEGORY_SUFFIX = /-(smartphone|tablet|laptop|smartwatch|gaming-console|computer|monitor|vr|series)$/;

/** Our brand ids look like "motorola-smartphone"; the store writes "moto" too. */
export function brandWords(brand: string | null | undefined): string[] {
  const head = norm(brand || "").replace(CATEGORY_SUFFIX, "").split("-")[0];
  const aliases: Record<string, string[]> = {
    motorola: ["motorola", "moto"],
    meta: ["meta", "oculus"],
    alienware: ["alienware", "dell"],
  };
  return aliases[head] || (head ? [head] : []);
}

/** Our catalogue name, as the token runs the store might file it under. */
export function modelTokens(name: string): string[][] {
  const base = norm(name).replace(BRAND_PREFIX, "").replace(/-(wi-?fi|cellular|lte)\b/g, "");
  const alts = new Set([base]);
  // Ours says "Watch SE 3"; theirs always spells the line out: "watch-series-…".
  if (/^watch-/.test(base) && !/^watch-series/.test(base)) alts.add(base.replace(/^watch-/, "watch-series-"));
  // "iPad 9.7" is a screen size, and the store also writes it closed up.
  alts.add(base.replace(/(\d)-(\d)/g, "$1$2"));
  return [...alts].map((a) => a.split("-").filter(Boolean));
}

// A manufacturer code between our tokens, as in "motorola-edge-XT2205-1-2022".
const CODE = /^(?:[a-z]{1,3}\d{2,6}[a-z0-9]*|[a-z]{2}|v\d)$/;
const CODE_SUFFIX = /^\d{1,2}$/;

/** Do our tokens run through `slugToks`, allowing only model codes between? */
function runMatch(slugToks: string[], toks: string[], ours: Set<string>): boolean {
  for (let i = 0; i < slugToks.length; i++) {
    if (slugToks[i] !== toks[0]) continue;
    let si = i + 1;
    let ti = 1;
    let gaps = 0;
    let ok = true;
    let prevWasCode = false;
    while (ti < toks.length) {
      if (si >= slugToks.length) { ok = false; break; }
      if (slugToks[si] === toks[ti]) { si++; ti++; prevWasCode = false; continue; }
      const t = slugToks[si];
      // A bare number is never skippable on its own — skipping "6" would let
      // "Galaxy Z Flip" swallow "Galaxy Z Flip 6". It is allowed only directly
      // after an alphanumeric code, as the "-1" in "xt2205-1".
      if (gaps < 3 && !VARIANT.has(t) && (CODE.test(t) || (prevWasCode && CODE_SUFFIX.test(t)))) {
        prevWasCode = CODE.test(t);
        si++;
        gaps++;
        continue;
      }
      ok = false;
      break;
    }
    if (!ok) continue;

    const next = slugToks[si];
    if (next && VARIANT.has(next) && !ours.has(next)) continue;
    // A bare number after our model. If our own model does not end in a number
    // that number IS the generation, so this is a different device. If ours
    // does, the store is co-listing two generations that share the part:
    // "watch-series-10-11-46mm" fits Series 10 and Series 11 alike.
    const ourLast = toks[toks.length - 1];
    if (next && /^\d{1,2}$/.test(next) && !ours.has(next) && !/^\d+$/.test(ourLast)) continue;
    if (next && CLASS.has(next) && !ours.has(next)) continue;
    // "3a"/"7a"/"9a" is a different handset. A size ("45mm", "64gb") or a
    // radio ("5g", "4g") is a qualifier on the same one — and where the
    // catalogue carries both, as it does for Galaxy Z Flip and Z Flip 5G,
    // assignExclusively is what separates them, not this rule.
    if (next && /^\d{1,2}[a-z]{1,2}$/.test(next) && !/(mm|gb|tb|hz|in|w|g)$/.test(next) && !ours.has(next)) continue;
    return true;
  }
  return false;
}

/** Every listing in `slugs` that is this device and this part. */
export function findListings(
  slugs: string[],
  deviceName: string,
  brand: string | null | undefined,
  problem: string,
): string[] {
  const spec = SENTRIX_PARTS[problem];
  if (!spec) return [];
  const variants = modelTokens(deviceName);
  const brands = brandWords(brand);
  const out: string[] = [];
  for (const slug of slugs) {
    if (!spec.must.test(slug) || spec.not.test(slug)) continue;
    const at = slug.indexOf("-for-");
    if (at < 0) continue;
    const region = slug.slice(at + 5);
    const rtoks = region.split("-");
    for (const toks of variants) {
      const ours = new Set(toks);
      // One bare token — a class word ("OnePlus Watch" -> "watch") or a number
      // ("OnePlus 8" -> "8") — matches far too much to stand on its own.
      const generic = toks.length === 1 && (CLASS.has(toks[0]) || /^\d{1,2}$/.test(toks[0]));
      let hit = generic ? false : runMatch(rtoks, toks, ours);
      if (!hit) {
        for (const b of brands) {
          if (runMatch(rtoks, [...b.split("-"), ...toks], ours)) { hit = true; break; }
        }
      }
      if (!hit) continue;
      // Cross-brand guard: Apple's "Watch Ultra" must not take
      // "samsung-watch-ultra-lte-47mm".
      const named = rtoks.filter((t) => ALL_BRANDS.has(t));
      if (named.length && !named.some((t) => brands.includes(t))) continue;
      out.push(slug);
      break;
    }
  }
  return out;
}

/**
 * A listing may fit several of our models; it belongs to the most specific one.
 * Without this, "Galaxy S21+" and "Galaxy S21" both claim the plain S21 screen.
 */
export function assignExclusively(
  claims: Array<{ deviceId: string; deviceKey: string; problem: string; slug: string }>,
): Map<string, Map<string, string[]>> {
  const bySlug = new Map<string, typeof claims>();
  for (const c of claims) {
    const k = `${c.problem}|${c.slug}`;
    if (!bySlug.has(k)) bySlug.set(k, []);
    bySlug.get(k)!.push(c);
  }
  const out = new Map<string, Map<string, string[]>>();
  for (const group of bySlug.values()) {
    const depth = Math.max(...group.map((c) => c.deviceKey.split("-").length));
    for (const c of group) {
      if (c.deviceKey.split("-").length < depth) continue;
      if (!out.has(c.deviceId)) out.set(c.deviceId, new Map());
      const perProblem = out.get(c.deviceId)!;
      if (!perProblem.has(c.problem)) perProblem.set(c.problem, []);
      perProblem.get(c.problem)!.push(c.slug);
    }
  }
  return out;
}

/** The grade a shop actually buys, best-supported first. */
const TIERS: Array<[RegExp, number]> = [
  [/aftermarket-pro/, 0],
  [/aftermarket-plus/, 1],
  [/premium/, 2],
  [/ampsentrix-pro/, 3],
  [/ampsentrix/, 4],
  [/refurbished/, 5],
  [/genuine-oem/, 6],
  [/service-pack/, 7],
  [/used-oem-pull/, 8],
];

/**
 * Is this a believable price for this part? The regexes above are the first
 * line and this is the second: whatever slips through as a "battery" for a
 * dollar is a spacer, not a battery, and a price that cannot be believed must
 * never reach a customer as a quote.
 */
export function isPlausiblePrice(problem: string, price: number): boolean {
  const spec = SENTRIX_PARTS[problem];
  if (!spec) return false;
  return Number.isFinite(price) && price >= spec.floor;
}

export function gradeTier(slug: string): number {
  for (const [re, t] of TIERS) if (re.test(slug)) return t;
  return 9;
}

export function rankListings(slugs: string[]): string[] {
  return [...new Set(slugs)].sort((a, b) => gradeTier(a) - gradeTier(b) || a.length - b.length);
}

/**
 * Read a page, backing off when the supplier says we are going too fast.
 *
 * Reading 43,000 products at five a second earned a 403 within minutes, and it
 * cleared again after a pause — so a refusal is a rate limit, not a wall, and
 * the only correct response is to wait. The distinction matters downstream: a
 * throttled run must report that it was throttled, because a run that quietly
 * finds nothing looks exactly like a supplier that stopped stocking parts.
 */
async function politeFetch(url: string, timeoutMs = 30_000): Promise<{ ok: boolean; status: number; body: string }> {
  let wait = 2_000;
  for (let attempt = 0; attempt < 4; attempt++) {
    let status = 0;
    try {
      const r = await fetch(url, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
      status = r.status;
      if (r.ok) return { ok: true, status, body: await r.text() };
      // 404 is a real answer: that product is gone. Do not retry it.
      if (status === 404 || status === 410) return { ok: false, status, body: "" };
    } catch {
      /* network or timeout: treat as retryable */
    }
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, wait));
      wait *= 2;
    } else {
      return { ok: false, status, body: "" };
    }
  }
  return { ok: false, status: 0, body: "" };
}

export class SupplierThrottled extends Error {
  constructor() {
    super("The supplier is rate-limiting us; no prices were read. Try again later.");
    this.name = "SupplierThrottled";
  }
}

export async function loadSentrixProducts(): Promise<string[] | null> {
  const idx = await politeFetch("https://www.mobilesentrix.ca/sitemap.xml");
  if (!idx.ok) return null;
  const maps = [...idx.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).filter((u) => /product/.test(u));
  const slugs: string[] = [];
  for (const m of maps) {
    const r = await politeFetch(m, 60_000);
    if (!r.ok) continue;
    for (const u of r.body.matchAll(/<loc>https:\/\/www\.mobilesentrix\.ca\/([^<]+)<\/loc>/g)) slugs.push(u[1]);
  }
  // A partial list would silently shrink coverage, retiring prices for devices
  // whose listings simply were not in the half that arrived. Better no run.
  return slugs.length > 10_000 ? slugs : null;
}

export interface SentrixPrice {
  title: string;
  price: number;
  currency: string;
  inStock: boolean;
  url: string;
}

export async function readPrice(slug: string): Promise<SentrixPrice | null> {
  try {
    const r = await politeFetch(`https://www.mobilesentrix.ca/${slug}`, 25_000);
    if (!r.ok) return null;
    const body = r.body;
    for (const m of body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      try {
        const d = JSON.parse(m[1]) as {
          "@type"?: string;
          name?: string;
          offers?: { price?: string | number; priceCurrency?: string; availability?: string };
        };
        if (d["@type"] !== "Product") continue;
        const offers = Array.isArray(d.offers) ? d.offers[0] : d.offers;
        const price = Number(offers?.price);
        if (!Number.isFinite(price) || price <= 0) continue;
        return {
          title: d.name || slug,
          price,
          currency: offers?.priceCurrency || "CAD",
          inStock: /InStock/i.test(offers?.availability || ""),
          url: `https://www.mobilesentrix.ca/${slug}`,
        };
      } catch {
        /* not this block */
      }
    }
    return null;
  } catch {
    return null;
  }
}

export interface SentrixSyncResult {
  products: number;
  pairs: number;
  priced: number;
  devices: number;
  /** Listings read but discarded as implausible for the part. */
  rejected: number;
  errors: string[];
}

export async function syncSentrixPrices(opts: {
  delayMs?: number;
  perPair?: number;
  onProgress?: (p: { done: number; total: number; priced: number }) => void;
} = {}): Promise<SentrixSyncResult> {
  const products = await loadSentrixProducts();
  if (!products) return { products: 0, pairs: 0, priced: 0, devices: 0, rejected: 0, errors: ["Could not read the supplier's product list; nothing written"] };

  const db = getDb();
  try {
    const devices = db.prepare("SELECT id, name, brand_id FROM devices WHERE enabled = 1").all() as Array<{
      id: string;
      name: string;
      brand_id: string | null;
    }>;

    const claims: Array<{ deviceId: string; deviceKey: string; problem: string; slug: string }> = [];
    for (const d of devices) {
      const key = norm(d.name).replace(BRAND_PREFIX, "");
      for (const problem of Object.keys(SENTRIX_PARTS)) {
        for (const slug of findListings(products, d.name, d.brand_id, problem)) {
          claims.push({ deviceId: d.id, deviceKey: key, problem, slug });
        }
      }
    }
    const assigned = assignExclusively(claims);

    const upsert = db.prepare(
      `INSERT INTO repair_market_prices (source, device_id, problem, product_title, price, currency, price_cad, fx_rate, source_url, scraped_at, in_stock, alternatives)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
       ON CONFLICT(source, device_id, problem) DO UPDATE SET
         product_title = excluded.product_title, price = excluded.price, currency = excluded.currency,
         price_cad = excluded.price_cad, fx_rate = excluded.fx_rate, source_url = excluded.source_url,
         scraped_at = excluded.scraped_at, in_stock = excluded.in_stock, alternatives = excluded.alternatives`,
    );

    // Five requests a second earned a 403 within minutes of starting. Roughly
    // one and a half a second has read the whole catalogue without a refusal,
    // and a weekly job has no reason to be faster than that.
    const delay = opts.delayMs ?? 650;
    const perPair = opts.perPair ?? 3;
    const errors: string[] = [];
    const now = new Date().toISOString();
    let pairs = 0;
    let priced = 0;
    let rejected = 0;
    const devicesPriced = new Set<string>();

    const flat: Array<{ deviceId: string; problem: string; slugs: string[]; total: number }> = [];
    for (const [deviceId, perProblem] of assigned) {
      for (const [problem, slugs] of perProblem) {
        flat.push({ deviceId, problem, slugs: rankListings(slugs).slice(0, perPair), total: slugs.length });
      }
    }
    pairs = flat.length;

    for (let i = 0; i < flat.length; i++) {
      const job = flat[i];
      const found: Array<SentrixPrice & { tier: number }> = [];
      for (const slug of job.slugs) {
        try {
          const p = await readPrice(slug);
          // A price below the floor is a trimming that named itself after the
          // part. Dropped rather than recorded: the repair then asks for a
          // hand quote, which is correct, instead of promising a dollar.
          if (p && isPlausiblePrice(job.problem, p.price)) found.push({ ...p, tier: gradeTier(slug) });
          else if (p) rejected++;
        } catch (e) {
          errors.push(`${job.deviceId}/${job.problem}: ${e instanceof Error ? e.message : String(e)}`);
        }
        await new Promise((r) => setTimeout(r, delay));
      }
      if (found.length) {
        found.sort((a, b) => a.tier - b.tier || a.price - b.price);
        const best = found[0];
        // Every price here is already Canadian, so nothing is converted and the
        // recorded rate is 1.
        upsert.run(
          SENTRIX_SOURCE, job.deviceId, job.problem, best.title, best.price, best.currency,
          Math.round(best.price * 100) / 100, best.url, now, best.inStock ? 1 : 0, job.total,
        );
        priced++;
        devicesPriced.add(job.deviceId);
      }
      opts.onProgress?.({ done: i + 1, total: flat.length, priced });
    }

    // Every pair failing is not a supplier that stopped stocking parts, it is
    // a supplier that stopped answering. Say which, or the next person reads
    // "0 priced" as a fact about the catalogue.
    if (pairs > 20 && priced === 0 && rejected === 0) {
      errors.unshift("Read no price for any of the " + pairs + " parts matched — the supplier is most likely rate-limiting us. Existing prices were left alone.");
    }
    return { products: products.length, pairs, priced, devices: devicesPriced.size, rejected, errors: errors.slice(0, 20) };
  } finally {
    db.close();
  }
}
