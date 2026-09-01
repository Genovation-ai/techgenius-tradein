/**
 * Full-catalog GoRecell price sync.
 * For every mapped device: scrape product-page query_data, replace guessed
 * storages with real storage tiers, and write exact prices per storage × grade.
 */
import { getDb } from "../db/migrate.js";
import {
  computeQueryFlowPrice,
  parseQueryData,
} from "../pricing-engine/adapters/gorecellStepFlowAdapter.js";
import { persistScrapedRows } from "../pricing-engine/orchestrator.js";
import {
  COMPETITOR_TO_STORE,
  type CompetitorCondition,
  type ScrapedPrice,
  type StoreCondition,
} from "../pricing-engine/types.js";
import { normalizeStorageLabel } from "../pricing-engine/deviceMatch.js";
import {
  applyCompetitorSourceToPrices,
  getFrontendPricingConfig,
  setFrontendPricingConfig,
} from "./competitorPricing.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const STEP_FLOW = "https://gorecell.ca/step-flow/";
const PRODUCT_BASE = "https://gorecell.ca/product/";

const COND_MAP: Array<{ label: RegExp; condition: CompetitorCondition }> = [
  { label: /^like\s*new$/i, condition: "excellent" },
  { label: /^good$/i, condition: "good" },
  { label: /^fair$/i, condition: "fair" },
  { label: /^cracked/i, condition: "cracked" },
  { label: /^defective$/i, condition: "broken" },
];

interface StepProduct {
  _id?: number | string;
  _name?: string;
  _url?: string;
  name?: string;
}

interface QueryRule {
  title: string;
  price: string;
  price_formate: string;
}

interface QueryQuestion {
  title: string;
  rules: Record<string, QueryRule>;
}

type QueryData = Record<string, QueryQuestion>;

export interface CatalogSyncOptions {
  /** Cap devices processed (0 = all). */
  limit?: number;
  /** Pause between product fetches (ms). */
  delayMs?: number;
  /** When true (default), set frontend mode to beat so quotes undercut slightly. */
  applyBeat?: boolean;
  /** Override beat percent when applyBeat is true (default 2). */
  beatPercent?: number;
  /** Set frontend source to gorecell after sync (default true). */
  setFrontend?: boolean;
  /** Optional device id filter (substring match). */
  deviceFilter?: string;
  onProgress?: (info: { done: number; total: number; deviceId: string; ok: boolean }) => void;
}

export interface CatalogSyncResult {
  ok: boolean;
  devicesAttempted: number;
  devicesOk: number;
  devicesFailed: number;
  storagesUpdated: number;
  priceRowsUpserted: number;
  scrapedRows: number;
  errors: string[];
  durationMs: number;
  frontend?: ReturnType<typeof getFrontendPricingConfig>;
}

async function fetchHtml(url: string, retries = 3): Promise<{ ok: boolean; status: number; html: string }> {
  let lastStatus = 0;
  let lastHtml = "";
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-CA,en;q=0.9",
      },
    });
    lastStatus = res.status;
    lastHtml = await res.text();
    if (res.ok) return { ok: true, status: res.status, html: lastHtml };
    // Back off on rate limits / transient errors
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      await sleep(800 * (attempt + 1) * (attempt + 1));
      continue;
    }
    break;
  }
  return { ok: false, status: lastStatus, html: lastHtml };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function loadStepFlowIndex(): Promise<{
  byId: Map<string, StepProduct>;
  byUrlSlug: Map<string, StepProduct>;
}> {
  const byId = new Map<string, StepProduct>();
  const byUrlSlug = new Map<string, StepProduct>();
  try {
    const { ok, html } = await fetchHtml(STEP_FLOW);
    if (!ok) return { byId, byUrlSlug };
    const m = html.match(/var\s+products\s*=\s*(\[[\s\S]*?\]);/);
    if (!m) return { byId, byUrlSlug };
    const products = JSON.parse(m[1]) as StepProduct[];
    for (const p of products) {
      if (p._id != null) byId.set(String(p._id), p);
      const url = String(p._url || "");
      const slug = url.match(/\/product\/([^/]+)/)?.[1];
      if (slug) byUrlSlug.set(slug.toLowerCase(), p);
    }
  } catch {
    /* fall back to slug URLs */
  }
  return { byId, byUrlSlug };
}

function findStorageQuestion(data: QueryData): QueryQuestion | null {
  for (const q of Object.values(data)) {
    if (/storage|capacity|gb|size/i.test(q.title)) return q;
  }
  for (const q of Object.values(data)) {
    const titles = Object.values(q.rules || {}).map((r) => r.title);
    if (titles.some((t) => /\d+\s*gb|\d+\s*tb|\d+\s*mm/i.test(t))) return q;
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

function mapConditionRules(
  q: QueryQuestion,
): Array<{ condition: CompetitorCondition; rule: QueryRule; label: string }> {
  const out: Array<{ condition: CompetitorCondition; rule: QueryRule; label: string }> = [];
  const used = new Set<string>();
  for (const { label, condition } of COND_MAP) {
    const rule = Object.values(q.rules || {}).find((r) => label.test(r.title.trim()));
    if (!rule || used.has(condition)) continue;
    used.add(condition);
    out.push({ condition, rule, label: rule.title });
  }
  return out;
}

function parseBasePrice(html: string): number {
  const baseMatch =
    html.match(/class="[^"]*product-price[^"]*"[^>]*data-price="([^"]*)"/i) ||
    html.match(/data-price="([^"]*)"[^>]*class="[^"]*product-price/i);
  return baseMatch ? Number(baseMatch[1]) || 0 : 0;
}

function brandFromDevice(brandId: string | null, name: string): string {
  if (brandId) {
    const base = brandId.replace(
      /-(smartphone|tablet|smartwatch|laptop|computer|gaming-console|vr|monitor)$/i,
      "",
    );
    return base
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }
  return name.split(/\s+/)[0] || "Unknown";
}

function isLikelyRamNotStorage(label: string, allLabels: string[], categoryId?: string): boolean {
  // Macs / desktops often price by RAM in GoRecell query_data — keep those
  if (categoryId === "laptop" || categoryId === "computer" || categoryId === "monitor") {
    return false;
  }
  const m = label.match(/^(\d+)GB$/i);
  if (!m) return false;
  const n = Number(m[1]);
  if (n > 16) return false;
  return allLabels.some((t) => {
    const g = t.match(/^(\d+)GB$/i);
    const tb = /\d+\s*TB/i.test(t);
    return tb || (g && Number(g[1]) >= 32);
  });
}

/**
 * Sync exact per-storage GoRecell prices into scraped_prices + prices,
 * and correct device.storages from live query_data (drops RAM false-positives).
 */
export async function syncGorecellCatalogPrices(
  opts: CatalogSyncOptions = {},
): Promise<CatalogSyncResult> {
  const started = Date.now();
  const delayMs = opts.delayMs ?? 120;
  const errors: string[] = [];
  let devicesOk = 0;
  let devicesFailed = 0;
  let storagesUpdated = 0;
  let priceRowsUpserted = 0;
  const scraped: ScrapedPrice[] = [];
  const scrapedAt = new Date().toISOString();

  const db = getDb();
  let maps = db
    .prepare(
      `SELECT key, value FROM settings WHERE key LIKE 'gorecell_product_map:%' ORDER BY key`,
    )
    .all() as Array<{ key: string; value: string }>;
  db.close();

  if (opts.deviceFilter) {
    const f = opts.deviceFilter.toLowerCase();
    if (f.startsWith("id:") || f.startsWith("gorecell_product_map:")) {
      const id = f.replace(/^id:/, "").replace(/^gorecell_product_map:/, "");
      maps = maps.filter((m) => m.key === `gorecell_product_map:${id}`);
    } else {
      maps = maps.filter((m) => m.key.toLowerCase().includes(f));
    }
  }
  if (opts.limit && opts.limit > 0) {
    maps = maps.slice(0, opts.limit);
  }

  const { byId, byUrlSlug } = await loadStepFlowIndex();
  const total = maps.length;

  for (let i = 0; i < maps.length; i++) {
    const { key, value: gorecellId } = maps[i];
    const deviceId = key.replace(/^gorecell_product_map:/, "");

    const dbDev = getDb();
    const device = dbDev
      .prepare(
        `SELECT id, name, brand_id, category_id, storages FROM devices WHERE id = ? AND enabled = 1`,
      )
      .get(deviceId) as
      | { id: string; name: string; brand_id: string; category_id: string; storages: string }
      | undefined;
    dbDev.close();

    if (!device) {
      devicesFailed += 1;
      errors.push(`missing device ${deviceId}`);
      opts.onProgress?.({ done: i + 1, total, deviceId, ok: false });
      continue;
    }

    const product = byId.get(String(gorecellId)) || byUrlSlug.get(deviceId.toLowerCase());
    const url = (product?._url && String(product._url)) || `${PRODUCT_BASE}${deviceId}/`;

    try {
      const { ok, status, html } = await fetchHtml(url);
      if (!ok) {
        devicesFailed += 1;
        errors.push(`${deviceId}: HTTP ${status} @ ${url}`);
        opts.onProgress?.({ done: i + 1, total, deviceId, ok: false });
        if (delayMs) await sleep(delayMs);
        continue;
      }

      const data = parseQueryData(html) as QueryData | null;
      if (!data) {
        devicesFailed += 1;
        errors.push(`${deviceId}: no query_data @ ${url}`);
        opts.onProgress?.({ done: i + 1, total, deviceId, ok: false });
        if (delayMs) await sleep(delayMs);
        continue;
      }

      const storageQ = findStorageQuestion(data);
      const conditionQ = findConditionQuestion(data);
      if (!conditionQ) {
        devicesFailed += 1;
        errors.push(`${deviceId}: missing condition @ ${url}`);
        opts.onProgress?.({ done: i + 1, total, deviceId, ok: false });
        if (delayMs) await sleep(delayMs);
        continue;
      }

      const conditions = mapConditionRules(conditionQ);
      if (!conditions.length) {
        devicesFailed += 1;
        errors.push(`${deviceId}: no mappable conditions @ ${url}`);
        opts.onProgress?.({ done: i + 1, total, deviceId, ok: false });
        if (delayMs) await sleep(delayMs);
        continue;
      }

      const storageRules = storageQ ? Object.values(storageQ.rules || {}) : [];
      const rawLabels = storageRules.map((r) => normalizeStorageLabel(r.title));
      const storages: string[] = [];
      const seen = new Set<string>();
      for (const label of rawLabels) {
        if (!label || seen.has(label)) continue;
        if (isLikelyRamNotStorage(label, rawLabels, device.category_id)) continue;
        seen.add(label);
        storages.push(label);
      }
      if (!storages.length) storages.push("default");

      const basePrice = parseBasePrice(html);
      const make = brandFromDevice(device.brand_id, device.name);
      const devicePrices: Array<{ storage: string; grade: StoreCondition; price: number }> = [];

      const rulesToPrice: Array<{ variant: string; rule: QueryRule }> =
        storageRules.length > 0
          ? storageRules
              .map((rule) => ({ variant: normalizeStorageLabel(rule.title), rule }))
              .filter((x) => storages.includes(x.variant))
          : [{ variant: "default", rule: { title: "default", price: "0", price_formate: "fixed" } }];

      for (const { variant, rule } of rulesToPrice) {
        for (const { condition, rule: condRule, label } of conditions) {
          const price = computeQueryFlowPrice(rule, condRule, basePrice);
          if (!price || price < 5) continue;
          const storeGrade = COMPETITOR_TO_STORE[condition];
          devicePrices.push({ storage: variant, grade: storeGrade, price });
          scraped.push({
            competitor_name: "gorecell",
            make,
            model: device.name,
            product_id: deviceId,
            variant,
            condition,
            trade_in_price: price,
            sell_price: null,
            currency: "CAD",
            raw: {
              source: url,
              engine: "gorecell-query-flow",
              payload: {
                storage: rule.title,
                storagePrice: rule.price,
                condition: label,
                conditionPrice: condRule.price,
                conditionFormat: condRule.price_formate,
                computed: price,
              },
            },
            scraped_at: scrapedAt,
          });
        }
      }

      const allowed = new Set(devicePrices.map((p) => p.storage));
      // Only expose storage tiers that actually have live prices
      const pricedStorages = storages.filter((s) => allowed.has(s));
      const finalStorages = pricedStorages.length ? pricedStorages : storages;

      const dbWrite = getDb();
      const tx = dbWrite.transaction(() => {
        // Drop storage tiers this competitor no longer offers — but only rows
        // THIS sync owns.
        //
        // A partial scrape is normal: GoRecell can return 128GB and miss 256GB
        // on a flaky load. The previous version deleted every price row for the
        // missing tiers regardless of origin, so one bad page permanently wiped
        // manual, baseline and seeded prices and stripped those capacities off
        // the device. Restricting the delete to `source LIKE 'gorecell%'` means
        // a partial scrape can only retire its own stale rows; independently
        // sourced prices survive and keep the device quotable.
        const existing = dbWrite
          .prepare(
            `SELECT storage FROM prices WHERE device_id = ? AND source LIKE 'gorecell%'`,
          )
          .all(deviceId) as Array<{ storage: string }>;
        const keep = new Set(finalStorages);
        for (const row of existing) {
          if (!keep.has(row.storage)) {
            dbWrite
              .prepare(
                `DELETE FROM prices WHERE device_id = ? AND storage = ? AND source LIKE 'gorecell%'`,
              )
              .run(deviceId, row.storage);
          }
        }

        const upsert = dbWrite.prepare(
          `INSERT INTO prices (device_id, storage, condition_grade, base_price, source, updated_at)
           VALUES (?, ?, ?, ?, 'gorecell', datetime('now'))
           ON CONFLICT(device_id, storage, condition_grade) DO UPDATE SET
             base_price = excluded.base_price, source = excluded.source, updated_at = datetime('now')`,
        );
        for (const p of devicePrices) {
          upsert.run(deviceId, p.storage, p.grade, p.price);
          priceRowsUpserted += 1;
        }

        // Offer exactly the tiers that ended up priced — computed after the
        // writes, from any source, so a partial scrape narrows the picker only
        // when a tier genuinely has no price left. Falls back to the declared
        // list if somehow nothing is priced, so a device never loses every
        // option to a bad run.
        const pricedNow = (
          dbWrite
            .prepare(
              `SELECT DISTINCT storage FROM prices WHERE device_id = ? AND base_price > 0`,
            )
            .all(deviceId) as Array<{ storage: string }>
        ).map((r) => r.storage);
        const offered = storages.filter((s) => pricedNow.includes(s));
        const extras = pricedNow.filter((s) => !storages.includes(s));
        const nextStorages = [...offered, ...extras];
        dbWrite
          .prepare(`UPDATE devices SET storages = ? WHERE id = ?`)
          .run(JSON.stringify(nextStorages.length ? nextStorages : storages), deviceId);

        dbWrite
          .prepare(
            `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
          )
          .run(`gorecell_product_url:${deviceId}`, url);
      });
      tx();
      dbWrite.close();

      storagesUpdated += 1;
      devicesOk += 1;
      opts.onProgress?.({ done: i + 1, total, deviceId, ok: true });
    } catch (e) {
      devicesFailed += 1;
      errors.push(`${deviceId}: ${e instanceof Error ? e.message : String(e)}`);
      opts.onProgress?.({ done: i + 1, total, deviceId, ok: false });
    }

    if (delayMs) await sleep(delayMs);
  }

  const scrapedRows = scraped.length ? persistScrapedRows(scraped, "gorecell-query-flow") : 0;

  if (opts.setFrontend !== false) {
    const beat = opts.beatPercent ?? 2;
    setFrontendPricingConfig({
      source: "gorecell",
      mode: opts.applyBeat === false ? "match" : "beat",
      beatPercent: beat,
    });
  }

  // Mirror latest scraped into prices (keeps fair/average bridge consistent)
  applyCompetitorSourceToPrices("gorecell");

  return {
    ok: devicesOk > 0,
    devicesAttempted: total,
    devicesOk,
    devicesFailed,
    storagesUpdated,
    priceRowsUpserted,
    scrapedRows,
    errors: errors.slice(0, 80),
    durationMs: Date.now() - started,
    frontend: getFrontendPricingConfig(),
  };
}
