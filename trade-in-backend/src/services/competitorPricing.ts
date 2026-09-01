import type { Database } from "better-sqlite3";
import { getDb } from "../db/migrate.js";
import {
  COMPETITOR_TO_STORE,
  normalizeCondition,
  STORE_TO_COMPETITOR,
  type CompetitorCondition,
  type StoreCondition,
} from "../pricing-engine/types.js";
import { normalizeStorageLabel, storageLookupKeys } from "../pricing-engine/deviceMatch.js";

export const COMPETITOR_SOURCES = [
  { id: "univercell", label: "UniverCell", notes: "Condition-tiered buyback" },
  { id: "bell", label: "Bell", notes: "Carrier max trade-in estimate" },
  { id: "telus", label: "TELUS", notes: "Carrier market value estimate" },
  { id: "gorecell", label: "GoRecell", notes: "Product-page query_data (storage fixed $ + condition %)" },
] as const;

export type FrontendPriceSource =
  | "manual"
  | "univercell"
  | "bell"
  | "telus"
  | "gorecell"
  | "best";

export type FrontendPriceMode = "match" | "beat";

/** When a source only publishes a max (excellent), scale other grades. */
const GRADE_FROM_EXCELLENT: Record<CompetitorCondition, number> = {
  excellent: 1,
  good: 0.9,
  fair: 0.78, // GoRecell Fair ≈ store average
  cracked: 0.4, // GoRecell Cracked ≈ store fair (Cracked/Issues)
  broken: 0.1,
};

const STORE_FROM_EXCELLENT: Record<StoreCondition, number> = {
  flawless: 1,
  good: 0.9,
  average: 0.78,
  fair: 0.4,
  defective: 0.1,
};

export function ensureCompetitorSourcesSeeded(): void {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO price_sources (id, name, label, enabled)
     VALUES (?, ?, ?, 1)
     ON CONFLICT(id) DO UPDATE SET label = excluded.label, name = excluded.name`,
  );
  for (const s of COMPETITOR_SOURCES) {
    stmt.run(s.id, s.id, s.label);
  }
  const settings = db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO NOTHING`,
  );
  settings.run("frontend_price_source", "gorecell");
  settings.run("frontend_price_mode", "beat");
  settings.run("frontend_beat_percent", "2");

  // One-time promotion from legacy manual/match defaults to competitive GoRecell undercut
  const migrated = db
    .prepare(`SELECT value FROM settings WHERE key = 'pricing_defaults_v2'`)
    .get() as { value: string } | undefined;
  if (!migrated) {
    const current = db
      .prepare(
        `SELECT key, value FROM settings WHERE key IN ('frontend_price_source','frontend_price_mode','frontend_beat_percent')`,
      )
      .all() as Array<{ key: string; value: string }>;
    const map = Object.fromEntries(current.map((r) => [r.key, r.value]));
    if (map.frontend_price_source === "manual") {
      db.prepare(
        `UPDATE settings SET value = 'gorecell', updated_at = datetime('now') WHERE key = 'frontend_price_source'`,
      ).run();
    }
    if (map.frontend_price_mode === "match") {
      db.prepare(
        `UPDATE settings SET value = 'beat', updated_at = datetime('now') WHERE key = 'frontend_price_mode'`,
      ).run();
    }
    if (!map.frontend_beat_percent || map.frontend_beat_percent === "3") {
      db.prepare(
        `UPDATE settings SET value = '2', updated_at = datetime('now') WHERE key = 'frontend_beat_percent'`,
      ).run();
    }
    settings.run("pricing_defaults_v2", "1");
  }
  db.close();
}

export function getFrontendPricingConfig(): {
  source: FrontendPriceSource;
  mode: FrontendPriceMode;
  beatPercent: number;
} {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT key, value FROM settings WHERE key IN ('frontend_price_source','frontend_price_mode','frontend_beat_percent')`,
    )
    .all() as Array<{ key: string; value: string }>;
  db.close();
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const source = (map.frontend_price_source || "manual") as FrontendPriceSource;
  const mode = (map.frontend_price_mode || "match") as FrontendPriceMode;
  const beatPercent = Math.max(0, Math.min(25, Number(map.frontend_beat_percent) || 2));
  return { source, mode, beatPercent };
}

export function setFrontendPricingConfig(input: {
  source?: FrontendPriceSource;
  mode?: FrontendPriceMode;
  beatPercent?: number;
}): void {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  );
  if (input.source) stmt.run("frontend_price_source", input.source);
  if (input.mode) stmt.run("frontend_price_mode", input.mode);
  if (input.beatPercent != null) {
    stmt.run("frontend_beat_percent", String(Math.max(0, Math.min(25, input.beatPercent))));
  }
  db.close();
}

export interface CompetitorPriceRow {
  competitor_name: string;
  product_id: string | null;
  make: string;
  model: string;
  variant: string;
  condition: string;
  trade_in_price: number | null;
  sell_price: number | null;
  currency: string;
  source_url: string | null;
  scraped_at: string;
  engine: string | null;
}

/** Latest scrape per competitor × product × variant × condition */
export function listLatestCompetitorPrices(opts?: {
  productId?: string;
  q?: string;
  limit?: number;
}): CompetitorPriceRow[] {
  const db = getDb();
  const limit = Math.min(opts?.limit ?? 500, 2000);
  let sql = `
    SELECT sp.* FROM scraped_prices sp
    INNER JOIN (
      SELECT competitor_name, product_id, variant, condition, MAX(scraped_at) AS max_at
      FROM scraped_prices
      GROUP BY competitor_name, product_id, variant, condition
    ) latest ON sp.competitor_name = latest.competitor_name
      AND IFNULL(sp.product_id,'') = IFNULL(latest.product_id,'')
      AND sp.variant = latest.variant
      AND sp.condition = latest.condition
      AND sp.scraped_at = latest.max_at
    WHERE 1=1`;
  const params: unknown[] = [];
  if (opts?.productId) {
    sql += ` AND sp.product_id = ?`;
    params.push(opts.productId);
  }
  if (opts?.q) {
    sql += ` AND (sp.model LIKE ? OR sp.make LIKE ? OR sp.product_id LIKE ?)`;
    const like = `%${opts.q}%`;
    params.push(like, like, like);
  }
  sql += ` ORDER BY sp.product_id, sp.variant, sp.competitor_name, sp.condition LIMIT ?`;
  params.push(limit);
  const rows = db.prepare(sql).all(...params) as CompetitorPriceRow[];
  db.close();
  return rows;
}

export function competitorMatrix(productId: string, variant: string): Record<
  string,
  Partial<Record<CompetitorCondition, number>>
> {
  const rows = listLatestCompetitorPrices({ productId, limit: 200 }).filter(
    (r) => r.variant.toLowerCase() === variant.toLowerCase(),
  );
  const out: Record<string, Partial<Record<CompetitorCondition, number>>> = {};
  for (const r of rows) {
    const cond = normalizeCondition(r.condition);
    const price = r.trade_in_price ?? r.sell_price;
    if (!cond || !price) continue;
    if (!out[r.competitor_name]) out[r.competitor_name] = {};
    out[r.competitor_name][cond] = price;
  }
  return out;
}

function toCompetitorCondition(grade: string): CompetitorCondition {
  // Store grades first — "fair" means Cracked/Issues, not GoRecell Fair
  if (grade in STORE_TO_COMPETITOR) {
    return STORE_TO_COMPETITOR[grade as StoreCondition];
  }
  const n = normalizeCondition(grade);
  if (n) return n;
  return "good";
}

function toStoreCondition(grade: string): StoreCondition {
  if (grade in STORE_FROM_EXCELLENT) return grade as StoreCondition;
  const n = normalizeCondition(grade);
  if (n) return COMPETITOR_TO_STORE[n];
  return "good";
}

function lookupScrapedPrice(
  db: ReturnType<typeof getDb>,
  competitor: string,
  productId: string,
  variantKeys: string[],
  condition: CompetitorCondition,
): { trade_in_price: number | null; sell_price: number | null; scraped_at: string } | undefined {
  for (const variant of variantKeys) {
    const row = db
      .prepare(
        `SELECT trade_in_price, sell_price, scraped_at FROM scraped_prices
         WHERE competitor_name = ? AND product_id = ? AND LOWER(variant) = LOWER(?) AND condition = ?
         ORDER BY scraped_at DESC LIMIT 1`,
      )
      .get(competitor, productId, variant, condition) as
      | { trade_in_price: number | null; sell_price: number | null; scraped_at: string }
      | undefined;
    if (row) return row;
  }
  return undefined;
}

function lookupManualPrice(
  db: ReturnType<typeof getDb>,
  productId: string,
  variantKeys: string[],
  storeGrade: StoreCondition,
): number | undefined {
  for (const variant of variantKeys) {
    const row = db
      .prepare(
        `SELECT base_price FROM prices WHERE device_id = ? AND storage = ? AND condition_grade = ?`,
      )
      .get(productId, variant, storeGrade) as { base_price: number } | undefined;
    if (row?.base_price && row.base_price > 0) return row.base_price;
  }
  return undefined;
}

/** Resolve a price from scraped_prices for one competitor (with grade scaling fallback). */
export function resolveCompetitorPrice(input: {
  competitor: string;
  productId: string;
  variant: string;
  conditionGrade: string;
}): { price: number; conditionUsed: CompetitorCondition; scaled: boolean; scraped_at: string | null } | null {
  const cond = toCompetitorCondition(input.conditionGrade);
  const variantKeys = storageLookupKeys(input.variant);
  const db = getDb();
  const exact = lookupScrapedPrice(db, input.competitor, input.productId, variantKeys, cond);

  if (exact) {
    const price = exact.trade_in_price ?? exact.sell_price;
    if (price && price > 0) {
      db.close();
      return { price, conditionUsed: cond, scaled: false, scraped_at: exact.scraped_at };
    }
  }

  // Scale from excellent when carrier only publishes max
  const excellent = lookupScrapedPrice(db, input.competitor, input.productId, variantKeys, "excellent");
  db.close();

  if (!excellent) return null;
  const base = excellent.trade_in_price ?? excellent.sell_price;
  if (!base || base <= 0) return null;
  const mult = GRADE_FROM_EXCELLENT[cond] ?? 1;
  return {
    price: Math.round(base * mult),
    conditionUsed: cond,
    scaled: cond !== "excellent",
    scraped_at: excellent.scraped_at,
  };
}

export function resolveBestCompetitorPrice(input: {
  productId: string;
  variant: string;
  conditionGrade: string;
}): {
  price: number;
  competitor: string;
  conditionUsed: CompetitorCondition;
  scaled: boolean;
  scraped_at: string | null;
} | null {
  let best: {
    price: number;
    competitor: string;
    conditionUsed: CompetitorCondition;
    scaled: boolean;
    scraped_at: string | null;
  } | null = null;
  for (const s of COMPETITOR_SOURCES) {
    const hit = resolveCompetitorPrice({
      competitor: s.id,
      productId: input.productId,
      variant: input.variant,
      conditionGrade: input.conditionGrade,
    });
    if (!hit) continue;
    if (!best || hit.price > best.price) {
      best = { ...hit, competitor: s.id };
    }
  }
  return best;
}

export function resolveFrontendBasePrice(input: {
  productId: string;
  variant: string;
  conditionGrade: string;
}): {
  basePrice: number;
  source: string;
  mode: FrontendPriceMode;
  competitorPrice: number | null;
  scaled: boolean;
  scraped_at: string | null;
  fromManualTable: boolean;
} {
  const cfg = getFrontendPricingConfig();
  const db = getDb();
  const storeGrade = toStoreCondition(input.conditionGrade);
  const variantKeys = storageLookupKeys(input.variant);
  const manualPrice = lookupManualPrice(db, input.productId, variantKeys, storeGrade);
  db.close();

  if (cfg.source === "manual") {
    return {
      basePrice: manualPrice ?? 0,
      source: "manual",
      mode: cfg.mode,
      competitorPrice: null,
      scaled: false,
      scraped_at: null,
      fromManualTable: true,
    };
  }

  let resolved: {
    price: number;
    competitor?: string;
    conditionUsed: CompetitorCondition;
    scaled: boolean;
    scraped_at: string | null;
  } | null = null;

  if (cfg.source === "best") {
    resolved = resolveBestCompetitorPrice(input);
  } else {
    const hit = resolveCompetitorPrice({
      competitor: cfg.source,
      productId: input.productId,
      variant: input.variant,
      conditionGrade: input.conditionGrade,
    });
    if (hit) resolved = { ...hit, competitor: cfg.source };
  }

  if (!resolved) {
    // Fall back to manual prices table (already GoRecell-synced when available)
    let basePrice = manualPrice ?? 0;
    if (basePrice > 0 && cfg.mode === "beat") {
      // prices table stores raw competitor; apply beat for quote parity
      basePrice = Math.round(basePrice * (1 - cfg.beatPercent / 100));
    }
    return {
      basePrice,
      source: `${cfg.source}:fallback-manual`,
      mode: cfg.mode,
      competitorPrice: manualPrice ?? null,
      scaled: false,
      scraped_at: null,
      fromManualTable: true,
    };
  }

  let price = resolved.price;
  if (cfg.mode === "beat") {
    price = Math.round(price * (1 - cfg.beatPercent / 100));
  }

  return {
    basePrice: price,
    source: resolved.competitor || cfg.source,
    mode: cfg.mode,
    competitorPrice: resolved.price,
    scaled: resolved.scaled,
    scraped_at: resolved.scraped_at,
    fromManualTable: false,
  };
}

/** Copy latest competitor prices into the `prices` table for frontend catalog. */
export function applyCompetitorSourceToPrices(competitor: string): { upserted: number } {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT sp.product_id, sp.variant, sp.condition, sp.trade_in_price, sp.sell_price
       FROM scraped_prices sp
       INNER JOIN (
         SELECT product_id, variant, condition, MAX(scraped_at) AS max_at
         FROM scraped_prices WHERE competitor_name = ?
         GROUP BY product_id, variant, condition
       ) latest ON IFNULL(sp.product_id,'') = IFNULL(latest.product_id,'')
         AND sp.variant = latest.variant
         AND sp.condition = latest.condition
         AND sp.scraped_at = latest.max_at
       WHERE sp.competitor_name = ? AND sp.product_id IS NOT NULL`,
    )
    .all(competitor, competitor) as Array<{
    product_id: string;
    variant: string;
    condition: string;
    trade_in_price: number | null;
    sell_price: number | null;
  }>;

  const stmt = db.prepare(
    `INSERT INTO prices (device_id, storage, condition_grade, base_price, source, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(device_id, storage, condition_grade) DO UPDATE SET
       base_price = excluded.base_price, source = excluded.source, updated_at = datetime('now')`,
  );

  let upserted = 0;
  // device|storage pairs this sync wrote, so the ladder pass knows what to check.
  const touched = new Set<string>();
  const tx = db.transaction(() => {
    const byKey = new Map<string, number>();
    for (const r of rows) {
      const cond = normalizeCondition(r.condition);
      if (!cond || !r.product_id) continue;
      const store = COMPETITOR_TO_STORE[cond];
      const price = r.trade_in_price ?? r.sell_price;
      if (!price || price < 5) continue;
      const rounded = Math.round(price);
      const variant = normalizeStorageLabel(r.variant) || r.variant;
      const key = `${r.product_id}|${variant}|${store}`;
      byKey.set(key, rounded);
      stmt.run(r.product_id, variant, store, rounded, competitor);
      upserted += 1;
      touched.add(`${r.product_id}|${variant}`);
    }

    // For sources that only published excellent (Bell/TELUS), seed scaled grades
    for (const r of rows) {
      const cond = normalizeCondition(r.condition);
      if (cond !== "excellent" || !r.product_id) continue;
      const price = r.trade_in_price ?? r.sell_price;
      if (!price || price < 5) continue;
      const variant = normalizeStorageLabel(r.variant) || r.variant;
      for (const [storeGrade, mult] of Object.entries(STORE_FROM_EXCELLENT) as Array<
        [StoreCondition, number]
      >) {
        if (storeGrade === "flawless") continue;
        const key = `${r.product_id}|${variant}|${storeGrade}`;
        if (byKey.has(key)) continue;
        const scaled = Math.max(1, Math.round(price * mult));
        stmt.run(r.product_id, variant, storeGrade, scaled, `${competitor}:scaled`);
        upserted += 1;
        touched.add(`${r.product_id}|${variant}`);
      }
    }

    // Derived grades are computed from the competitor's "excellent" price, but
    // real prices for the other grades come from the competitor's own condition
    // tiers (GoRecell "Cracked" -> our "fair"). Nothing tied the two together,
    // so a scaled worse grade could land above a real better one — a Watch
    // Ultra 2 paying $43 defective against $15 fair. Enforce the ladder over
    // everything this sync touched.
    for (const key of touched) {
      const [deviceId, variant] = key.split("|");
      enforceGradeLadder(db, deviceId, variant);
    }
  });
  tx();
  db.close();
  return { upserted };
}

/** Worst -> best. A better condition must never be worth less than a worse one. */
const GRADE_LADDER: StoreCondition[] = ["defective", "fair", "average", "good", "flawless"];

/**
 * Clamp one device/storage so price never rises as condition worsens.
 *
 * Clamps the WORSE grade down rather than raising the better one: prices here
 * are what the shop pays out, so when two sources disagree the cheaper reading
 * is the safe one to keep. Returns how many rows it changed.
 */
export function enforceGradeLadder(db: Database, deviceId: string, storage: string): number {
  const rows = db
    .prepare(
      "SELECT condition_grade, base_price FROM prices WHERE device_id = ? AND storage = ? AND base_price > 0",
    )
    .all(deviceId, storage) as Array<{ condition_grade: string; base_price: number }>;
  if (rows.length < 2) return 0;

  const priceByGrade = new Map(rows.map((r) => [r.condition_grade, r.base_price]));
  const update = db.prepare(
    "UPDATE prices SET base_price = ?, updated_at = datetime('now') WHERE device_id = ? AND storage = ? AND condition_grade = ?",
  );

  let changed = 0;
  let ceiling = Infinity;
  // Walk best -> worst; each grade may not exceed the one above it.
  for (const grade of [...GRADE_LADDER].reverse()) {
    const price = priceByGrade.get(grade);
    if (price === undefined) continue;
    if (price > ceiling) {
      update.run(Math.round(ceiling), deviceId, storage, grade);
      changed += 1;
    } else {
      ceiling = price;
    }
  }
  return changed;
}
