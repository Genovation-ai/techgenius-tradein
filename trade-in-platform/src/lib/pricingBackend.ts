import { PROMO_CODES, storageBoost, type Carrier, type ConditionGrade, type ExteriorCondition } from "../data/catalog";
import { pricingSnapshot, snapshotKey } from "../data/pricingSnapshot";

export type PriceSource = "tech-genius-local" | "local-market" | "international-market";

export interface SourcePricePoint {
  source: PriceSource;
  modelId: string;
  grade: ConditionGrade;
  value: number;
  capturedAt: string;
}

export interface PricingTuning {
  globalPercent: number;
  globalAmount: number;
  byGradePercent: Partial<Record<ConditionGrade, number>>;
}

export interface PricingContext {
  marketAverage: number | null;
  sourceBreakdown: Record<PriceSource, number | null>;
  sourceCount: number;
  capturedAt: string | null;
}

const SOURCE_WEIGHTS: Record<PriceSource, number> = {
  "tech-genius-local": 0.5,
  "local-market": 0.3,
  "international-market": 0.2,
};

export const defaultPricingTuning: PricingTuning = {
  globalPercent: 0,
  globalAmount: 0,
  byGradePercent: {
    flawless: 0,
    good: 0,
    average: 0,
    fair: 0,
    defective: 0,
  },
};

export const exteriorConditionDescriptions: Record<ExteriorCondition, string> = {
  none: "Looks almost brand new with no visible wear.",
  minor: "Light signs of use, no deep scratches or dents.",
  visible: "Noticeable wear and scratches from daily use.",
  heavy: "Significant cosmetic wear, dents, or heavy marks.",
  cracks: "Cracked glass or visible physical damage.",
};

export function buildPricingContext(points: SourcePricePoint[]): PricingContext {
  if (!points.length) {
    return {
      marketAverage: null,
      sourceBreakdown: {
        "tech-genius-local": null,
        "local-market": null,
        "international-market": null,
      },
      sourceCount: 0,
      capturedAt: null,
    };
  }

  const bySource = new Map<PriceSource, number[]>();
  for (const p of points) {
    const list = bySource.get(p.source) ?? [];
    list.push(p.value);
    bySource.set(p.source, list);
  }

  const sourceBreakdown: PricingContext["sourceBreakdown"] = {
    "tech-genius-local": avg(bySource.get("tech-genius-local") ?? []),
    "local-market": avg(bySource.get("local-market") ?? []),
    "international-market": avg(bySource.get("international-market") ?? []),
  };

  let weighted = 0;
  let totalWeight = 0;
  for (const source of Object.keys(SOURCE_WEIGHTS) as PriceSource[]) {
    const value = sourceBreakdown[source];
    if (value === null) continue;
    weighted += value * SOURCE_WEIGHTS[source];
    totalWeight += SOURCE_WEIGHTS[source];
  }

  return {
    marketAverage: totalWeight > 0 ? weighted / totalWeight : null,
    sourceBreakdown,
    sourceCount: points.length,
    capturedAt: points.map((p) => p.capturedAt).sort().at(-1) ?? null,
  };
}

export function quoteDeviceOffer(input: {
  basePrice: number;
  storage: string;
  grade: ConditionGrade;
  carrier: Carrier | null;
  batteryHealth: number | null;
  promoCode?: string | null;
  pricingContext?: PricingContext | null;
  tuning?: PricingTuning;
  /** When set (from API matrix), already includes storage + grade — do not re-scale. */
  matrixPrice?: number | null;
}): number {
  const carrierFactor = input.carrier === "Unlocked" ? 1.04 : 1;
  const batteryFactor = batteryHealthFactor(input.batteryHealth);

  let total: number;
  if (input.matrixPrice != null && input.matrixPrice > 0) {
    // Server/catalog matrix is already per-storage × grade (and beat-adjusted).
    total = input.matrixPrice * carrierFactor * batteryFactor;
  } else {
    const storageFactor = 1 + (storageBoost[input.storage] ?? 0);
    const gradeFactor = conditionMultiplier(input.grade);
    const marketFactor = marketAdjustmentFactor(
      input.basePrice,
      input.pricingContext?.marketAverage ?? null,
    );
    total =
      input.basePrice * storageFactor * gradeFactor * carrierFactor * batteryFactor * marketFactor;
  }

  const tuning = input.tuning ?? defaultPricingTuning;
  total *= 1 + tuning.globalPercent + (tuning.byGradePercent[input.grade] ?? 0);
  total += tuning.globalAmount;

  const code = (input.promoCode ?? "").trim().toUpperCase();
  if (code && PROMO_CODES[code]) total *= 1 + PROMO_CODES[code];

  return Math.max(1, Math.round(total));
}

export function getSourcePointsForQuote(input: {
  modelId: string;
  grade: ConditionGrade;
  basePrice: number;
}): SourcePricePoint[] {
  const key = snapshotKey(input.modelId, input.grade);
  const fromSnapshot = pricingSnapshot.pointsByKey[key];
  if (fromSnapshot && fromSnapshot.length) return fromSnapshot;
  return fallbackSourcePointsForQuote(input);
}

export function getSnapshotPricingMeta(input: { modelId: string; grade: ConditionGrade }): {
  sourceCount: number;
  sourceVersion: string;
} {
  const key = snapshotKey(input.modelId, input.grade);
  const points = pricingSnapshot.pointsByKey[key];
  return {
    sourceCount: points?.length ?? 0,
    sourceVersion: pricingSnapshot.sourceVersion,
  };
}

/**
 * NOT CUSTOMER-FACING. Do not wire this into the offer the shopper sees.
 *
 * These points are invented: the base price multiplied by fixed factors and
 * stamped `capturedAt: now`, under source names no scraper ever writes
 * ('tech-genius-local', 'local-market', 'international-market'). They look like
 * real market data and are not.
 *
 * The widget used to fall back to a quote derived from these whenever the API
 * call failed, so an outage silently produced an invented cash offer. The offer
 * now comes from the server or is reported as unavailable. Retained only for
 * the local estimate unit tests.
 */
export function fallbackSourcePointsForQuote(input: {
  modelId: string;
  grade: ConditionGrade;
  basePrice: number;
}): SourcePricePoint[] {
  const now = new Date().toISOString();
  return [
    {
      source: "tech-genius-local",
      modelId: input.modelId,
      grade: input.grade,
      value: Math.round(input.basePrice * 1.01),
      capturedAt: now,
    },
    {
      source: "local-market",
      modelId: input.modelId,
      grade: input.grade,
      value: Math.round(input.basePrice * 0.97),
      capturedAt: now,
    },
    {
      source: "international-market",
      modelId: input.modelId,
      grade: input.grade,
      value: Math.round(input.basePrice * 0.94),
      capturedAt: now,
    },
  ];
}

function conditionMultiplier(grade: ConditionGrade): number {
  switch (grade) {
    case "flawless":
      return 1;
    case "good":
      return 0.9;
    case "average":
      return 0.78;
    case "fair":
      return 0.62;
    case "defective":
      return 0.4;
  }
}

function batteryHealthFactor(batteryHealth: number | null): number {
  if (batteryHealth === null) return 1;
  if (batteryHealth < 80) return 0.88;
  if (batteryHealth < 85) return 0.94;
  if (batteryHealth < 90) return 0.98;
  return 1;
}

function marketAdjustmentFactor(basePrice: number, marketAverage: number | null): number {
  if (!marketAverage || basePrice <= 0) return 1;
  const ratio = marketAverage / basePrice;
  return clamp(ratio, 0.82, 1.18);
}

function avg(nums: number[]): number | null {
  if (!nums.length) return null;
  return nums.reduce((sum, n) => sum + n, 0) / nums.length;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
