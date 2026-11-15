import type { ProviderAdapter, ScraperResult, ScrapedPrice, ToScrape } from "../types.js";
import { sanitizeScrapedPrice } from "../validate.js";
import { capacitiesMatch } from "../deviceMatch.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
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

// Keep the primary GoRecell labels first, then accept the common synonyms the
// step-flow picker has shipped at least once (mint, pristine, damaged,
// non-working, dead). Each tier matches the first regex to hit; the `used`
// set in mapConditionRules keeps a secondary label from overwriting the real
// one, so a page that still says "Defective" but also carries a "Broken" tier
// takes "Defective" and ignores the duplicate.
const COND_MAP: Array<{ label: RegExp; condition: ScrapedPrice["condition"] }> = [
  { label: /^(like\s*new|mint|pristine|new)$/i, condition: "excellent" },
  { label: /^(good|great|very\s*good)$/i, condition: "good" },
  { label: /^(fair|average|decent|okay)$/i, condition: "fair" },
  { label: /^(cracked|damaged|issues?|screen\s*cracked)/i, condition: "cracked" },
  { label: /^(defective|broken|non[-\s]?working|dead|not\s*working)$/i, condition: "broken" },
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

/**
 * Parse the wc-query-flow configuration out of the product page.
 *
 * The plugin has shipped at least three ways of writing this: the original
 * `var query_data = JSON.parse('…')` on a single-quoted escaped string, a
 * double-quoted variant, and a plain `let query_data = { … };` literal. The
 * adapter was tied to the first spelling, so every GoRecell theme rebuild
 * that touched the inline script silently zeroed the scrape. The parser now
 * tries each shape in order and returns the first that yields a valid object.
 */
export function parseQueryData(html: string): QueryData | null {
  // 1. The historical form — JSON.parse of a single-quoted escaped string.
  const quoted =
    html.match(/(?:var|let|const)\s+query_data\s*=\s*JSON\.parse\(\s*'((?:\\'|[^'])*)'\s*\)/) ||
    html.match(/(?:var|let|const)\s+query_data\s*=\s*JSON\.parse\(\s*"((?:\\"|[^"])*)"\s*\)/);
  if (quoted?.[1]) {
    const restored = quoted[1]
      .replace(/\\'/g, "'")
      .replace(/\\\//g, "/")
      .replace(/\\"/g, '"');
    try {
      const data = JSON.parse(restored) as QueryData;
      if (data && typeof data === "object") return data;
    } catch {
      /* fall through to literal form */
    }
  }

  // 2. Inline object literal: `var query_data = { ... };`
  // Match the first balanced `{...}` after the assignment so trailing script
  // code can't swallow the capture.
  const literalStart = html.search(/(?:var|let|const)\s+query_data\s*=\s*\{/);
  if (literalStart >= 0) {
    const braceStart = html.indexOf("{", literalStart);
    let depth = 0;
    let inStr: string | null = null;
    let escape = false;
    for (let i = braceStart; i < html.length; i++) {
      const ch = html[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (inStr) {
        if (ch === "\\") escape = true;
        else if (ch === inStr) inStr = null;
        continue;
      }
      if (ch === "'" || ch === '"') {
        inStr = ch;
        continue;
      }
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          const raw = html.slice(braceStart, i + 1);
          try {
            const data = JSON.parse(raw) as QueryData;
            if (data && typeof data === "object") return data;
          } catch {
            /* literal uses JS, not JSON — bail rather than ship a wrong parse */
          }
          break;
        }
      }
    }
  }

  return null;
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
 *
 * `pageBasePrice` is parsed out of the product page's `data-price` attribute;
 * that attribute has been seen as blank, as `"0"`, and, after one broken theme
 * push, as a negative number. A negative base silently flips the condition
 * percent into an ADD rather than a subtract — a "−40%" cracked tier then
 * computes as flawless × 1.4 instead of flawless × 0.6, and the sync writes
 * those inflated numbers as if they were the live quote. Clamping to ≥ 0 and
 * dropping non-finite inputs matches the plugin's own JS (which coerces with
 * `Number(…) || 0`) and keeps that whole class of theme-break off the catalog.
 */
export function computeQueryFlowPrice(storage: QueryRule, condition: QueryRule, pageBasePrice = 0): number {
  const seed = Number(pageBasePrice);
  let basePrice = Number.isFinite(seed) && seed > 0 ? seed : 0;
  let calcPrice = 0;

  for (const queryobj of [storage, condition]) {
    const price = Number(queryobj.price);
    const formate = String(queryobj.price_formate || "fixed").toLowerCase();
    if (formate === "fixed") {
      calcPrice += Number.isFinite(price) ? price : 0;
    } else {
      // percent — mirrors wc-query-flow/assets/js/publics/main.js
      if (basePrice === 0) basePrice = calcPrice > 0 ? calcPrice : 0;
      if (!Number.isFinite(price) || basePrice === 0) continue;
      const pct = Number(Number(price).toFixed(3));
      calcPrice += (basePrice / 100) * pct;
    }
  }
  if (!Number.isFinite(calcPrice) || calcPrice <= 0) return 0;
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
            const parsedBase = baseMatch ? Number(baseMatch[1]) : 0;
            const basePrice = Number.isFinite(parsedBase) && parsedBase > 0 ? parsedBase : 0;
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
