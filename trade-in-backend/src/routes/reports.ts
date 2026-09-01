import { Router } from "express";
import { getDb } from "../db/migrate.js";

export const reportsRouter = Router();

reportsRouter.get("/summary", (_req, res) => {
  const db = getDb();
  const byStatus = db.prepare(
    "SELECT status, COUNT(*) as count, COALESCE(SUM(total_value),0) as total FROM offers GROUP BY status"
  ).all();
  const byMonth = db.prepare(
    `SELECT substr(created_at, 1, 7) as month, COUNT(*) as count, COALESCE(SUM(total_value),0) as total
     FROM offers GROUP BY month ORDER BY month DESC LIMIT 12`
  ).all();
  const topDevices = db.prepare(
    `SELECT device_name, COUNT(*) as count, COALESCE(SUM(quoted_price),0) as total
     FROM offer_items GROUP BY device_name ORDER BY count DESC LIMIT 20`
  ).all();
  const promos = db.prepare(
    "SELECT code, uses, discount_percent, discount_amount, active FROM promo_codes ORDER BY uses DESC"
  ).all();
  const customers = db.prepare(
    "SELECT status, COUNT(*) as count FROM customers GROUP BY status"
  ).all();
  db.close();
  res.json({ byStatus, byMonth, topDevices, promos, customers });
});
