import { Router } from "express";
import { getDb } from "../db/migrate.js";
import { orgFilter } from "../middleware/orgScope.js";

export const searchRouter = Router();

/** Global admin search across offers, customers, inventory, and devices. */
searchRouter.get("/", (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 120);
  if (q.length < 2) {
    return res.json({ q, offers: [], customers: [], inventory: [], devices: [] });
  }

  const like = `%${q.replace(/%/g, "")}%`;
  const db = getDb();
  // Global search reaches across offers, customers and inventory at once, so it
  // was the widest of the leaks: any tenant could search the whole platform's
  // records. Devices are the shared catalogue and stay unscoped on purpose.
  const so = orgFilter(req, "o");
  const sc = orgFilter(req);
  const si = orgFilter(req);

  const offers = db
    .prepare(
      `SELECT o.id, o.status, o.total_value, o.offer_type,
              c.first_name, c.last_name, c.email
       FROM offers o
       LEFT JOIN customers c ON c.id = o.customer_id
       WHERE (o.id LIKE ? OR c.email LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ?
          OR (c.first_name || ' ' || c.last_name) LIKE ?)${so.sql}
       ORDER BY o.created_at DESC
       LIMIT 15`,
    )
    .all(like, like, like, like, like, ...so.params);

  const customers = db
    .prepare(
      `SELECT id, first_name, last_name, email, phone, status
       FROM customers
       WHERE (email LIKE ? OR first_name LIKE ? OR last_name LIKE ?
          OR (first_name || ' ' || last_name) LIKE ? OR phone LIKE ?)${sc.sql}
       ORDER BY created_at DESC
       LIMIT 10`,
    )
    .all(like, like, like, like, like, ...sc.params);

  const inventory = db
    .prepare(
      `SELECT id, device_name, imei, condition_grade, status, cost
       FROM inventory
       WHERE (device_name LIKE ? OR imei LIKE ? OR id LIKE ?)${si.sql}
       ORDER BY created_at DESC
       LIMIT 10`,
    )
    .all(like, like, like, ...si.params);

  const devices = db
    .prepare(
      `SELECT id, name, image_url, enabled
       FROM devices
       WHERE id LIKE ? OR name LIKE ?
       ORDER BY name
       LIMIT 10`,
    )
    .all(like, like);

  db.close();
  res.json({ q, offers, customers, inventory, devices });
});
