import type { ConditionGrade } from "../data/catalog";
import type { SourcePricePoint } from "../lib/pricingBackend";

/**
 * Pricing snapshot placeholder — intentionally empty, and no longer on any
 * customer-facing path.
 *
 * Real prices come from the backend (`POST /api/quote`), which reads live
 * competitor scrapes. This file previously backed a client-side estimate that
 * the widget showed when the API failed; that path is removed, because a number
 * derived from mock points is worse than telling the customer we cannot price
 * their device right now.
 */

export type SnapshotKey = `${string}:${ConditionGrade}`;

export interface PricingSnapshot {
  sourceVersion: string;
  capturedAt: string | null;
  pointsByKey: Partial<Record<SnapshotKey, SourcePricePoint[]>>;
}

export const pricingSnapshot: PricingSnapshot = {
  sourceVersion: "snapshot-v0-empty",
  capturedAt: null,
  pointsByKey: {},
};

export function snapshotKey(modelId: string, grade: ConditionGrade): SnapshotKey {
  return `${modelId}:${grade}`;
}

