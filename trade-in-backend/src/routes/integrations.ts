import { Router } from "express";
import { getDb } from "../db/migrate.js";
import { requireCapability } from "../middleware/auth.js";
import { dispatchCrmWebhook } from "../services/crmWebhook.js";
import { emailStatusSummary, flushBlockedEmails } from "../services/email.js";
import { orgIdOf } from "../middleware/orgScope.js";
import { emailIdentityFor } from "../services/emailIdentity.js";

export const integrationsRouter = Router();

integrationsRouter.get("/status", requireCapability("settings:read"), (req, res) => {
  const db = getDb();
  const crmBlocked = (
    db.prepare("SELECT COUNT(*) AS c FROM crm_outbox WHERE status = 'blocked'").get() as { c: number }
  ).c;
  const crmSent = (
    db.prepare("SELECT COUNT(*) AS c FROM crm_outbox WHERE status = 'sent'").get() as { c: number }
  ).c;
  const identity = emailIdentityFor(db, orgIdOf(req));
  db.close();
  res.json({
    email: emailStatusSummary(orgIdOf(req)),
    // What a customer of this tenant actually sees in their inbox. Surfaced so
    // a shared platform sender that still points at one tenant's domain is
    // visible rather than discovered by a customer.
    sender: {
      from: `${identity.fromName} <${identity.from}>`,
      reply_to: identity.replyTo,
      platform_domain_shared: true,
    },
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

/**
 * One tenant's queue only.
 *
 * This listed the last 50 rows platform-wide, so any shop with settings access
 * could read the recipient addresses and subject lines of every other shop's
 * customers. Rows written before email_outbox was org-scoped have a null
 * org_id and belong to the original tenant, so they are shown to it and to
 * nobody else.
 */
/**
 * Send the queue that built up while delivery was unconfigured.
 *
 * Messages written with no provider were stored as 'blocked' and nothing read
 * them again, so configuring a provider helped the next customer and left the
 * earlier ones in silence. This is the catch-up, and it is deliberately manual:
 * the shop decides when a stack of late receipts should land in people's
 * inboxes, rather than having them all arrive the moment a key is pasted in.
 */
integrationsRouter.post("/email/flush", requireCapability("settings:write"), async (req, res) => {
  const limit = Number((req.body as { limit?: number })?.limit ?? 50);
  const result = await flushBlockedEmails({
    orgId: orgIdOf(req),
    limit: Number.isFinite(limit) ? limit : 50,
  });
  if (result.skipped) return res.status(409).json({ error: result.skipped, ...result });
  res.json(result);
});

integrationsRouter.get("/email/outbox", requireCapability("settings:read"), (req, res) => {
  const db = getDb();
  const orgId = orgIdOf(req);
  const rows = db
    .prepare(
      `SELECT id, offer_id, recipient, subject, status, created_at, sent_at
         FROM email_outbox
        WHERE org_id = ?
        ORDER BY id DESC LIMIT 50`,
    )
    .all(orgId);
  db.close();
  res.json(rows);
});
