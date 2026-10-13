/**
 * SaaS org APIs: signup, branding, stores, API keys, public widget config.
 */
import { Router, type Request } from "express";
import { nanoid } from "nanoid";
import { getDb } from "../db/migrate.js";
import { apiKeyAuth, requireCapability, requireOrg } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import {
  checkStoreLimit,
  checkWritable,
  meter,
  offersThisMonth,
  storeCount,
  subscriptionOf,
} from "../services/entitlements.js";
import { monthlyPrice, PLANS, planOf, type PlanId } from "../services/plans.js";
import { activeProvider, applyBillingEvent, billingReadiness } from "../services/billing.js";
import {
  createOrganization,
  generateApiKey,
  getOrgById,
  getOrgSettings,
  listOrgStores,
  publicWidgetConfig,
  slugifyOrg,
} from "../services/tenancy.js";

export const saasRouter = Router();

/*
 * The webhook is the one route here with no key in front of it — the
 * signature is the authentication. A limiter keeps an unauthenticated,
 * CPU-bearing endpoint from being a cheap way to occupy the service. Stripe
 * retries with backoff and will never approach this.
 */
const webhookLimiter = rateLimit({ windowMs: 60 * 1000, max: 240 });

/**
 * The tiers, for a pricing page. Public: nobody should have to sign up to
 * find out what it costs.
 */
saasRouter.get("/plans", (_req, res) => {
  res.json({
    currency: "USD",
    note: "Canadian shops are billed the same number in CAD.",
    plans: (["starter", "growth", "scale"] as PlanId[]).map((id) => {
      const p = PLANS[id];
      return {
        id: p.id,
        name: p.name,
        price: p.price,
        pitch: p.pitch,
        stores: p.stores,
        per_extra_store: p.perExtraStore,
        offers_per_month: Number.isFinite(p.offersPerMonth) ? p.offersPerMonth : null,
        features: p.features,
      };
    }),
  });
});

/**
 * What this tenant has used against what they are allowed, plus the numbers
 * worth watching. One call, because a billing page and an analytics page want
 * the same facts and splitting them guarantees they disagree.
 */
/** What is still missing before this deployment can take money. */
saasRouter.get("/billing/status", apiKeyAuth, requireCapability("settings:read"), (_req, res) => {
  res.json(billingReadiness());
});

/**
 * Start a subscription. Returns a hosted page where the card is entered; we
 * never see a card number and never want to.
 */
saasRouter.post("/billing/checkout", apiKeyAuth, requireCapability("settings:write"), requireOrg, async (req, res) => {
  const provider = activeProvider();
  if (!provider.configured()) {
    return res.status(503).json({
      error: "Payments are not switched on for this deployment yet.",
      provider: provider.name,
    });
  }
  const planId = String((req.body as { plan?: string })?.plan || "").toLowerCase();
  if (!(planId in PLANS)) {
    return res.status(400).json({ error: "Unknown plan", plans: Object.keys(PLANS) });
  }

  const db = getDb();
  try {
    const orgId = req.tgAuth!.orgId!;
    const org = db.prepare("SELECT id, name, region_code FROM orgs WHERE id = ?").get(orgId) as
      | { id: string; name: string; region_code: string }
      | undefined;
    if (!org) return res.status(404).json({ error: "Organization not found" });

    /*
     * Where Stripe sends the customer afterwards is never taken from the
     * request.
     *
     * It used to be read from a return_to field in the body. Anyone who could
     * call this — a shop's own staff account, or anyone holding a leaked API
     * key — could point it at a site they controlled, and Stripe would deliver
     * a freshly-paying customer to it straight after checkout. That is a
     * phishing page wearing our redirect.
     *
     * TG_APP_URL is the one place the admin actually lives; without it we fall
     * back to the host that served this request, which the caller cannot
     * choose.
     */
    const root = (process.env.TG_APP_URL || "").trim().replace(/\/+$/, "") ||
      `${req.protocol}://${req.get("host")}`;

    const out = await provider.createCheckout({
      orgId: org.id,
      orgName: org.name,
      plan: planId as PlanId,
      region: org.region_code,
      email: String((req.body as { email?: string })?.email || "") || null,
      successUrl: `${root}/admin/billing?subscribed=1`,
      cancelUrl: `${root}/admin/billing?cancelled=1`,
    });
    res.json({ url: out.url, plan: planId });
  } catch (e) {
    // The provider's own words can name price ids, account state and
    // configuration. Useful in a log, not in a response to whoever asked.
    console.warn("[billing] checkout failed:", e instanceof Error ? e.message : e);
    res.status(502).json({ error: "Could not start checkout. Please try again." });
  } finally {
    db.close();
  }
});

/** Where a shop changes its card or cancels. Hosted by the provider. */
saasRouter.post("/billing/portal", apiKeyAuth, requireCapability("settings:write"), requireOrg, async (req, res) => {
  const provider = activeProvider();
  if (!provider.configured()) return res.status(503).json({ error: "Payments are not switched on." });
  const db = getDb();
  try {
    const org = db.prepare("SELECT id, billing_ref FROM orgs WHERE id = ?").get(req.tgAuth!.orgId!) as
      | { id: string; billing_ref: string | null }
      | undefined;
    if (!org?.billing_ref) {
      return res.status(409).json({ error: "This shop has no subscription yet." });
    }
    const root = `${req.protocol}://${req.get("host")}`;
    const out = await provider.portalUrl(org.id, org.billing_ref, `${root}/admin/billing`);
    res.json(out);
  } catch (e) {
    console.warn("[billing] portal failed:", e instanceof Error ? e.message : e);
    res.status(502).json({ error: "Could not open the billing portal. Please try again." });
  } finally {
    db.close();
  }
});

/**
 * The only authority on what a shop has paid for.
 *
 * Unauthenticated by design — the signature is the authentication, and a
 * payment provider cannot hold an API key. A body that does not verify is
 * treated as a forgery and answered 400 without touching the database.
 */
saasRouter.post("/billing/webhook", webhookLimiter, (req, res) => {
  const provider = activeProvider();
  const raw = (req as Request & { rawBody?: string }).rawBody ?? "";

  /*
   * Refuse anything implausibly large before hashing it.
   *
   * Verifying a signature means an HMAC over the whole body, so an unbounded
   * body is unbounded work for anyone who can reach this URL — and it has to
   * be reachable without a key, because a payment provider cannot hold one.
   * A real event is a few kilobytes; 64KB is generous.
   */
  if (raw.length > 64_000) {
    return res.status(413).json({ error: "Payload too large" });
  }
  const sig =
    (req.headers["stripe-signature"] as string | undefined) ||
    (req.headers["paddle-signature"] as string | undefined);

  const evt = provider.parseWebhook(raw, sig);
  if (!evt) return res.status(400).json({ error: "Signature did not verify" });

  const db = getDb();
  try {
    const outcome = applyBillingEvent(db, evt);
    // 200 even for a duplicate: the provider retries anything that is not 2xx,
    // and an event we have already applied is handled, not failed.
    res.json({ received: true, outcome, type: evt.type });
  } finally {
    db.close();
  }
});

saasRouter.get("/usage", apiKeyAuth, requireOrg, (req, res) => {
  const db = getDb();
  try {
    const orgId = req.tgAuth!.orgId!;
    const sub = subscriptionOf(db, orgId);
    const plan = planOf(sub?.plan);
    const stores = storeCount(db, orgId);
    const offers = offersThisMonth(db, orgId);

    const since = (days: number) =>
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM offers
            WHERE org_id = ? AND created_at >= date('now', ?)`,
        )
        .get(orgId, `-${days} days`) as { c: number };

    const value = db
      .prepare(
        `SELECT COALESCE(SUM(total_value),0) AS v FROM offers
          WHERE org_id = ? AND created_at >= date('now','start of month')`,
      )
      .get(orgId) as { v: number };

    res.json({
      plan: {
        id: plan.id,
        name: plan.name,
        price: plan.price,
        status: sub?.plan_status ?? "active",
        trial_ends_at: sub?.trial_ends_at ?? null,
        region: sub?.region_code ?? "CA",
      },
      limits: {
        stores: { used: stores, included: plan.stores, per_extra: plan.perExtraStore },
        offers_this_month: {
          used: offers,
          included: Number.isFinite(plan.offersPerMonth) ? plan.offersPerMonth : null,
        },
      },
      billing: { this_month: monthlyPrice(plan.id, stores) },
      activity: {
        offers_7d: since(7).c,
        offers_30d: since(30).c,
        offer_value_this_month: Number(value.v ?? 0),
      },
    });
  } finally {
    db.close();
  }
});

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: "Too many signup attempts. Try again later.",
});

/** Public: create a new shop (org + admin + store + API key). */
saasRouter.post("/signup", signupLimiter, (req, res) => {
  try {
    const result = createOrganization({
      companyName: String(req.body?.company_name || req.body?.companyName || ""),
      slug: req.body?.slug ? String(req.body.slug) : undefined,
      adminName: String(req.body?.admin_name || req.body?.name || "Owner"),
      adminEmail: String(req.body?.email || ""),
      adminPassword: String(req.body?.password || ""),
      phone: req.body?.phone ? String(req.body.phone) : undefined,
      plan: req.body?.plan ? String(req.body.plan) : "starter",
      // Which country they sell in: decides billing currency and which
      // catalogue feeds their quotes. Corrected from the card on subscribe.
      region: req.body?.region ? String(req.body.region) : "CA",
    });

    // Issue session so they land in admin immediately
    const db = getDb();
    const token = `tg_sess_${nanoid(32)}`;
    const expires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare(
      `INSERT INTO admin_sessions (token, user_id, expires_at) VALUES (?, ?, ?)`,
    ).run(token, result.admin.id, expires);
    db.close();

    res.status(201).json({
      ok: true,
      org: {
        id: result.org.id,
        slug: result.org.slug,
        name: result.org.name,
        plan: result.org.plan,
        status: result.org.status,
      },
      store: result.store,
      user: result.admin,
      token,
      api_key: result.apiKey,
      widget_config_url: `/api/saas/widget-config?org=${encodeURIComponent(result.org.slug)}`,
      message:
        "Shop created. Save your API key now — it won't be shown again. Use the token to open admin.",
    });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Signup failed" });
  }
});

/** Public white-label widget config by org slug */
saasRouter.get("/widget-config", (req, res) => {
  const slug = String(req.query.org || req.query.slug || "").trim();
  if (!slug) return res.status(400).json({ error: "org slug required" });
  const cfg = publicWidgetConfig(slug);
  if (!cfg) return res.status(404).json({ error: "Organization not found" });
  if (cfg.status === "suspended") {
    return res.status(403).json({ error: "This shop is suspended" });
  }
  res.json(cfg);
});

saasRouter.get("/slug-available", (req, res) => {
  const slug = slugifyOrg(String(req.query.slug || ""));
  if (!slug) return res.json({ slug, available: false });
  const db = getDb();
  const hit = db.prepare("SELECT id FROM orgs WHERE slug = ?").get(slug);
  db.close();
  res.json({ slug, available: !hit });
});

/** Authenticated org profile */
saasRouter.get("/org", apiKeyAuth, requireOrg, (req, res) => {
  const db = getDb();
  const org = getOrgById(db, req.tgAuth!.orgId);
  const settings = org ? getOrgSettings(db, org.id) : null;
  const stores = org ? listOrgStores(db, org.id) : [];
  db.close();
  if (!org) return res.status(404).json({ error: "Org not found" });
  res.json({
    org,
    settings,
    stores,
    branding: {
      company_name: settings?.company_name || org.name,
      brand_color: settings?.widget_brand_color || "#0B3D2E",
      cta_color: settings?.widget_cta_color || "#C45C26",
      logo_url: settings?.logo_url || null,
    },
  });
});

saasRouter.put("/org/settings", apiKeyAuth, requireCapability("settings:write"), requireOrg, (req, res) => {
  const orgId = req.tgAuth!.orgId;
  const db = getDb();
  const body = req.body || {};
  db.prepare(
    `UPDATE org_settings SET
      company_name = COALESCE(?, company_name),
      company_phone = COALESCE(?, company_phone),
      company_email = COALESCE(?, company_email),
      widget_brand_color = COALESCE(?, widget_brand_color),
      widget_cta_color = COALESCE(?, widget_cta_color),
      logo_url = COALESCE(?, logo_url),
      payout_methods = COALESCE(?, payout_methods),
      offer_types = COALESCE(?, offer_types),
      ship_street1 = COALESCE(?, ship_street1),
      ship_street2 = COALESCE(?, ship_street2),
      ship_city = COALESCE(?, ship_city),
      ship_state = COALESCE(?, ship_state),
      ship_zip = COALESCE(?, ship_zip),
      ship_country = COALESCE(?, ship_country)
     WHERE org_id = ?`,
  ).run(
    body.company_name ?? null,
    body.company_phone ?? null,
    body.company_email ?? null,
    body.widget_brand_color ?? null,
    body.widget_cta_color ?? null,
    body.logo_url ?? null,
    body.payout_methods ? JSON.stringify(body.payout_methods) : null,
    body.offer_types ? JSON.stringify(body.offer_types) : null,
    body.ship_street1 ?? null,
    body.ship_street2 ?? null,
    body.ship_city ?? null,
    body.ship_state ?? null,
    body.ship_zip ?? null,
    body.ship_country ?? null,
    orgId,
  );
  if (body.company_name) {
    db.prepare("UPDATE orgs SET name = ? WHERE id = ?").run(String(body.company_name), orgId);
  }
  const settings = getOrgSettings(db, orgId);
  const org = getOrgById(db, orgId);
  db.close();
  res.json({ ok: true, org, settings });
});

saasRouter.get("/org/stores", apiKeyAuth, requireOrg, (req, res) => {
  const db = getDb();
  const stores = listOrgStores(db, req.tgAuth!.orgId);
  db.close();
  res.json(stores);
});

saasRouter.post("/org/stores", apiKeyAuth, requireCapability("settings:write"), requireOrg, (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "name required" });
  const id = `store-${nanoid(8)}`;
  const db = getDb();

  /*
   * Past the included count this is a price, not a refusal: the shop is told
   * what the next store costs and what their invoice becomes. Saying "no" to
   * a customer trying to give you more money is the worst possible answer.
   */
  {
    const sub = subscriptionOf(db, req.tgAuth!.orgId!);
    const denial = checkWritable(sub) || checkStoreLimit(db, sub);
    if (denial) {
      db.close();
      return res.status(denial.status).json(denial);
    }
  }

  db.prepare(
    `INSERT INTO org_stores (id, org_id, name, address, phone, enabled) VALUES (?, ?, ?, ?, ?, 1)`,
  ).run(
    id,
    req.tgAuth!.orgId,
    name,
    req.body?.address ? String(req.body.address) : null,
    req.body?.phone ? String(req.body.phone) : null,
  );
  meter(db, req.tgAuth!.orgId, "store_added", id);
  const store = db.prepare("SELECT * FROM org_stores WHERE id = ?").get(id);
  db.close();
  res.status(201).json(store);
});

saasRouter.patch("/org/stores/:id", apiKeyAuth, requireCapability("settings:write"), requireOrg, (req, res) => {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM org_stores WHERE id = ? AND org_id = ?")
    .get(req.params.id, req.tgAuth!.orgId);
  if (!row) {
    db.close();
    return res.status(404).json({ error: "Store not found" });
  }
  db.prepare(
    `UPDATE org_stores SET
      name = COALESCE(?, name),
      address = COALESCE(?, address),
      phone = COALESCE(?, phone),
      enabled = COALESCE(?, enabled)
     WHERE id = ? AND org_id = ?`,
  ).run(
    req.body?.name ?? null,
    req.body?.address ?? null,
    req.body?.phone ?? null,
    req.body?.enabled != null ? Number(req.body.enabled) : null,
    req.params.id,
    req.tgAuth!.orgId,
  );
  const updated = db.prepare("SELECT * FROM org_stores WHERE id = ?").get(req.params.id);
  db.close();
  res.json(updated);
});

saasRouter.get("/org/api-keys", apiKeyAuth, requireCapability("settings:write"), requireOrg, (req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, name, key_prefix, role, enabled, created_at, last_used_at
       FROM org_api_keys WHERE org_id = ? ORDER BY created_at DESC`,
    )
    .all(req.tgAuth!.orgId);
  db.close();
  res.json(rows);
});

saasRouter.post("/org/api-keys", apiKeyAuth, requireCapability("settings:write"), requireOrg, (req, res) => {
  const name = String(req.body?.name || "Integration key").slice(0, 80);
  const key = generateApiKey();
  const id = nanoid(12);
  const db = getDb();
  db.prepare(
    `INSERT INTO org_api_keys (id, org_id, name, key_prefix, key_hash, role, enabled)
     VALUES (?, ?, ?, ?, ?, 'integration', 1)`,
  ).run(id, req.tgAuth!.orgId, name, key.prefix, key.hash);
  db.close();
  res.status(201).json({
    id,
    name,
    key_prefix: key.prefix,
    api_key: key.raw,
    message: "Copy this key now — it will not be shown again.",
  });
});

saasRouter.delete("/org/api-keys/:id", apiKeyAuth, requireCapability("settings:write"), requireOrg, (req, res) => {
  const db = getDb();
  const result = db
    .prepare("UPDATE org_api_keys SET enabled = 0 WHERE id = ? AND org_id = ?")
    .run(req.params.id, req.tgAuth!.orgId);
  db.close();
  if (!result.changes) return res.status(404).json({ error: "Key not found" });
  res.json({ ok: true });
});
