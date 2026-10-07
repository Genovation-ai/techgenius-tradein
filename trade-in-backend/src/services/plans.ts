import type { Capability } from "../middleware/roles.js";

/**
 * What each subscription includes.
 *
 * Until now `plan` was a string written at signup and read back; nothing in
 * the codebase ever consulted it. This is the file that gives it force, and it
 * is the only place a tier is defined — a limit that lives anywhere else will
 * drift from the one the customer was sold.
 *
 * The prices are deliberately far under the market. Reusely charges $99 for a
 * single shop and $246 for five. These are $5 and $20. That is not a discount,
 * it is a different strategy: win on volume and on repairs, which Reusely does
 * not offer at any price.
 *
 * It only works if support stays near zero. At $5 a month, one ten-minute
 * support email costs more than the customer pays for a year and a half, so
 * every tier is self-serve by construction: limits return a message naming the
 * plan that lifts them, never an error that needs a human to interpret.
 */

export type PlanId = "starter" | "growth" | "scale";

export interface Plan {
  id: PlanId;
  name: string;
  /** USD per month. Canadian shops are billed in CAD at the same number. */
  price: number;
  /** Stores included before the per-store charge applies. */
  stores: number;
  /** Per extra store, per month. */
  perExtraStore: number;
  /** Offers a tenant may take in a calendar month. Infinity for no cap. */
  offersPerMonth: number;
  /** What this tier unlocks beyond the base product. */
  features: PlanFeature[];
  /** One line for the pricing page. */
  pitch: string;
}

/**
 * A feature is a thing the product does, not a route. Routes change; what the
 * shop believes it bought does not.
 */
export type PlanFeature =
  | "repairs"          // quote repairs, not just trade-ins
  | "own_branding"     // remove Reclaim's name from the widget
  | "promo_codes"
  | "market_pricing"   // competitor price sync
  | "reports"
  | "api_access"       // API keys and webhooks
  | "bulk_quote"
  | "ai_scan";

export const PLANS: Record<PlanId, Plan> = {
  starter: {
    id: "starter",
    name: "Starter",
    price: 5,
    stores: 1,
    perExtraStore: 4,
    offersPerMonth: 50,
    features: [],
    pitch: "One shop, taking trade-ins online this week.",
  },
  growth: {
    id: "growth",
    name: "Growth",
    price: 12,
    stores: 3,
    perExtraStore: 4,
    offersPerMonth: 300,
    features: ["repairs", "own_branding", "promo_codes", "market_pricing", "reports"],
    pitch: "Repairs as well as trade-ins, under your own name.",
  },
  scale: {
    id: "scale",
    name: "Scale",
    price: 20,
    stores: 10,
    perExtraStore: 4,
    offersPerMonth: Infinity,
    features: [
      "repairs",
      "own_branding",
      "promo_codes",
      "market_pricing",
      "reports",
      "api_access",
      "bulk_quote",
      "ai_scan",
    ],
    pitch: "Several shops, your own systems talking to ours.",
  },
};

export const DEFAULT_PLAN: PlanId = "starter";

export function planOf(id: string | null | undefined): Plan {
  const key = String(id ?? "").trim().toLowerCase() as PlanId;
  return PLANS[key] ?? PLANS[DEFAULT_PLAN];
}

export function planHasFeature(id: string | null | undefined, feature: PlanFeature): boolean {
  return planOf(id).features.includes(feature);
}

/** The cheapest plan that includes a feature, for the message shown on refusal. */
export function cheapestPlanWith(feature: PlanFeature): Plan {
  const order: PlanId[] = ["starter", "growth", "scale"];
  for (const id of order) {
    if (PLANS[id].features.includes(feature)) return PLANS[id];
  }
  return PLANS.scale;
}

/** What a tenant pays this month, given how many stores they actually have. */
export function monthlyPrice(planId: string | null | undefined, storeCount: number): number {
  const plan = planOf(planId);
  const extra = Math.max(0, storeCount - plan.stores);
  return plan.price + extra * plan.perExtraStore;
}

/**
 * Subscription states.
 *
 * past_due deliberately keeps read access. A shop that cannot pay can still
 * see its own customers and its own offers — locking them out of their data
 * over a failed card is how a recoverable billing problem becomes a lost
 * customer and a support ticket at the same time.
 */
export type PlanStatus = "trialing" | "active" | "past_due" | "cancelled";

export const TRIAL_DAYS = 14;
/** How long past_due lasts before the subscription is cancelled. */
export const GRACE_DAYS = 14;

/** Whether this state may still create new work (offers, repairs, stores). */
export function canWrite(status: string | null | undefined): boolean {
  const s = String(status ?? "trialing");
  return s === "trialing" || s === "active";
}
