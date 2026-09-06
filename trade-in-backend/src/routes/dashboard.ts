import { Router } from "express";
import { getDb } from "../db/migrate.js";
import { orgFilter } from "../middleware/orgScope.js";

export const dashboardRouter = Router();

dashboardRouter.get("/", (req, res) => {
  const db = getDb();
  // Every number here is commercial: pipeline value, revenue, customer count.
  // Unscoped, a tenant's dashboard showed the whole platform's trade.
  const scope = orgFilter(req);
  const p = scope.params;

  const pipeline = db.prepare(
    `SELECT status, COUNT(*) as count, COALESCE(SUM(total_value), 0) as total
       FROM offers WHERE 1=1${scope.sql} GROUP BY status`
  ).all(...p);

  const totalOffers = db.prepare(`SELECT COUNT(*) as count FROM offers WHERE 1=1${scope.sql}`).get(...p) as { count: number };
  const totalCustomers = db.prepare(`SELECT COUNT(*) as count FROM customers WHERE status = 'active'${scope.sql}`).get(...p) as { count: number };
  const totalInventory = db.prepare(`SELECT COUNT(*) as count FROM inventory WHERE status = 'available'${scope.sql}`).get(...p) as { count: number };
  const totalRevenue = db.prepare(`SELECT COALESCE(SUM(total_value), 0) as total FROM offers WHERE status = 'completed'${scope.sql}`).get(...p) as { total: number };

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
