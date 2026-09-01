import { getDb } from "../../db/migrate.js";
import {
  type CompetitorCondition,
  type PriceBaseline,
  type TrainingSample,
  variantKey,
  normalizeCondition,
} from "../types.js";
import { effectiveWeight, weightedMedian } from "./weights.js";

const MIN_SAMPLES = 3;

export interface TrainMetrics {
  baselinesUpserted: number;
  sampleCounts: Record<string, number>;
  dataSourcesUsed: string[];
  errors: string[];
  conditionMultipliers: Record<string, number>;
}

function collectSamples(db: ReturnType<typeof getDb>): TrainingSample[] {
  const samples: TrainingSample[] = [];

  // Completed offers → ground truth (quoted/final)
  const completed = db
    .prepare(
      `SELECT oi.device_id as productId, oi.storage as variant, oi.condition_grade as condition,
              COALESCE(oi.final_price, oi.quoted_price) as price, o.updated_at as observedAt
       FROM offer_items oi
       JOIN offers o ON o.id = oi.offer_id
       WHERE o.status = 'completed' AND COALESCE(oi.final_price, oi.quoted_price) > 0`,
    )
    .all() as Array<{
    productId: string | null;
    variant: string | null;
    condition: string | null;
    price: number;
    observedAt: string;
  }>;
  for (const r of completed) {
    const cond = normalizeCondition(r.condition || "");
    if (!r.productId || !r.variant || !cond) continue;
    samples.push({
      productId: r.productId,
      variant: r.variant,
      condition: cond,
      price: r.price,
      source: "completed_orders",
      observedAt: r.observedAt || new Date().toISOString(),
    });
  }

  // Inventory costs as per-unit internal
  const inv = db
    .prepare(
      `SELECT device_name, condition_grade as condition, cost as price, created_at as observedAt
       FROM inventory WHERE cost > 0`,
    )
    .all() as Array<{
    device_name: string;
    condition: string | null;
    price: number;
    observedAt: string;
  }>;
  for (const r of inv) {
    const cond = normalizeCondition(r.condition || "good") || "good";
    samples.push({
      productId: r.device_name,
      variant: "default",
      condition: cond,
      price: r.price,
      source: "per_unit_internal",
      observedAt: r.observedAt,
    });
  }

  // Competitor scrapes
  const scraped = db
    .prepare(
      `SELECT product_id, make, model, variant, condition,
              COALESCE(trade_in_price, sell_price) as price, scraped_at as observedAt
       FROM scraped_prices
       WHERE COALESCE(trade_in_price, sell_price) IS NOT NULL`,
    )
    .all() as Array<{
    product_id: string | null;
    make: string;
    model: string;
    variant: string;
    condition: string;
    price: number;
    observedAt: string;
  }>;
  for (const r of scraped) {
    const cond = normalizeCondition(r.condition);
    if (!cond || !r.price) continue;
    samples.push({
      productId: r.product_id || `${r.make}:${r.model}`,
      variant: r.variant,
      condition: cond,
      price: r.price,
      source: "competitor_scrape",
      observedAt: r.observedAt,
    });
  }

  // Manual overrides as samples too (and applied hard later)
  const overrides = db
    .prepare(`SELECT product_id, variant, condition, price, updated_at FROM price_overrides`)
    .all() as Array<{
    product_id: string;
    variant: string;
    condition: string;
    price: number;
    updated_at: string;
  }>;
  for (const r of overrides) {
    const cond = normalizeCondition(r.condition);
    if (!cond) continue;
    samples.push({
      productId: r.product_id,
      variant: r.variant,
      condition: cond,
      price: r.price,
      source: "manual_override",
      observedAt: r.updated_at,
    });
  }

  // Synthetic fillers from catalog seed prices (market_wholesale-ish)
  const catalog = db
    .prepare(
      `SELECT device_id as productId, storage as variant, condition_grade as condition,
              base_price as price, updated_at as observedAt
       FROM prices WHERE base_price > 0`,
    )
    .all() as Array<{
    productId: string;
    variant: string;
    condition: string;
    price: number;
    observedAt: string;
  }>;
  for (const r of catalog) {
    const cond = normalizeCondition(r.condition);
    if (!cond) continue;
    samples.push({
      productId: r.productId,
      variant: r.variant,
      condition: cond,
      price: r.price,
      source: "market_wholesale",
      observedAt: r.observedAt || new Date().toISOString(),
    });
  }

  return samples;
}

function deriveConditionMultipliers(
  byKey: Map<string, number>,
): Record<string, number> {
  // Average baseline ratios vs excellent per product+variant
  const ratios: Record<string, number[]> = {
    excellent: [1],
    good: [],
    fair: [],
    broken: [],
  };

  const grouped = new Map<string, Partial<Record<CompetitorCondition, number>>>();
  for (const [key, price] of byKey) {
    const [productId, variant, condition] = key.split("|") as [string, string, CompetitorCondition];
    const gk = `${productId}|${variant}`;
    const g = grouped.get(gk) || {};
    g[condition] = price;
    grouped.set(gk, g);
  }
  for (const g of grouped.values()) {
    const base = g.excellent;
    if (!base || base <= 0) continue;
    for (const c of ["good", "fair", "cracked", "broken"] as CompetitorCondition[]) {
      if (g[c] && g[c]! > 0) ratios[c].push(g[c]! / base);
    }
  }

  const out: Record<string, number> = {
    excellent: 1,
    good: avg(ratios.good) ?? 0.9,
    fair: avg(ratios.fair) ?? 0.7,
    broken: avg(ratios.broken) ?? 0.4,
  };
  return out;
}

function avg(nums: number[]): number | null {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function chunkedUpsert(baselines: PriceBaseline[], chunkSize = 200): number {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO price_baselines
      (variant_key, product_id, variant, condition, baseline_price, sample_count, source_breakdown, model, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'data-driven', datetime('now'))
     ON CONFLICT(variant_key) DO UPDATE SET
       baseline_price = excluded.baseline_price,
       sample_count = excluded.sample_count,
       source_breakdown = excluded.source_breakdown,
       updated_at = datetime('now')`,
  );
  let n = 0;
  for (let i = 0; i < baselines.length; i += chunkSize) {
    const slice = baselines.slice(i, i + chunkSize);
    const tx = db.transaction(() => {
      for (const b of slice) {
        stmt.run(
          b.variantKey,
          b.productId,
          b.variant,
          b.condition,
          b.baselinePrice,
          b.sampleCount,
          JSON.stringify(b.sourceBreakdown),
        );
        n += 1;
      }
    });
    tx();
  }
  db.close();
  return n;
}

export class PricingTraining {
  static train(): TrainMetrics {
    const errors: string[] = [];
    const started = new Date().toISOString();
    const db = getDb();
    const runInsert = db
      .prepare(`INSERT INTO pricing_train_runs (started_at, ok) VALUES (?, 0)`)
      .run(started);
    const runId = Number(runInsert.lastInsertRowid);

    let samples: TrainingSample[] = [];
    try {
      samples = collectSamples(db);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }

    const sampleCounts: Record<string, number> = {};
    const byKey = new Map<
      string,
      Array<{ value: number; weight: number; source: string }>
    >();

    for (const s of samples) {
      sampleCounts[s.source] = (sampleCounts[s.source] || 0) + 1;
      const key = variantKey(s.productId, s.variant, s.condition);
      const w = effectiveWeight(s.source, s.observedAt, s.weight);
      const list = byKey.get(key) || [];
      list.push({ value: s.price, weight: w, source: s.source });
      byKey.set(key, list);
    }

    const baselines: PriceBaseline[] = [];
    const priceMap = new Map<string, number>();

    for (const [key, list] of byKey) {
      let used = list;
      if (used.length < MIN_SAMPLES) {
        // Wider fallback: same product any variant for this condition
        const [productId, , condition] = key.split("|");
        const wider: typeof list = [];
        for (const [k2, list2] of byKey) {
          if (k2.startsWith(`${productId}|`) && k2.endsWith(`|${condition}`)) {
            wider.push(...list2);
          }
        }
        if (wider.length >= MIN_SAMPLES) used = wider;
      }

      const median = weightedMedian(used.map((u) => ({ value: u.value, weight: u.weight })));
      if (median == null || median <= 0) continue;

      const [productId, variant, condition] = key.split("|") as [
        string,
        string,
        CompetitorCondition,
      ];
      const sourceBreakdown: Record<string, number> = {};
      for (const u of used) {
        sourceBreakdown[u.source] = (sourceBreakdown[u.source] || 0) + 1;
      }

      // Hard manual override wins
      const override = db
        .prepare(`SELECT price FROM price_overrides WHERE variant_key = ?`)
        .get(key) as { price: number } | undefined;
      const baselinePrice = override?.price ?? Math.round(median);

      baselines.push({
        variantKey: key,
        productId,
        variant,
        condition,
        baselinePrice,
        sampleCount: used.length,
        sourceBreakdown,
      });
      priceMap.set(key, baselinePrice);
    }

    db.close();

    let baselinesUpserted = 0;
    try {
      baselinesUpserted = chunkedUpsert(baselines);
    } catch (e) {
      errors.push(`upsert: ${e instanceof Error ? e.message : String(e)}`);
    }

    const conditionMultipliers = deriveConditionMultipliers(priceMap);
    const db3 = getDb();
    for (const [cond, mult] of Object.entries(conditionMultipliers)) {
      db3.prepare(
        `INSERT INTO condition_multipliers (condition, multiplier, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(condition) DO UPDATE SET multiplier = excluded.multiplier, updated_at = datetime('now')`,
      ).run(cond, mult);
    }

    // Sync data-driven baselines into prices table for quote API compatibility
    const sync = db3.prepare(
      `INSERT INTO prices (device_id, storage, condition_grade, base_price, source, updated_at)
       VALUES (?, ?, ?, ?, 'data-driven-baseline', datetime('now'))
       ON CONFLICT(device_id, storage, condition_grade) DO UPDATE SET
         base_price = excluded.base_price,
         source = excluded.source,
         updated_at = datetime('now')`,
    );
    const storeMap: Record<string, string> = {
      excellent: "flawless",
      good: "good",
      fair: "average",
      broken: "defective",
    };
    const tx = db3.transaction(() => {
      for (const b of baselines) {
        const grade = storeMap[b.condition] || b.condition;
        sync.run(b.productId, b.variant, grade, b.baselinePrice);
      }
    });
    try {
      tx();
    } catch (e) {
      errors.push(`prices sync: ${e instanceof Error ? e.message : String(e)}`);
    }

    db3.prepare(
      `UPDATE pricing_train_runs SET finished_at = datetime('now'), baselines_upserted = ?,
        sample_counts_json = ?, data_sources_used = ?, errors_json = ?, ok = ? WHERE id = ?`,
    ).run(
      baselinesUpserted,
      JSON.stringify(sampleCounts),
      JSON.stringify(Object.keys(sampleCounts)),
      JSON.stringify(errors),
      errors.length ? 0 : 1,
      runId,
    );
    db3.close();

    return {
      baselinesUpserted,
      sampleCounts,
      dataSourcesUsed: Object.keys(sampleCounts),
      errors,
      conditionMultipliers,
    };
  }
}
