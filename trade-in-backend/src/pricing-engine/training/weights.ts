/** Trust weights + recency decay for training samples. */

import type { SignalSource } from "../types.js";

export const SOURCE_WEIGHTS: Record<SignalSource, number> = {
  manual_override: 1.25, // highest — applied as hard override separately too
  completed_orders: 1.0,
  per_unit_internal: 0.9,
  confirmed_sales: 0.85,
  market_wholesale: 0.7,
  competitor_scrape: 0.6,
  synthetic: 0.4,
};

/** Full weight for <90 days; linear decay to ~0.25 by 365 days. */
export function recencyDecay(observedAtIso: string, now = Date.now()): number {
  const t = new Date(observedAtIso).getTime();
  if (!Number.isFinite(t)) return 0.5;
  const ageDays = Math.max(0, (now - t) / 86_400_000);
  if (ageDays <= 90) return 1;
  if (ageDays >= 365) return 0.25;
  const x = (ageDays - 90) / (365 - 90);
  return 1 - x * 0.75;
}

export function effectiveWeight(
  source: SignalSource,
  observedAtIso: string,
  override?: number,
): number {
  const base = override ?? SOURCE_WEIGHTS[source] ?? 0.5;
  return base * recencyDecay(observedAtIso);
}

/**
 * Weighted median: expand to cumulative weight, pick mid-weight value.
 * `samples` are { value, weight }.
 */
export function weightedMedian(samples: Array<{ value: number; weight: number }>): number | null {
  const cleaned = samples
    .filter((s) => Number.isFinite(s.value) && s.weight > 0)
    .sort((a, b) => a.value - b.value);
  if (!cleaned.length) return null;
  const total = cleaned.reduce((s, x) => s + x.weight, 0);
  if (total <= 0) return null;
  const mid = total / 2;
  let acc = 0;
  for (const s of cleaned) {
    acc += s.weight;
    if (acc >= mid) return s.value;
  }
  return cleaned[cleaned.length - 1].value;
}
