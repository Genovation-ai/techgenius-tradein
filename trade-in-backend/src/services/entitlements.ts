import type { Database } from "better-sqlite3";
import {
  canWrite,
  cheapestPlanWith,
  monthlyPrice,
  planOf,
  type PlanFeature,
} from "./plans.js";

/**
 * What a tenant is allowed to do right now, and what to tell them when they
 * are not.
 *
 * Two rules shape every message here. A refusal always names the plan that
 * lifts it, because at these prices nobody is going to open a support ticket
 * to find out — they will leave. And a refusal for money is 402, never 403:
 * "that costs more" and "you are not allowed" are different sentences, and
 * showing the second to someone willing to pay loses a sale.
 */

export interface OrgSubscription {
  id: string;
  plan: string;
  plan_status: string;
  trial_ends_at: string | null;
  region_code: string;
}

export function subscriptionOf(db: Database, orgId: string): OrgSubscription | null {
  try {
    return (
      (db
        .prepare(
          "SELECT id, plan, plan_status, trial_ends_at, region_code FROM orgs WHERE id = ?",
        )
        .get(orgId) as OrgSubscription | undefined) ?? null
    );
  } catch {
    // A database from before these columns existed: treat as unrestricted
    // rather than locking a working shop out of its own product.
    return null;
  }
}

export interface Denial {
  status: 402 | 403;
  error: string;
  required_plan?: string;
  current_plan?: string;
  limit?: number;
  used?: number;
}

/** Stores a tenant currently has. */
export function storeCount(db: Database, orgId: string): number {
  try {
    return (
      db.prepare("SELECT COUNT(*) AS c FROM org_stores WHERE org_id = ?").get(orgId) as {
        c: number;
      }
    ).c;
  } catch {
    return 0;
  }
}

/** Offers this tenant has taken in the current calendar month. */
export function offersThisMonth(db: Database, orgId: string): number {
  try {
    return (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM usage_events
            WHERE org_id = ? AND kind = 'offer_created'
              AND occurred_at >= date('now','start of month')`,
        )
        .get(orgId) as { c: number }
    ).c;
  } catch {
    return 0;
  }
}

/** Record something billable. Never throws: metering must not fail a sale. */
export function meter(
  db: Database,
  orgId: string | null | undefined,
  kind: "offer_created" | "repair_quoted" | "store_added",
  refId?: string | null,
): void {
  if (!orgId) return;
  try {
    db.prepare(
      "INSERT INTO usage_events (org_id, kind, ref_id) VALUES (?, ?, ?)",
    ).run(orgId, kind, refId ?? null);
  } catch {
    /* the meter is not worth losing a customer's offer over */
  }
}

/** Whether the subscription is in a state that may create new work. */
export function checkWritable(sub: OrgSubscription | null): Denial | null {
  if (!sub) return null;
  if (canWrite(sub.plan_status)) return null;
  if (sub.plan_status === "past_due") {
    return {
      status: 402,
      error:
        "Your subscription payment did not go through. Your data is all still here — update your card to start taking offers again.",
      current_plan: sub.plan,
    };
  }
  return {
    status: 402,
    error: "This subscription has been cancelled. Reactivate it to start taking offers again.",
    current_plan: sub.plan,
  };
}

/** Whether a feature is included in the tenant's plan. */
export function checkFeature(
  sub: OrgSubscription | null,
  feature: PlanFeature,
  label: string,
): Denial | null {
  if (!sub) return null;
  const plan = planOf(sub.plan);
  if (plan.features.includes(feature)) return null;
  const needed = cheapestPlanWith(feature);
  return {
    status: 402,
    error: `${label} is included from ${needed.name} ($${needed.price}/month). You are on ${plan.name}.`,
    required_plan: needed.id,
    current_plan: plan.id,
  };
}

/** Whether another store may be added. */
export function checkStoreLimit(db: Database, sub: OrgSubscription | null): Denial | null {
  if (!sub) return null;
  const plan = planOf(sub.plan);
  const have = storeCount(db, sub.id);
  if (have < plan.stores) return null;
  // Over the included count is not a refusal — it is a charge. Say the number.
  return {
    status: 402,
    error: `${plan.name} includes ${plan.stores} ${plan.stores === 1 ? "store" : "stores"}. Each extra store is $${plan.perExtraStore}/month — your next invoice would be $${monthlyPrice(plan.id, have + 1)}.`,
    current_plan: plan.id,
    limit: plan.stores,
    used: have,
  };
}

/** Whether another offer may be taken this month. */
export function checkOfferLimit(db: Database, sub: OrgSubscription | null): Denial | null {
  if (!sub) return null;
  const plan = planOf(sub.plan);
  if (!Number.isFinite(plan.offersPerMonth)) return null;
  const used = offersThisMonth(db, sub.id);
  if (used < plan.offersPerMonth) return null;
  const next = plan.id === "starter" ? planOf("growth") : planOf("scale");
  return {
    status: 402,
    error: `${plan.name} covers ${plan.offersPerMonth} offers a month and you have taken ${used}. ${next.name} ($${next.price}/month) raises that${Number.isFinite(next.offersPerMonth) ? ` to ${next.offersPerMonth}` : " to unlimited"}.`,
    required_plan: next.id,
    current_plan: plan.id,
    limit: plan.offersPerMonth,
    used,
  };
}
