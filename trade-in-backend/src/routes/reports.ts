import { Router } from "express";
import { getDb } from "../db/migrate.js";
import { orgFilter } from "../middleware/orgScope.js";

export const reportsRouter = Router();

reportsRouter.get("/summary", (req, res) => {
  const db = getDb();
  // Volume, revenue and best-selling devices are commercial intelligence — a
  // tenant seeing the platform-wide figures is a competitive leak, not just a
  // privacy one.
  const scope = orgFilter(req);
  const p = scope.params;
  const orgFilterAlias = orgFilter(req, "o").sql;
  const byStatus = db.prepare(
    `SELECT status, COUNT(*) as count, COALESCE(SUM(total_value),0) as total
       FROM offers WHERE 1=1${scope.sql} GROUP BY status`
  ).all(...p);
  const byMonth = db.prepare(
    `SELECT substr(created_at, 1, 7) as month, COUNT(*) as count, COALESCE(SUM(total_value),0) as total
     FROM offers WHERE 1=1${scope.sql} GROUP BY month ORDER BY month DESC LIMIT 12`
  ).all(...p);
  const topDevices = db.prepare(
    `SELECT device_name, COUNT(*) as count, COALESCE(SUM(quoted_price),0) as total
     FROM offer_items oi
     WHERE EXISTS (SELECT 1 FROM offers o WHERE o.id = oi.offer_id${orgFilterAlias})
     GROUP BY device_name ORDER BY count DESC LIMIT 20`
  ).all(...p);
  const promos = db.prepare(
    `SELECT code, uses, discount_percent, discount_amount, active FROM promo_codes WHERE 1=1${scope.sql} ORDER BY uses DESC`
  ).all(...p);
  const customers = db.prepare(
    `SELECT status, COUNT(*) as count FROM customers WHERE 1=1${scope.sql} GROUP BY status`
  ).all(...p);
  db.close();
  res.json({ byStatus, byMonth, topDevices, promos, customers });
});
