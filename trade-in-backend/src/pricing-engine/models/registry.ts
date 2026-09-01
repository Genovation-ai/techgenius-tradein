import { getDb } from "../../db/migrate.js";
import {
  COMPETITOR_TO_STORE,
  normalizeCondition,
  STORE_TO_COMPETITOR,
  type CompetitorCondition,
  type PricingModelId,
  type QuoteContext,
  type QuoteResult,
  variantKey,
} from "../types.js";

export interface PricingModel {
  id: PricingModelId;
  quote(ctx: QuoteContext): QuoteResult;
}

function toCompetitorCondition(c: QuoteContext["condition"]): CompetitorCondition {
  if (c in STORE_TO_COMPETITOR) return STORE_TO_COMPETITOR[c as keyof typeof STORE_TO_COMPETITOR];
  const n = normalizeCondition(String(c));
  if (n) return n;
  return "good";
}

function loadBaseline(productId: string, variant: string, condition: CompetitorCondition): number | null {
  const db = getDb();
  const key = variantKey(productId, variant, condition);
  const row = db
    .prepare(`SELECT baseline_price FROM price_baselines WHERE variant_key = ?`)
    .get(key) as { baseline_price: number } | undefined;
  if (row) {
    db.close();
    return row.baseline_price;
  }
  // fallback prices table
  const store = COMPETITOR_TO_STORE[condition];
  const p = db
    .prepare(
      `SELECT base_price FROM prices WHERE device_id = ? AND storage = ? AND condition_grade = ?`,
    )
    .get(productId, variant, store) as { base_price: number } | undefined;
  db.close();
  return p?.base_price ?? null;
}

function bestCompetitor(
  productId: string,
  variant: string,
  condition: CompetitorCondition,
): number | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT MAX(COALESCE(trade_in_price, sell_price)) as best
       FROM scraped_prices
       WHERE product_id = ? AND variant = ? AND condition = ?
         AND scraped_at >= datetime('now', '-30 days')`,
    )
    .get(productId, variant, condition) as { best: number | null };
  db.close();
  return row.best && row.best > 0 ? row.best : null;
}

/** Undercut best competitor by X%, never below ~85% of highest competitor. */
export const competitorBeatModel: PricingModel = {
  id: "competitor-beat",
  quote(ctx) {
    const condition = toCompetitorCondition(ctx.condition);
    const best = bestCompetitor(ctx.productId, ctx.variant, condition);
    const baseline = loadBaseline(ctx.productId, ctx.variant, condition);
    const undercut = ctx.competitorBeatPercent ?? 0.03;
    if (best == null) {
      const fallback = baseline ?? ctx.msrpOrCost ?? 0;
      return {
        model: "competitor-beat",
        quotedPrice: Math.max(1, Math.round(fallback)),
        baseline,
        competitorBest: null,
        floor: null,
        meta: { reason: "no-competitor-data-fallback" },
      };
    }
    const raw = best * (1 - undercut);
    const floor = best * 0.85;
    const quoted = Math.max(floor, raw);
    return {
      model: "competitor-beat",
      quotedPrice: Math.max(1, Math.round(quoted)),
      baseline,
      competitorBest: best,
      floor,
      meta: { undercut },
    };
  },
};

/** Use learned weighted-median baseline. */
export const dataDrivenModel: PricingModel = {
  id: "data-driven",
  quote(ctx) {
    const condition = toCompetitorCondition(ctx.condition);
    const baseline = loadBaseline(ctx.productId, ctx.variant, condition);
    const best = bestCompetitor(ctx.productId, ctx.variant, condition);
    const quoted = baseline ?? best ?? ctx.msrpOrCost ?? 0;
    return {
      model: "data-driven",
      quotedPrice: Math.max(1, Math.round(quoted)),
      baseline,
      competitorBest: best,
      floor: null,
      meta: {},
    };
  },
};

/** Simple margin off cost/msrp (default 55% of msrp as trade-in). */
export const simpleMarginModel: PricingModel = {
  id: "simple-margin",
  quote(ctx) {
    const condition = toCompetitorCondition(ctx.condition);
    const baseline = loadBaseline(ctx.productId, ctx.variant, condition);
    const cost = ctx.msrpOrCost ?? baseline ?? 0;
    const mults: Record<CompetitorCondition, number> = {
      excellent: 0.55,
      good: 0.48,
      fair: 0.4,
      cracked: 0.28,
      broken: 0.15,
    };
    const quoted = cost * (mults[condition] ?? 0.4);
    return {
      model: "simple-margin",
      quotedPrice: Math.max(1, Math.round(quoted)),
      baseline,
      competitorBest: null,
      floor: null,
      meta: { marginOf: "msrpOrCost", multiplier: mults[condition] },
    };
  },
};

const REGISTRY: Record<PricingModelId, PricingModel> = {
  "competitor-beat": competitorBeatModel,
  "data-driven": dataDrivenModel,
  "simple-margin": simpleMarginModel,
};

export function getPricingModel(id?: PricingModelId | string): PricingModel {
  const key = (id || process.env.TG_PRICING_MODEL || "data-driven") as PricingModelId;
  return REGISTRY[key] || dataDrivenModel;
}

export function quoteWithModel(ctx: QuoteContext): QuoteResult {
  return getPricingModel(ctx.model).quote(ctx);
}

export function listPricingModels(): PricingModelId[] {
  return Object.keys(REGISTRY) as PricingModelId[];
}
