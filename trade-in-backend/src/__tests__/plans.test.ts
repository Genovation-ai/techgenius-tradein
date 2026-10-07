import { describe, expect, it } from "vitest";
import {
  PLANS,
  canWrite,
  cheapestPlanWith,
  monthlyPrice,
  planHasFeature,
  planOf,
} from "../services/plans.js";

describe("subscription tiers", () => {
  it("stays inside the price band the product was positioned at", () => {
    for (const p of Object.values(PLANS)) {
      expect(p.price).toBeGreaterThanOrEqual(10);
      expect(p.price).toBeLessThanOrEqual(25);
    }
  });

  it("gets strictly more generous as it gets dearer", () => {
    const order = [PLANS.starter, PLANS.growth, PLANS.scale];
    for (let i = 0; i < order.length - 1; i++) {
      const a = order[i];
      const b = order[i + 1];
      expect(b.price).toBeGreaterThan(a.price);
      expect(b.stores).toBeGreaterThan(a.stores);
      expect(b.offersPerMonth).toBeGreaterThanOrEqual(a.offersPerMonth);
      // every feature of the cheaper plan survives into the dearer one
      for (const f of a.features) expect(b.features).toContain(f);
    }
  });

  it("keeps repairs out of Starter — it is the reason to upgrade", () => {
    expect(planHasFeature("starter", "repairs")).toBe(false);
    expect(planHasFeature("growth", "repairs")).toBe(true);
    expect(cheapestPlanWith("repairs").id).toBe("growth");
  });

  it("keeps the API to the top tier", () => {
    expect(planHasFeature("growth", "api_access")).toBe(false);
    expect(cheapestPlanWith("api_access").id).toBe("scale");
  });

  it("charges for stores past the included count", () => {
    expect(monthlyPrice("starter", 1)).toBe(10);
    expect(monthlyPrice("starter", 2)).toBe(16);
    expect(monthlyPrice("starter", 3)).toBe(22);
    expect(monthlyPrice("growth", 3)).toBe(17);
    expect(monthlyPrice("growth", 5)).toBe(29);
    expect(monthlyPrice("scale", 10)).toBe(25);
    expect(monthlyPrice("scale", 20)).toBe(85);
  });

  it("undercuts Reusely at every size", () => {
    // Reusely: $99 with 2 stores, then +$49 each; $249 with 10, then +$49.
    const reusely = (stores: number) =>
      Math.min(99 + Math.max(0, stores - 2) * 49, 249 + Math.max(0, stores - 10) * 49, 999);
    const ours = (stores: number) =>
      stores <= 1 ? monthlyPrice("starter", stores)
      : stores <= 3 ? monthlyPrice("growth", stores)
      : monthlyPrice("scale", stores);
    for (const n of [1, 2, 3, 5, 10, 20]) {
      expect(ours(n), `${n} stores`).toBeLessThan(reusely(n));
    }
  });

  it("falls back to the cheapest plan for an unknown name, never the dearest", () => {
    expect(planOf("enterprise-deluxe").id).toBe("starter");
    expect(planOf(null).id).toBe("starter");
    expect(planOf("").id).toBe("starter");
  });

  it("lets a trial and an active subscription write, and stops the rest", () => {
    expect(canWrite("trialing")).toBe(true);
    expect(canWrite("active")).toBe(true);
    expect(canWrite("past_due")).toBe(false);
    expect(canWrite("cancelled")).toBe(false);
    // an unknown state must not lock a working shop out of its own product
    expect(canWrite(undefined)).toBe(true);
  });
});
