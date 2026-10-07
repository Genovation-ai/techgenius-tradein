import crypto from "node:crypto";
import type { Database } from "better-sqlite3";
import { PLANS, type PlanId, planOf } from "./plans.js";

/**
 * Taking money.
 *
 * One interface with one implementation behind it. Every gateway is a
 * permanent obligation — its own webhooks, idempotency rules, refund
 * semantics, disputes and reconciliation — so five of them is five times the
 * surface that can quietly stop charging people. Cards and wallets (Visa,
 * Mastercard, Amex, Apple Pay, Google Pay) all arrive through one integration,
 * not five, which covers what a shop owner actually needs.
 *
 * A second provider implements this interface. That is a week, not a rewrite,
 * and it should wait for a deal that is lost without it.
 *
 * Nothing here talks to a payment SDK. Both Stripe and Paddle are plain HTTPS
 * APIs, and a dependency that must be kept current to keep taking money is a
 * liability on a service this small.
 */

export interface CheckoutRequest {
  orgId: string;
  orgName: string;
  plan: PlanId;
  /** Where the customer lands afterwards. */
  successUrl: string;
  cancelUrl: string;
  /** For the receipt and so the provider can match an existing customer. */
  email?: string | null;
  /** Decides the currency the price is shown in. */
  region?: string | null;
}

export interface BillingProvider {
  readonly name: string;
  /** Whether this deployment is configured to take money at all. */
  configured(): boolean;
  /** A hosted page where the customer enters a card. */
  createCheckout(req: CheckoutRequest): Promise<{ url: string }>;
  /** A hosted page where they change the card or cancel. */
  portalUrl(orgId: string, billingRef: string, returnUrl: string): Promise<{ url: string }>;
  /**
   * Verify the signature and read the event. Returns null when the signature
   * does not check out, which must be treated as a forgery, not an error.
   */
  parseWebhook(rawBody: string, signature: string | undefined): BillingEvent | null;
}

/** The only four things a payment provider tells us that change anything. */
export interface BillingEvent {
  /** Provider's own id, used to refuse the same event twice. */
  id: string;
  type: "subscribed" | "renewed" | "payment_failed" | "cancelled" | "ignored";
  orgId: string | null;
  plan: PlanId | null;
  /** The subscription id to store against the org. */
  billingRef: string | null;
  /** The country the card was issued in, which is the only honest region signal. */
  cardCountry: string | null;
}

/* ───────────────────────────── Stripe ───────────────────────────── */

const STRIPE_API = "https://api.stripe.com/v1";

function form(data: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(data)) if (v !== undefined) p.set(k, v);
  return p.toString();
}

export class StripeProvider implements BillingProvider {
  readonly name = "stripe";

  configured(): boolean {
    return Boolean((process.env.TG_STRIPE_SECRET_KEY || "").trim());
  }

  private key(): string {
    const k = (process.env.TG_STRIPE_SECRET_KEY || "").trim();
    if (!k) throw new Error("TG_STRIPE_SECRET_KEY is not set");
    return k;
  }

  /**
   * The price id for a plan, per currency.
   *
   * Prices live in the provider, not here: a price edited in code and a price
   * charged by Stripe that disagree is a customer billed something they never
   * saw. plans.ts stays the authority on what a tier *includes*; Stripe stays
   * the authority on what it *costs*.
   */
  private priceId(plan: PlanId, region: string | null | undefined): string {
    const cur = String(region ?? "CA").toUpperCase() === "US" ? "USD" : "CAD";
    const key = `TG_STRIPE_PRICE_${plan.toUpperCase()}_${cur}`;
    const id = (process.env[key] || "").trim();
    if (!id) throw new Error(`No Stripe price configured for ${plan} in ${cur} (${key})`);
    return id;
  }

  async createCheckout(req: CheckoutRequest): Promise<{ url: string }> {
    const body = form({
      mode: "subscription",
      "line_items[0][price]": this.priceId(req.plan, req.region),
      "line_items[0][quantity]": "1",
      success_url: req.successUrl,
      cancel_url: req.cancelUrl,
      customer_email: req.email || undefined,
      // Carried back on the webhook. The org is never read from the URL the
      // browser returns to — that is guessable and would let anyone upgrade.
      "metadata[org_id]": req.orgId,
      "subscription_data[metadata][org_id]": req.orgId,
      "metadata[plan]": req.plan,
      "subscription_data[metadata][plan]": req.plan,
    });

    const res = await fetch(`${STRIPE_API}/checkout/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.key()}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    const json = (await res.json()) as { url?: string; error?: { message?: string } };
    if (!res.ok || !json.url) {
      throw new Error(json.error?.message || `Stripe refused the checkout (${res.status})`);
    }
    return { url: json.url };
  }

  async portalUrl(_orgId: string, billingRef: string, returnUrl: string): Promise<{ url: string }> {
    const res = await fetch(`${STRIPE_API}/billing_portal/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.key()}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form({ customer: billingRef, return_url: returnUrl }),
    });
    const json = (await res.json()) as { url?: string; error?: { message?: string } };
    if (!res.ok || !json.url) {
      throw new Error(json.error?.message || `Stripe refused the portal (${res.status})`);
    }
    return { url: json.url };
  }

  /**
   * Stripe signs `timestamp.payload` with the endpoint secret. The comparison
   * is constant-time, and the timestamp is checked, because a signature that
   * is merely valid is not enough — a captured request replayed later would
   * otherwise still be accepted.
   */
  parseWebhook(rawBody: string, signature: string | undefined): BillingEvent | null {
    const secret = (process.env.TG_STRIPE_WEBHOOK_SECRET || "").trim();
    if (!secret || !signature) return null;

    const parts = Object.fromEntries(
      signature.split(",").map((p) => {
        const i = p.indexOf("=");
        return [p.slice(0, i), p.slice(i + 1)];
      }),
    ) as { t?: string; v1?: string };
    if (!parts.t || !parts.v1) return null;

    const age = Math.abs(Date.now() / 1000 - Number(parts.t));
    if (!Number.isFinite(age) || age > 300) return null;

    const expected = crypto
      .createHmac("sha256", secret)
      .update(`${parts.t}.${rawBody}`)
      .digest("hex");
    const a = Buffer.from(expected);
    const b = Buffer.from(parts.v1);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

    let evt: {
      id?: string;
      type?: string;
      data?: { object?: Record<string, unknown> };
    };
    try {
      evt = JSON.parse(rawBody);
    } catch {
      return null;
    }

    const obj = (evt.data?.object ?? {}) as Record<string, unknown>;
    const meta = (obj.metadata ?? {}) as Record<string, string>;
    const orgId = meta.org_id || null;
    const plan = (meta.plan && meta.plan in PLANS ? meta.plan : null) as PlanId | null;

    const ref =
      (typeof obj.customer === "string" && obj.customer) ||
      (typeof obj.subscription === "string" && obj.subscription) ||
      null;

    const country =
      ((obj.customer_details as { address?: { country?: string } } | undefined)?.address?.country) ||
      null;

    const type: BillingEvent["type"] =
      evt.type === "checkout.session.completed"
        ? "subscribed"
        : evt.type === "invoice.paid" || evt.type === "invoice.payment_succeeded"
          ? "renewed"
          : evt.type === "invoice.payment_failed"
            ? "payment_failed"
            : evt.type === "customer.subscription.deleted"
              ? "cancelled"
              : "ignored";

    return {
      id: String(evt.id ?? ""),
      type,
      orgId,
      plan,
      billingRef: ref,
      cardCountry: country,
    };
  }
}

export function activeProvider(): BillingProvider {
  return new StripeProvider();
}

/* ───────────────────────── applying an event ───────────────────────── */

/**
 * Apply a verified event, once.
 *
 * Webhooks arrive twice; providers say so plainly. The event id is written
 * before anything is acted on, so a redelivery is a no-op rather than a second
 * upgrade or a second cancellation.
 *
 * This is the only code permitted to write `plan` or `plan_status`. A browser
 * returning to a success URL changes nothing — that URL is guessable and would
 * otherwise let anyone upgrade themselves for free.
 */
export function applyBillingEvent(db: Database, evt: BillingEvent): "applied" | "duplicate" | "ignored" {
  if (!evt.id || evt.type === "ignored" || !evt.orgId) return "ignored";

  db.exec(`
    CREATE TABLE IF NOT EXISTS billing_events (
      id TEXT PRIMARY KEY,
      org_id TEXT,
      type TEXT NOT NULL,
      received_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const seen = db.prepare("SELECT 1 FROM billing_events WHERE id = ?").get(evt.id);
  if (seen) return "duplicate";
  db.prepare("INSERT INTO billing_events (id, org_id, type) VALUES (?, ?, ?)").run(
    evt.id,
    evt.orgId,
    evt.type,
  );

  switch (evt.type) {
    case "subscribed":
    case "renewed": {
      const plan = evt.plan ? planOf(evt.plan).id : null;
      db.prepare(
        `UPDATE orgs
            SET plan_status = 'active',
                plan = COALESCE(?, plan),
                billing_ref = COALESCE(?, billing_ref),
                region_code = COALESCE(?, region_code)
          WHERE id = ?`,
      ).run(plan, evt.billingRef, evt.cardCountry, evt.orgId);
      break;
    }
    case "payment_failed":
      db.prepare("UPDATE orgs SET plan_status = 'past_due' WHERE id = ?").run(evt.orgId);
      break;
    case "cancelled":
      db.prepare("UPDATE orgs SET plan_status = 'cancelled' WHERE id = ?").run(evt.orgId);
      break;
  }
  return "applied";
}
