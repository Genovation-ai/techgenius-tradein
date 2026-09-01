import type { ProviderAdapter, ScraperResult, ScrapedPrice, ToScrape } from "../types.js";
import { sanitizeScrapedPrice } from "../validate.js";
import { capacitiesMatch } from "../deviceMatch.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const STEP_FLOW = "https://gorecell.ca/step-flow/";
const PRODUCT_BASE = "https://gorecell.ca/product/";

/**
 * Root cause (Aug 2026):
 * The old step-flow adapter read Angular `selected_product._variations`, but GoRecell
 * zeroed WooCommerce variation prices site-wide (`_price: "0"`, empty `_variations`).
 * Live buyback quotes now come from the `wc-query-flow` plugin on each product page:
 * an embedded `query_data` JSON with storage (fixed $) + condition (percent off).
 *
 * Formula (from wc-query-flow/assets/js/publics/main.js):
 *   calc = 0; base = data-price (usually 0)
 *   for each selected answer:
 *     fixed  → calc += price
 *     percent → if base==0: base = calc; calc += base * (price/100)
 *   display = Math.floor(calc)
 */

interface QueryRule {
  title: string;
  desc?: string;
  price: string;
  price_formate: "fixed" | "percent" | string;
}

interface QueryQuestion {
  title: string;
  display?: string;
  rules: Record<string, QueryRule>;
}

type QueryData = Record<string, QueryQuestion>;

const COND_MAP: Array<{ label: RegExp; condition: ScrapedPrice["condition"] }> = [
  { label: /^like\s*new$/i, condition: "excellent" },
  { label: /^good$/i, condition: "good" },
  { label: /^fair$/i, condition: "fair" },
  { label: /^cracked/i, condition: "cracked" },
  { label: /^defective$/i, condition: "broken" },
];

function slugifyModel(model: string): string {
  return model
    .toLowerCase()
    .replace(/\+/g, "-plus")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function productUrlFromModel(model: string): string {
  return `${PRODUCT_BASE}${slugifyModel(model)}/`;
}

/** Parse `var query_data = JSON.parse('...')` from product HTML. */
export function parseQueryData(html: string): QueryData | null {
  const m = html.match(/var\s+query_data\s*=\s*JSON\.parse\(\s*'((?:\\'|[^'])*)'\s*\)/);
  if (!m?.[1]) return null;
  try {
    // HTML embeds JSON inside a single-quoted JS string; quotes appear as \"
    const restored = m[1]
      .replace(/\\'/g, "'")
      .replace(/\\\//g, "/")
      .replace(/\\"/g, '"');
    return JSON.parse(restored) as QueryData;
  } catch {
    return null;
  }
}

function findStorageQuestion(data: QueryData): QueryQuestion | null {
  for (const q of Object.values(data)) {
    if (/storage|capacity|gb|size/i.test(q.title)) return q;
  }
  // Heuristic: question whose rules look like storage sizes
  for (const q of Object.values(data)) {
    const titles = Object.values(q.rules || {}).map((r) => r.title);
    if (titles.some((t) => /\d+\s*gb|\d+\s*tb/i.test(t))) return q;
  }
  return null;
}

function findConditionQuestion(data: QueryData): QueryQuestion | null {
  for (const q of Object.values(data)) {
    if (/condition/i.test(q.title)) return q;
  }
  for (const q of Object.values(data)) {
    const titles = Object.values(q.rules || {}).map((r) => r.title.toLowerCase());
    if (titles.some((t) => /like new|good|fair|defective|cracked/.test(t))) return q;
  }
  return null;
}

function findStorageRule(q: QueryQuestion, variant: string): QueryRule | null {
  const rules = Object.values(q.rules || {});
  return rules.find((r) => capacitiesMatch(r.title, variant)) || null;
}

/**
 * Reproduce wc-query-flow price math for one storage + one condition selection.
 */
export function computeQueryFlowPrice(storage: QueryRule, condition: QueryRule, pageBasePrice = 0): number {
  let basePrice = Number(pageBasePrice) || 0;
  let calcPrice = 0;

  for (const queryobj of [storage, condition]) {
    const price = Number(queryobj.price);
    const formate = String(queryobj.price_formate || "fixed").toLowerCase();
    if (formate === "fixed") {
      calcPrice += Number.isFinite(price) ? price : 0;
    } else {
      // percent — mirrors wc-query-flow/assets/js/publics/main.js
      if (basePrice === 0) basePrice = calcPrice;
      const pct = Number(Number(price).toFixed(3));
      calcPrice += Number((Number(basePrice) / 100) * pct);
    }
  }
  return Math.floor(calcPrice);
}

function mapConditionRules(q: QueryQuestion): Array<{ condition: ScrapedPrice["condition"]; rule: QueryRule; label: string }> {
  const out: Array<{ condition: ScrapedPrice["condition"]; rule: QueryRule; label: string }> = [];
  const used = new Set<string>();
  for (const { label, condition } of COND_MAP) {
    const rule = Object.values(q.rules || {}).find((r) => label.test(r.title.trim()));
    if (!rule || used.has(condition)) continue;
    used.add(condition);
    out.push({ condition, rule, label: rule.title });
  }
  return out;
}

async function fetchHtml(url: string): Promise<{ ok: boolean; status: number; html: string }> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-CA,en;q=0.9",
    },
  });
  const html = await res.text();
  return { ok: res.ok, status: res.status, html };
}

/** Build model → product URL index from step-flow embedded catalog (once per scrape). */
async function loadProductUrlIndex(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const { ok, html } = await fetchHtml(STEP_FLOW);
    if (!ok) return map;
    const m = html.match(/var\s+products\s*=\s*(\[[\s\S]*?\]);/);
    if (!m) return map;
    const products = JSON.parse(m[1]) as Array<{ _name?: string; _url?: string; name?: string }>;
    for (const p of products) {
      const name = String(p._name || p.name || "").trim();
      const url = String(p._url || "").trim();
      if (name && url) map.set(name.toLowerCase(), url);
    }
  } catch {
    /* ignore — fall back to slug URLs */
  }
  return map;
}

function resolveProductUrl(d: ToScrape, urlIndex: Map<string, string>): string {
  if (d.url && /\/product\//i.test(d.url)) return d.url;
  const metaUrl = d.meta?.gorecellUrl || d.meta?.productUrl;
  if (typeof metaUrl === "string" && metaUrl) return metaUrl;
  const byName = urlIndex.get(d.model.toLowerCase());
  if (byName) return byName;
  return productUrlFromModel(d.model);
}

/**
 * GoRecell — scrape buyback quotes from product-page `query_data` (wc-query-flow).
 */
export function createGorecellStepFlowAdapter(opts?: { name?: string }): ProviderAdapter {
  const name = opts?.name ?? "gorecell";
  return {
    name,
    engine: "cheerio",
    async scrape(devices: ToScrape[]): Promise<ScraperResult> {
      const started = Date.now();
      const rows: ScrapedPrice[] = [];
      const errors: string[] = [];
      let targeted = 0;

      const urlIndex = await loadProductUrlIndex();
      const pageCache = new Map<string, { data: QueryData; basePrice: number } | "error">();

      for (const d of devices) {
        targeted += 1;
        const url = resolveProductUrl(d, urlIndex);
        const variant = d.variant || "128GB";
        try {
          let cached = pageCache.get(url);
          if (cached === "error") {
            errors.push(`${name}: prior fetch failed @ ${url}`);
            continue;
          }
          if (!cached) {
            const { ok, status, html } = await fetchHtml(url);
            if (!ok) {
              pageCache.set(url, "error");
              errors.push(`${name}: HTTP ${status} @ ${url}`);
              continue;
            }
            const data = parseQueryData(html);
            if (!data) {
              pageCache.set(url, "error");
              errors.push(`${name}: no query_data on product page @ ${url}`);
              continue;
            }
            const baseMatch = html.match(/class="[^"]*product-price[^"]*"[^>]*data-price="([^"]*)"/i)
              || html.match(/data-price="([^"]*)"[^>]*class="[^"]*product-price/i);
            const basePrice = baseMatch ? Number(baseMatch[1]) || 0 : 0;
            cached = { data, basePrice };
            pageCache.set(url, cached);
          }

          const storageQ = findStorageQuestion(cached.data);
          const conditionQ = findConditionQuestion(cached.data);
          if (!storageQ || !conditionQ) {
            errors.push(`${name}: missing storage/condition questions @ ${url}`);
            continue;
          }

          const storageRule = findStorageRule(storageQ, variant);
          if (!storageRule) {
            const available = Object.values(storageQ.rules)
              .map((r) => r.title)
              .join(", ");
            errors.push(
              `${name}: no storage match for ${d.model} ${variant} @ ${url} (have: ${available})`,
            );
            continue;
          }

          const conditions = mapConditionRules(conditionQ);
          if (!conditions.length) {
            errors.push(`${name}: no mappable condition rules @ ${url}`);
            continue;
          }

          for (const { condition, rule, label } of conditions) {
            const price = computeQueryFlowPrice(storageRule, rule, cached.basePrice);
            if (!price || price < 5) continue;
            const scraped = sanitizeScrapedPrice({
              competitor_name: name,
              make: d.make,
              model: d.model,
              product_id: d.productId,
              variant,
              condition,
              trade_in_price: price,
              sell_price: null,
              currency: "CAD",
              raw: {
                source: url,
                engine: "gorecell-query-flow",
                payload: {
                  storage: storageRule.title,
                  storagePrice: storageRule.price,
                  condition: label,
                  conditionPrice: rule.price,
                  conditionFormat: rule.price_formate,
                  computed: price,
                },
              },
              scraped_at: new Date().toISOString(),
            });
            if (scraped) rows.push(scraped);
          }
        } catch (e) {
          errors.push(`${name}: ${e instanceof Error ? e.message : String(e)} @ ${url}`);
        }
      }

      return {
        provider: name,
        engine: "cheerio",
        rows,
        errors,
        durationMs: Date.now() - started,
        targeted,
        discovered: rows.length,
      };
    },
  };
}
