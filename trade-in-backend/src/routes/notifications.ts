import { Router } from "express";
import { getDb } from "../db/migrate.js";

export const notificationsRouter = Router();

notificationsRouter.get("/", (req, res) => {
  const db = getDb();
  const limit = Math.min(Math.max(parseInt(String(req.query.limit || "50"), 10) || 50, 1), 200);
  const rows = db
    .prepare(
      `SELECT n.*, o.status AS offer_status, o.total_value,
              c.first_name, c.last_name, c.email
       FROM notifications n
       LEFT JOIN offers o ON o.id = n.offer_id
       LEFT JOIN customers c ON c.id = o.customer_id
       ORDER BY n.sent_at DESC
       LIMIT ?`,
    )
    .all(limit);
  db.close();
  res.json(rows);
});

notificationsRouter.get("/summary", (_req, res) => {
  const db = getDb();
  // Only surface notifications whose offer still exists. Each row in the bell
  // links to /admin/offers/<id>, so a notification left behind by a removed
  // offer sends staff to a 404 with no way to tell why. System notices, which
  // carry no offer_id, are unaffected.
  const scope = `FROM notifications n
       LEFT JOIN offers o ON o.id = n.offer_id
       WHERE n.offer_id IS NULL OR o.id IS NOT NULL`;
  const total = db.prepare(`SELECT COUNT(*) AS c ${scope}`).get() as { c: number };
  const recent = db
    .prepare(
      `SELECT n.id, n.offer_id, n.type, n.channel, n.subject, n.sent_at
       ${scope}
       ORDER BY n.sent_at DESC
       LIMIT 8`,
    )
    .all();
  db.close();
  res.json({ total: total.c, recent });
});
