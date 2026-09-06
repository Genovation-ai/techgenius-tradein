import { Router } from "express";
import { getDb } from "../db/migrate.js";
import { orgFilter } from "../middleware/orgScope.js";

export const notificationsRouter = Router();

notificationsRouter.get("/", (req, res) => {
  const db = getDb();
  const limit = Math.min(Math.max(parseInt(String(req.query.limit || "50"), 10) || 50, 1), 200);
  const org = orgFilter(req, "n");
  const rows = db
    .prepare(
      `SELECT n.*, o.status AS offer_status, o.total_value,
              c.first_name, c.last_name, c.email
       FROM notifications n
       LEFT JOIN offers o ON o.id = n.offer_id
       LEFT JOIN customers c ON c.id = o.customer_id
       WHERE 1=1${org.sql}
       ORDER BY n.sent_at DESC
       LIMIT ?`,
    )
    .all(...org.params, limit);
  db.close();
  res.json(rows);
});

notificationsRouter.get("/summary", (req, res) => {
  const db = getDb();
  // Only surface notifications whose offer still exists. Each row in the bell
  // links to /admin/offers/<id>, so a notification left behind by a removed
  // offer sends staff to a 404 with no way to tell why. System notices, which
  // carry no offer_id, are unaffected.
  const org = orgFilter(req, "n");
  const scope = `FROM notifications n
       LEFT JOIN offers o ON o.id = n.offer_id
       WHERE (n.offer_id IS NULL OR o.id IS NOT NULL)${org.sql}`;
  const total = db.prepare(`SELECT COUNT(*) AS c ${scope}`).get(...org.params) as { c: number };
  const recent = db
    .prepare(
      `SELECT n.id, n.offer_id, n.type, n.channel, n.subject, n.sent_at
       ${scope}
       ORDER BY n.sent_at DESC
       LIMIT 8`,
    )
    .all(...org.params);
  db.close();
  res.json({ total: total.c, recent });
});
