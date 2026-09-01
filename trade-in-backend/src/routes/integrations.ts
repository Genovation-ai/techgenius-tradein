import { Router } from "express";
import { getDb } from "../db/migrate.js";
import { requireCapability } from "../middleware/auth.js";
import { dispatchCrmWebhook } from "../services/crmWebhook.js";
import { emailStatusSummary } from "../services/email.js";

export const integrationsRouter = Router();

integrationsRouter.get("/status", requireCapability("settings:read"), (_req, res) => {
  const db = getDb();
  const crmBlocked = (
    db.prepare("SELECT COUNT(*) AS c FROM crm_outbox WHERE status = 'blocked'").get() as { c: number }
  ).c;
  const crmSent = (
    db.prepare("SELECT COUNT(*) AS c FROM crm_outbox WHERE status = 'sent'").get() as { c: number }
  ).c;
  db.close();
  res.json({
    email: emailStatusSummary(),
    crm: {
      configured: Boolean((process.env.TG_CRM_WEBHOOK_URL || "").trim()),
      blocked: crmBlocked,
      sent: crmSent,
    },
  });
});

integrationsRouter.post("/crm/dispatch", requireCapability("crm:dispatch"), async (req, res) => {
  const offerId = String(req.body?.offer_id || "");
  if (!offerId) return res.status(400).json({ error: "offer_id required" });
  const db = getDb();
  const offer = db
    .prepare(
      `SELECT o.*, c.first_name, c.last_name, c.email, c.phone
       FROM offers o LEFT JOIN customers c ON c.id = o.customer_id WHERE o.id = ?`,
    )
    .get(offerId) as Record<string, unknown> | undefined;
  const items = db.prepare("SELECT * FROM offer_items WHERE offer_id = ?").all(offerId);
  db.close();
  if (!offer) return res.status(404).json({ error: "Offer not found" });

  const result = await dispatchCrmWebhook(offerId, {
    type: req.body?.type || "offer.sync",
    offer,
    items,
    source: "manual_dispatch",
  });
  res.json(result);
});

integrationsRouter.get("/crm/outbox", requireCapability("crm:dispatch"), (_req, res) => {
  const db = getDb();
  const rows = db
    .prepare("SELECT id, offer_id, status, created_at, sent_at FROM crm_outbox ORDER BY id DESC LIMIT 50")
    .all();
  db.close();
  res.json(rows);
});

integrationsRouter.get("/email/outbox", requireCapability("settings:read"), (_req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT id, offer_id, recipient, subject, status, created_at, sent_at FROM email_outbox ORDER BY id DESC LIMIT 50",
    )
    .all();
  db.close();
  res.json(rows);
});
