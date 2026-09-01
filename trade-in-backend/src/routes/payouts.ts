import { Router } from "express";
import { getDb } from "../db/migrate.js";
import { logActivityWith, type Actor } from "../services/activityLog.js";
import type { Request } from "express";
import { requireCapability } from "../middleware/auth.js";
import { notifyOfferStatusChange, recordOfferNotification } from "../services/notifications.js";

export const payoutsRouter = Router();

const PAYOUT_STATUSES = new Set(["pending", "ready", "processing", "paid", "failed", "cancelled"]);

payoutsRouter.get("/", requireCapability("payouts:read"), (req, res) => {
  const db = getDb();
  const status = req.query.status ? String(req.query.status) : null;
  const store = req.query.store_id ? String(req.query.store_id) : null;
  let sql = `SELECT o.id, o.status AS offer_status, o.total_value, o.payout_method, o.payout_status,
                    o.store_id, o.updated_at, o.created_at,
                    c.first_name, c.last_name, c.email
             FROM offers o
             LEFT JOIN customers c ON c.id = o.customer_id
             WHERE o.payout_status IS NOT NULL`;
  const params: unknown[] = [];
  if (status) {
    sql += " AND o.payout_status = ?";
    params.push(status);
  }
  if (store) {
    sql += " AND o.store_id = ?";
    params.push(store);
  }
  sql += " ORDER BY o.updated_at DESC LIMIT 300";
  const rows = db.prepare(sql).all(...params);
  const summary = db
    .prepare(
      `SELECT payout_status, COUNT(*) AS count, COALESCE(SUM(total_value),0) AS total
       FROM offers GROUP BY payout_status`,
    )
    .all();
  db.close();
  res.json({ rows, summary });
});

payoutsRouter.patch("/:offerId", requireCapability("payouts:write"), (req, res) => {
  const db = getDb();
  const payout_status = String(req.body?.payout_status || "").trim();
  if (!PAYOUT_STATUSES.has(payout_status)) {
    db.close();
    return res.status(400).json({ error: "Invalid payout_status" });
  }
  const offer = db
    .prepare("SELECT id, payout_status, total_value FROM offers WHERE id = ?")
    .get(req.params.offerId) as
    | { id: string; payout_status: string | null; total_value: number }
    | undefined;
  if (!offer) {
    db.close();
    return res.status(404).json({ error: "Offer not found" });
  }
  db.prepare(
    `UPDATE offers SET
      payout_status = ?,
      payout_method = COALESCE(?, payout_method),
      updated_at = datetime('now')
     WHERE id = ?`,
  ).run(payout_status, req.body?.payout_method ?? null, req.params.offerId);

  // Money leaving the business: this is the line an accountant or a disputing
  // customer will ask about months later.
  logActivityWith(db, {
    entityType: "payout",
    entityId: req.params.offerId,
    action: "payout_status_changed",
    field: "payout_status",
    oldValue: offer.payout_status,
    newValue: payout_status,
    note: `$${offer.total_value}`,
  }, {
    name: req.tgAuth?.name ?? req.tgAuth?.userId ?? "unknown",
    role: req.tgAuth?.role ?? null,
    orgId: req.tgAuth?.orgId ?? null,
  });

  recordOfferNotification(db, {
    offerId: req.params.offerId,
    type: `payout:${payout_status}`,
    channel: "in_app",
    subject: `Payout ${payout_status} for ${req.params.offerId}`,
  });

  if (payout_status === "paid") {
    db.prepare(
      `UPDATE invoices SET status = 'paid', paid_at = datetime('now') WHERE offer_id = ? AND status != 'void'`,
    ).run(req.params.offerId);
  }

  db.close();
  res.json({ ok: true, payout_status });
});

payoutsRouter.post("/:offerId/mark-processing", requireCapability("payouts:write"), (req, res) => {
  req.body = { ...req.body, payout_status: "processing" };
  // reuse patch handler logic via redirect style
  const db = getDb();
  db.prepare(
    `UPDATE offers SET payout_status = 'processing', updated_at = datetime('now') WHERE id = ?`,
  ).run(req.params.offerId);
  notifyOfferStatusChange(db, req.params.offerId, "payout_processing");
  db.close();
  res.json({ ok: true, payout_status: "processing" });
});
