import type { ScrapedPrice, ScraperResult } from "./types.js";
import { variantKey } from "./types.js";

export interface DualDiffReport {
  leftEngine: string;
  rightEngine: string;
  leftCount: number;
  rightCount: number;
  overlappingKeys: number;
  onlyLeft: number;
  onlyRight: number;
  avgAbsDeltaPct: number | null;
  maxAbsDeltaPct: number | null;
  mismatchSamples: Array<{
    key: string;
    left: number | null;
    right: number | null;
    deltaPct: number | null;
  }>;
  alert: boolean;
  alertReasons: string[];
}

function priceOf(r: ScrapedPrice): number | null {
  return r.trade_in_price ?? r.sell_price;
}

function keyOf(r: ScrapedPrice): string {
  const pid = r.product_id || `${r.make}:${r.model}`;
  return variantKey(pid, r.variant, r.condition);
}

/**
 * Diff two engine outputs on the same target set.
 * Alerts when row counts or overlapping prices drift.
 */
export function compareEngineResults(
  left: ScraperResult,
  right: ScraperResult,
  opts?: { rowCountDriftPct?: number; priceDeltaAlertPct?: number },
): DualDiffReport {
  const rowDrift = opts?.rowCountDriftPct ?? 0.35;
  const priceAlert = opts?.priceDeltaAlertPct ?? 0.15;

  const leftMap = new Map(left.rows.map((r) => [keyOf(r), r]));
  const rightMap = new Map(right.rows.map((r) => [keyOf(r), r]));

  const allKeys = new Set([...leftMap.keys(), ...rightMap.keys()]);
  let overlapping = 0;
  let onlyLeft = 0;
  let onlyRight = 0;
  const deltas: number[] = [];
  const mismatchSamples: DualDiffReport["mismatchSamples"] = [];

  for (const k of allKeys) {
    const L = leftMap.get(k);
    const R = rightMap.get(k);
    if (L && R) {
      overlapping += 1;
      const lp = priceOf(L);
      const rp = priceOf(R);
      let deltaPct: number | null = null;
      if (lp != null && rp != null && Math.max(lp, rp) > 0) {
        deltaPct = Math.abs(lp - rp) / Math.max(lp, rp);
        deltas.push(deltaPct);
        if (deltaPct >= priceAlert) {
          mismatchSamples.push({ key: k, left: lp, right: rp, deltaPct });
        }
      }
    } else if (L) onlyLeft += 1;
    else onlyRight += 1;
  }

  const avgAbsDeltaPct = deltas.length
    ? deltas.reduce((a, b) => a + b, 0) / deltas.length
    : null;
  const maxAbsDeltaPct = deltas.length ? Math.max(...deltas) : null;

  const alertReasons: string[] = [];
  const maxCount = Math.max(left.rows.length, right.rows.length, 1);
  const countDrift =
    Math.abs(left.rows.length - right.rows.length) / maxCount;
  if (countDrift > rowDrift) {
    alertReasons.push(
      `row count drift ${(countDrift * 100).toFixed(1)}% (left=${left.rows.length}, right=${right.rows.length})`,
    );
  }
  if (maxAbsDeltaPct != null && maxAbsDeltaPct >= priceAlert) {
    alertReasons.push(
      `price delta max ${(maxAbsDeltaPct * 100).toFixed(1)}% across ${mismatchSamples.length} keys`,
    );
  }
  if (overlapping === 0 && (left.rows.length > 0 || right.rows.length > 0)) {
    alertReasons.push("zero overlapping keys between engines");
  }

  return {
    leftEngine: left.engine,
    rightEngine: right.engine,
    leftCount: left.rows.length,
    rightCount: right.rows.length,
    overlappingKeys: overlapping,
    onlyLeft,
    onlyRight,
    avgAbsDeltaPct,
    maxAbsDeltaPct,
    mismatchSamples: mismatchSamples.slice(0, 20),
    alert: alertReasons.length > 0,
    alertReasons,
  };
}

/** Prefer engine by env: scrapling | cheerio | playwright */
export function pickPreferredRows(
  a: ScraperResult,
  b: ScraperResult,
  preferred?: string,
): ScrapedPrice[] {
  const pref = (preferred || process.env.TG_SCRAPE_PREFERRED_ENGINE || "scrapling").toLowerCase();
  if (a.engine === pref) return a.rows;
  if (b.engine === pref) return b.rows;
  // fall back to denser result
  return a.rows.length >= b.rows.length ? a.rows : b.rows;
}
