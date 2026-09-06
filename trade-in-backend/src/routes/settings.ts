import { Router } from "express";
import { getDb } from "../db/migrate.js";
import { requireCapability } from "../middleware/auth.js";
import {
  getWidgetTemplate,
  isWidgetTemplate,
  setWidgetTemplate,
  WIDGET_TEMPLATES,
  canonicalTemplate,
} from "../services/widgetTemplate.js";

export const settingsRouter = Router();

settingsRouter.get("/", requireCapability("settings:read"), (_req, res) => {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM settings").all() as Array<{ key: string; value: string }>;
  db.close();
  const obj: Record<string, string> = {};
  for (const r of rows) {
    if (r.key === "api_keys") {
      // Never return raw API keys to the browser — only a count.
      try {
        const keys = JSON.parse(r.value) as unknown[];
        obj.api_keys_count = String(Array.isArray(keys) ? keys.length : 0);
      } catch {
        obj.api_keys_count = "0";
      }
      continue;
    }
    obj[r.key] = r.value;
  }
  res.json(obj);
});

const BLOCKED_SETTINGS_KEYS = new Set(["api_keys", "admin_password", "cron_secret", "master_key"]);

settingsRouter.put("/", requireCapability("settings:write"), (req, res) => {
  const db = getDb();
  const entries = Object.entries(req.body || {}) as [string, unknown][];
  if (!entries.length) {
    db.close();
    return res.status(400).json({ error: "No settings provided" });
  }
  if (entries.length > 50) {
    db.close();
    return res.status(400).json({ error: "Too many settings in one request" });
  }
  const stmt = db.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')"
  );
  for (const [key, value] of entries) {
    if (!key || typeof key !== "string" || key.length > 64) {
      db.close();
      return res.status(400).json({ error: "Invalid settings key" });
    }
    if (BLOCKED_SETTINGS_KEYS.has(key)) {
      db.close();
      return res.status(403).json({ error: `Settings key '${key}' cannot be written via this endpoint` });
    }
    const serialized = typeof value === "string" ? value : JSON.stringify(value);
    if (serialized.length > 8000) {
      db.close();
      return res.status(400).json({ error: `Settings value for '${key}' is too large` });
    }
    stmt.run(key, serialized);
  }
  db.close();
  res.json({ ok: true });
});

/**
 * Frontend template the customer widget renders with — the visual counterpart
 * of `frontend_price_source`. Staff pick it here, the widget reads it from the
 * public `GET /api/widget/template`.
 */
settingsRouter.get("/widget-template", requireCapability("settings:read"), (_req, res) => {
  res.json({ template: getWidgetTemplate(), templates: WIDGET_TEMPLATES });
});

settingsRouter.put("/widget-template", requireCapability("settings:write"), (req, res) => {
  // Accept the retired competitor-named ids too, so an integration saved
  // against the old name keeps working after the rename.
  const template = canonicalTemplate(req.body?.template);
  if (!isWidgetTemplate(template)) {
    return res.status(400).json({
      error: `template must be one of: ${WIDGET_TEMPLATES.map((t) => t.id).join(", ")}`,
    });
  }
  setWidgetTemplate(template);
  res.json({ ok: true, template, templates: WIDGET_TEMPLATES });
});

// Workflow stages
settingsRouter.get("/workflow", requireCapability("settings:read"), (_req, res) => {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM workflow_stages ORDER BY sort_order").all();
  db.close();
  res.json(rows);
});

// Promo codes
settingsRouter.get("/promos", requireCapability("settings:read"), (_req, res) => {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM promo_codes ORDER BY code").all();
  db.close();
  res.json(rows);
});

settingsRouter.post("/promos", requireCapability("settings:write"), (req, res) => {
  const db = getDb();
  const { code, discount_percent, discount_amount, max_uses, expires_at, active } = req.body;
  const id = String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!id) {
    db.close();
    return res.status(400).json({ error: "code required" });
  }
  db.prepare(
    `INSERT INTO promo_codes (id, code, discount_percent, discount_amount, max_uses, expires_at, active)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       discount_percent = excluded.discount_percent,
       discount_amount = excluded.discount_amount,
       max_uses = excluded.max_uses,
       expires_at = excluded.expires_at,
       active = excluded.active`
  ).run(
    id,
    id,
    discount_percent || 0,
    discount_amount || 0,
    max_uses || null,
    expires_at || null,
    active === 0 || active === false ? 0 : 1,
  );
  db.close();
  res.status(201).json({ id });
});

settingsRouter.patch("/promos/:id", requireCapability("settings:write"), (req, res) => {
  const db = getDb();
  const { active, discount_percent, discount_amount } = req.body;
  db.prepare(
    `UPDATE promo_codes SET
      active = COALESCE(?, active),
      discount_percent = COALESCE(?, discount_percent),
      discount_amount = COALESCE(?, discount_amount)
     WHERE id = ?`
  ).run(active, discount_percent, discount_amount, req.params.id);
  db.close();
  res.json({ ok: true });
});

settingsRouter.patch("/workflow/:id", requireCapability("settings:write"), (req, res) => {
  const db = getDb();
  const { send_email, email_template, label } = req.body;
  db.prepare(
    `UPDATE workflow_stages SET
      send_email = COALESCE(?, send_email),
      email_template = COALESCE(?, email_template),
      label = COALESCE(?, label)
     WHERE id = ?`
  ).run(send_email, email_template, label, req.params.id);
  db.close();
  res.json({ ok: true });
});
