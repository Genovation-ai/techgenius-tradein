import { getDb } from "../db/migrate.js";
import { GRACE_DAYS } from "./plans.js";

/**
 * Moving subscriptions through their states, once a day.
 *
 * A trial that never ends is not a trial. `status` was set to 'trial' at
 * signup and nothing ever looked at it again, so every tenant who ever signed
 * up would have had the product free forever.
 *
 *   trialing  -> past_due    the 14 days ran out and no card was added
 *   past_due  -> cancelled   14 more days and still nothing
 *
 * What this deliberately does not do is touch 'active'. A paying subscription
 * only changes when the payment provider says so; a clock must never cancel
 * someone who is paying, and that is exactly the bug that makes a shop tell
 * everyone their software deleted their business.
 *
 * past_due keeps read access throughout. The shop can see its customers and
 * its offers, it simply cannot take new ones — so a recovered card restores
 * everything and nothing had to be restored from backup.
 */
export function runSubscriptionLifecycle(): {
  expired: number;
  cancelled: number;
} {
  const db = getDb();
  try {
    const expired = db
      .prepare(
        `UPDATE orgs
            SET plan_status = 'past_due'
          WHERE plan_status = 'trialing'
            AND trial_ends_at IS NOT NULL
            AND trial_ends_at <= datetime('now')`,
      )
      .run().changes;

    const cancelled = db
      .prepare(
        `UPDATE orgs
            SET plan_status = 'cancelled'
          WHERE plan_status = 'past_due'
            AND trial_ends_at IS NOT NULL
            AND trial_ends_at <= datetime('now', ?)`,
      )
      .run(`-${GRACE_DAYS} days`).changes;

    if (expired || cancelled) {
      console.log(
        `[subscriptions] ${expired} trial(s) expired, ${cancelled} cancelled after grace`,
      );
    }
    return { expired, cancelled };
  } finally {
    db.close();
  }
}

/**
 * Run it daily, and once at boot.
 *
 * At boot because a container that was down over a weekend would otherwise
 * leave expired trials writable until the next tick, and the first thing a
 * restarted service should do is agree with reality.
 */
export function startSubscriptionLifecycle(): void {
  const DAY = 24 * 60 * 60 * 1000;
  try {
    runSubscriptionLifecycle();
  } catch (e) {
    console.warn("[subscriptions] first run failed:", e instanceof Error ? e.message : e);
  }
  const timer = setInterval(() => {
    try {
      runSubscriptionLifecycle();
    } catch (e) {
      console.warn("[subscriptions] run failed:", e instanceof Error ? e.message : e);
    }
  }, DAY);
  // Never hold the process open for a timer whose work can wait for the next boot.
  timer.unref?.();
}
