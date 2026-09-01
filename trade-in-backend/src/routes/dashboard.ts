import { Router } from "express";
import { getDb } from "../db/migrate.js";

export const dashboardRouter = Router();

dashboardRouter.get("/", (_req, res) => {
  const db = getDb();

  const pipeline = db.prepare(
    "SELECT status, COUNT(*) as count, COALESCE(SUM(total_value), 0) as total FROM offers GROUP BY status"
  ).all();

  const totalOffers = db.prepare("SELECT COUNT(*) as count FROM offers").get() as { count: number };
  const totalCustomers = db.prepare("SELECT COUNT(*) as count FROM customers WHERE status = 'active'").get() as { count: number };
  const totalInventory = db.prepare("SELECT COUNT(*) as count FROM inventory WHERE status = 'available'").get() as { count: number };
  const totalRevenue = db.prepare("SELECT COALESCE(SUM(total_value), 0) as total FROM offers WHERE status = 'completed'").get() as { total: number };

  db.close();
  res.json({
    pipeline,
    stats: {
      total_offers: totalOffers.count,
      total_customers: totalCustomers.count,
      available_inventory: totalInventory.count,
      completed_revenue: totalRevenue.total,
    },
  });
});
