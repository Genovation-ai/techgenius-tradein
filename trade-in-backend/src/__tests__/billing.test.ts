import crypto from "node:crypto";
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { StripeProvider, applyBillingEvent } from "../services/billing.js";

const SECRET = "whsec_test_secret";

function signed(payload: object, opts: { secret?: string; age?: number } = {}) {
  const raw = JSON.stringify(payload);
  const t = Math.floor(Date.now() / 1000) - (opts.age ?? 0);
  const v1 = crypto
    .createHmac("sha256", opts.secret ?? SECRET)
    .update(`${t}.${raw}`)
    .digest("hex");
  return { raw, header: `t=${t},v1=${v1}` };
}

const checkout = (orgId: string, plan: string, id = "evt_1") => ({
  id,
  type: "checkout.session.completed",
  data: {
    object: {
      customer: "cus_123",
      metadata: { org_id: orgId, plan },
      customer_details: { address: { country: "US" } },
    },
  },
});

describe("webhook signatures", () => {
  const p = new StripeProvider();
  beforeEach(() => {
    process.env.TG_STRIPE_WEBHOOK_SECRET = SECRET;
  });

  it("accepts a correctly signed event", () => {
    const { raw, header } = signed(checkout("org-a", "growth"));
    const evt = p.parseWebhook(raw, header);
    expect(evt?.type).toBe("subscribed");
    expect(evt?.orgId).toBe("org-a");
    expect(evt?.plan).toBe("growth");
    expect(evt?.cardCountry).toBe("US");
  });

  it("refuses a forged signature", () => {
    const { raw } = signed(checkout("org-a", "scale"));
    expect(p.parseWebhook(raw, "t=1,v1=deadbeef")).toBeNull();
  });

  it("refuses a signature made with the wrong secret", () => {
    const { raw, header } = signed(checkout("org-a", "scale"), { secret: "whsec_wrong" });
    expect(p.parseWebhook(raw, header)).toBeNull();
  });

  it("refuses a body that was altered after signing", () => {
    const { raw, header } = signed(checkout("org-a", "starter"));
    const tampered = raw.replace('"starter"', '"scale"');
    expect(p.parseWebhook(tampered, header)).toBeNull();
  });

  it("refuses a replay of an old but validly signed request", () => {
    const { raw, header } = signed(checkout("org-a", "growth"), { age: 3600 });
    expect(p.parseWebhook(raw, header)).toBeNull();
  });

  it("refuses everything when no secret is configured", () => {
    delete process.env.TG_STRIPE_WEBHOOK_SECRET;
    const { raw, header } = signed(checkout("org-a", "growth"));
    expect(p.parseWebhook(raw, header)).toBeNull();
  });

  it("refuses a missing signature header", () => {
    const { raw } = signed(checkout("org-a", "growth"));
    expect(p.parseWebhook(raw, undefined)).toBeNull();
  });
});

describe("applying an event", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`CREATE TABLE orgs (id TEXT PRIMARY KEY, plan TEXT, plan_status TEXT,
             billing_ref TEXT, region_code TEXT);
             INSERT INTO orgs VALUES ('org-a','starter','trialing',NULL,'CA');`);
  });
  const row = () => db.prepare("SELECT * FROM orgs WHERE id='org-a'").get() as Record<string, string>;

  it("activates the plan the customer paid for", () => {
    const r = applyBillingEvent(db, {
      id: "evt_1", type: "subscribed", orgId: "org-a", plan: "growth",
      billingRef: "cus_123", cardCountry: "US",
    });
    expect(r).toBe("applied");
    expect(row().plan).toBe("growth");
    expect(row().plan_status).toBe("active");
    expect(row().billing_ref).toBe("cus_123");
    // the card's country is the honest region signal, not the browser's
    expect(row().region_code).toBe("US");
  });

  it("applies the same event only once, however many times it arrives", () => {
    const evt = {
      id: "evt_dup", type: "subscribed" as const, orgId: "org-a",
      plan: "growth" as const, billingRef: "cus_1", cardCountry: null,
    };
    expect(applyBillingEvent(db, evt)).toBe("applied");
    expect(applyBillingEvent(db, evt)).toBe("duplicate");
    expect(applyBillingEvent(db, evt)).toBe("duplicate");
  });

  it("moves a failed payment to past_due without touching the plan", () => {
    applyBillingEvent(db, { id: "e1", type: "subscribed", orgId: "org-a", plan: "scale", billingRef: "c", cardCountry: null });
    applyBillingEvent(db, { id: "e2", type: "payment_failed", orgId: "org-a", plan: null, billingRef: null, cardCountry: null });
    expect(row().plan_status).toBe("past_due");
    expect(row().plan).toBe("scale"); // still theirs; they just have not paid
  });

  it("cancels on cancellation", () => {
    applyBillingEvent(db, { id: "e3", type: "cancelled", orgId: "org-a", plan: null, billingRef: null, cardCountry: null });
    expect(row().plan_status).toBe("cancelled");
  });

  it("does nothing for an event with no org on it", () => {
    expect(
      applyBillingEvent(db, { id: "e4", type: "subscribed", orgId: null, plan: "scale", billingRef: null, cardCountry: null }),
    ).toBe("ignored");
    expect(row().plan).toBe("starter");
  });
});

describe("what an attacker can reach", () => {
  const p = new StripeProvider();
  beforeEach(() => {
    process.env.TG_STRIPE_WEBHOOK_SECRET = SECRET;
  });

  it("will not take a plan from an unsigned body", () => {
    const body = JSON.stringify(checkout("org-victim", "scale"));
    expect(p.parseWebhook(body, undefined)).toBeNull();
    expect(p.parseWebhook(body, "")).toBeNull();
    expect(p.parseWebhook(body, "t=,v1=")).toBeNull();
  });

  it("will not accept a signature from a different body", () => {
    const a = signed(checkout("org-a", "starter", "evt_a"));
    const b = signed(checkout("org-b", "scale", "evt_b"));
    // the attacker has a valid header, just not for this payload
    expect(p.parseWebhook(b.raw, a.header)).toBeNull();
  });

  it("will not let a stale capture be replayed tomorrow", () => {
    for (const age of [301, 3600, 86_400]) {
      const { raw, header } = signed(checkout("org-a", "scale"), { age });
      expect(p.parseWebhook(raw, header), `age ${age}s`).toBeNull();
    }
  });

  it("treats a malformed signature header as a forgery, not an error", () => {
    const { raw } = signed(checkout("org-a", "growth"));
    for (const h of ["garbage", "v1=onlythis", "t=notanumber,v1=abc", "t=1"]) {
      expect(p.parseWebhook(raw, h), h).toBeNull();
    }
  });

  it("never reads a plan from anywhere but signed metadata", () => {
    // no metadata at all: nothing to apply, even though the signature is good
    const { raw, header } = signed({
      id: "evt_nometa",
      type: "checkout.session.completed",
      data: { object: { customer: "cus_x" } },
    });
    const evt = p.parseWebhook(raw, header);
    expect(evt?.orgId).toBeNull();
    expect(evt?.plan).toBeNull();
  });
});
