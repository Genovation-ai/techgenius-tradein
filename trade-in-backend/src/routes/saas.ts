/**
 * SaaS org APIs: signup, branding, stores, API keys, public widget config.
 */
import { Router } from "express";
import { nanoid } from "nanoid";
import { getDb } from "../db/migrate.js";
import { apiKeyAuth, requireCapability, requireOrg } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
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
      offer_types = COALESCE(?, offer_types)
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
  db.prepare(
    `INSERT INTO org_stores (id, org_id, name, address, phone, enabled) VALUES (?, ?, ?, ?, ?, 1)`,
  ).run(
    id,
    req.tgAuth!.orgId,
    name,
    req.body?.address ? String(req.body.address) : null,
    req.body?.phone ? String(req.body.phone) : null,
  );
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
