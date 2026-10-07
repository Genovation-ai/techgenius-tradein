import { getDb } from "../db/migrate.js";
import { GRACE_DAYS } from "./plans.js";
import { sendTradeInEmail } from "./email.js";

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

    /*
     * Tell them. A subscription that lapses in silence is a shop that finds
     * out when a customer cannot get a quote, which is the worst possible
     * moment and not recoverable by then.
     *
     * Sent after the state has already changed, so a mail provider that is
     * down delays the message rather than holding up the state machine.
     */
    void notifyLapsed();

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


/**
 * One message per shop that just lapsed, to whoever signed it up.
 *
 * Deliberately not a marketing sequence. It says what happened, what still
 * works, and what to do — a shop in past_due can still see every customer and
 * every offer it has, and saying so is the difference between a card update
 * and a cancellation.
 */
async function notifyLapsed(): Promise<void> {
  const db = getDb();
  try {
    const rows = db
      .prepare(
        `SELECT o.id, o.name, o.plan_status, s.company_email
           FROM orgs o
           LEFT JOIN org_settings s ON s.org_id = o.id
          WHERE o.plan_status IN ('past_due','cancelled')
            AND NOT EXISTS (
              SELECT 1 FROM email_outbox e
               WHERE e.org_id = o.id
                 AND e.subject = CASE o.plan_status
                       WHEN 'past_due' THEN 'Your Reclaim trial has ended'
                       ELSE 'Your Reclaim subscription has been cancelled' END
            )`,
      )
      .all() as Array<{ id: string; name: string; plan_status: string; company_email: string | null }>;

    for (const r of rows) {
      if (!r.company_email?.includes("@")) continue;
      const ending = r.plan_status === "past_due";
      await sendTradeInEmail({
        orgId: r.id,
        recipient: r.company_email,
        subject: ending
          ? "Your Reclaim trial has ended"
          : "Your Reclaim subscription has been cancelled",
        body: ending
          ? [
              `Hello ${r.name},`,
              "",
              "Your two-week trial has finished, so the widget has stopped taking new offers.",
              "",
              "Everything you already have is untouched — every customer, every offer and every",
              "setting is still in your account and still visible. Adding a card starts it taking",
              "offers again straight away; nothing needs rebuilding.",
              "",
              "Plans start at $10 a month for one shop.",
            ].join("\n")
          : [
              `Hello ${r.name},`,
              "",
              "Your subscription has been cancelled and the widget is no longer taking offers.",
              "",
              "Your data is kept for 90 days, so resubscribing within that time restores",
              "everything exactly as it was.",
            ].join("\n"),
      });
    }
  } catch (e) {
    console.warn("[subscriptions] lapse notice failed:", e instanceof Error ? e.message : e);
  } finally {
    db.close();
  }
}
