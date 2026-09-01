import { Router } from "express";
import { getDb } from "../db/migrate.js";
import { logActivityWith, historyFor, type Actor } from "../services/activityLog.js";
import type { Request } from "express";
import { nanoid } from "nanoid";
import { requireCapability } from "../middleware/auth.js";
import { recordOfferNotification } from "../services/notifications.js";

export const inventoryRouter = Router();

inventoryRouter.get("/", requireCapability("inventory:read"), (req, res) => {
  const db = getDb();
  const { status, store_id, q } = req.query;
  let sql = "SELECT * FROM inventory WHERE 1=1";
  const params: unknown[] = [];
  if (req.tgAuth?.orgId) {
    sql += " AND (org_id = ? OR org_id IS NULL)";
    params.push(req.tgAuth.orgId);
  }
  if (status) {
    sql += " AND status = ?";
    params.push(status);
  }
  if (store_id) {
    sql += " AND store_id = ?";
    params.push(String(store_id));
  }
  if (q && String(q).trim()) {
    const like = `%${String(q).trim().replace(/%/g, "")}%`;
    sql += " AND (device_name LIKE ? OR imei LIKE ? OR id LIKE ?)";
    params.push(like, like, like);
  }
  sql += " ORDER BY created_at DESC LIMIT 200";
  const rows = db.prepare(sql).all(...params);
  db.close();
  res.json(rows);
});

inventoryRouter.post("/", requireCapability("inventory:write"), (req, res) => {
  const db = getDb();
  const { offer_item_id, device_name, imei, condition_grade, cost, sell_price, store_id } = req.body;
  const id = nanoid(12);
  db.prepare(
    "INSERT INTO inventory (id, offer_item_id, device_name, imei, condition_grade, cost, sell_price, store_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    id,
    offer_item_id || null,
    device_name,
    imei || null,
    condition_grade || null,
    cost || 0,
    sell_price || null,
    store_id || "tg-burlington",
  );
  db.close();
  res.status(201).json({ id });
});

/**
 * Bulk status change. Intake day produces dozens of items at once and moving
 * them one at a time is the slowest thing on the floor; the spec calls for bulk
 * actions for exactly that reason. Every item is still logged individually, so
 * the audit trail does not get coarser just because the action was faster.
 */
inventoryRouter.patch("/bulk", requireCapability("inventory:write"), (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? (req.body.ids as string[]).slice(0, 500) : [];
  const status = req.body?.status ? String(req.body.status) : "";
  const ALLOWED = ["available", "not_available", "pending", "listed", "sold", "moved"];
  if (!ids.length) return res.status(400).json({ error: "ids[] required" });
  if (!ALLOWED.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${ALLOWED.join(", ")}` });
  }

  const db = getDb();
  try {
    const actor = actorOf(req);
    const read = db.prepare("SELECT id, status FROM inventory WHERE id = ?");
    const update = db.prepare("UPDATE inventory SET status = ? WHERE id = ?");
    let changed = 0;
    const missing: string[] = [];

    const tx = db.transaction(() => {
      for (const rawId of ids) {
        const id = String(rawId);
        const before = read.get(id) as { id: string; status: string } | undefined;
        if (!before) {
          missing.push(id);
          continue;
        }
        if (before.status === status) continue;
        update.run(status, id);
        logActivityWith(db, {
          entityType: "inventory", entityId: id, action: "status_changed",
          field: "status", oldValue: before.status, newValue: status,
          note: `bulk update of ${ids.length} items`,
        }, actor);
        changed += 1;
      }
    });
    tx();
    res.json({ ok: true, requested: ids.length, changed, missing });
  } finally {
    db.close();
  }
});

inventoryRouter.patch("/:id", requireCapability("inventory:write"), (req, res) => {
  const db = getDb();
  const { status, sell_price } = req.body;
  const before = db
    .prepare("SELECT status, sell_price FROM inventory WHERE id = ?")
    .get(req.params.id) as { status: string; sell_price: number | null } | undefined;
  if (!before) {
    db.close();
    return res.status(404).json({ error: "Not found" });
  }
  db.prepare(
    "UPDATE inventory SET status = COALESCE(?, status), sell_price = COALESCE(?, sell_price) WHERE id = ?",
  ).run(status, sell_price, req.params.id);

  // Stock is money on a shelf; every movement needs a name against it.
  if (status && status !== before.status) {
    logActivityWith(db, {
      entityType: "inventory", entityId: req.params.id, action: "status_changed",
      field: "status", oldValue: before.status, newValue: status,
    }, actorOf(req));
  }
  if (sell_price != null && Number(sell_price) !== Number(before.sell_price)) {
    logActivityWith(db, {
      entityType: "inventory", entityId: req.params.id, action: "price_changed",
      field: "sell_price", oldValue: before.sell_price, newValue: sell_price,
    }, actorOf(req));
  }
  db.close();
  res.json({ ok: true });
});

/** Who is making this change, for the audit trail. */
function actorOf(req: Request): Actor {
  return {
    name: req.tgAuth?.name ?? req.tgAuth?.userId ?? "unknown",
    role: req.tgAuth?.role ?? null,
    orgId: req.tgAuth?.orgId ?? null,
  };
}

/** Change history for one inventory item. */
inventoryRouter.get("/:id/history", requireCapability("inventory:read"), (req, res) => {
  res.json(historyFor("inventory", req.params.id));
});

/** Sell Instantly — mark unit sold with price + sale record. */
inventoryRouter.post("/:id/sell", requireCapability("inventory:sell"), (req, res) => {
  const db = getDb();
  const row = db.prepare("SELECT * FROM inventory WHERE id = ?").get(req.params.id) as
    | {
        id: string;
        status: string;
        sell_price?: number;
        device_name: string;
        offer_item_id?: number;
      }
    | undefined;
  if (!row) {
    db.close();
    return res.status(404).json({ error: "Not found" });
  }
  if (row.status === "sold") {
    db.close();
    return res.status(409).json({ error: "Already sold" });
  }
  const sellPrice = Number(req.body?.sell_price ?? row.sell_price ?? 0);
  if (!Number.isFinite(sellPrice) || sellPrice <= 0) {
    db.close();
    return res.status(400).json({ error: "sell_price required" });
  }
  const note = req.body?.note ? String(req.body.note).slice(0, 500) : null;
  const saleId = nanoid(12);
  db.prepare(
    `UPDATE inventory SET status = 'sold', sell_price = ?, sold_at = datetime('now'), sold_note = ? WHERE id = ?`,
  ).run(sellPrice, note, req.params.id);
  db.prepare(
    `INSERT INTO sales (id, inventory_id, sell_price, note, sold_by) VALUES (?, ?, ?, ?, ?)`,
  ).run(saleId, req.params.id, sellPrice, note, req.tgAuth?.userId || null);

  logActivityWith(db, {
    entityType: "inventory", entityId: req.params.id, action: "sold",
    field: "sell_price", newValue: sellPrice, note,
  }, actorOf(req));

  const offerLink = row.offer_item_id
    ? (db.prepare("SELECT offer_id FROM offer_items WHERE id = ?").get(row.offer_item_id) as
        | { offer_id: string }
        | undefined)
    : undefined;
  if (offerLink?.offer_id) {
    recordOfferNotification(db, {
      offerId: offerLink.offer_id,
      type: "inventory_sold",
      channel: "in_app",
      subject: `Sold ${row.device_name} for $${sellPrice}`,
    });
  }

  db.close();
  res.status(201).json({ ok: true, sale_id: saleId, sell_price: sellPrice, status: "sold" });
});

inventoryRouter.post("/from-offer/:offerId", requireCapability("inventory:write"), (req, res) => {
  const db = getDb();
  const items = db.prepare("SELECT * FROM offer_items WHERE offer_id = ?").all(req.params.offerId) as Array<{
    id: number;
    device_name: string;
    imei?: string;
    condition_grade?: string;
    quoted_price: number;
  }>;
  const storeRow = db.prepare("SELECT store_id FROM offers WHERE id = ?").get(req.params.offerId) as
    | { store_id?: string }
    | undefined;

  const insert = db.prepare(
    "INSERT INTO inventory (id, offer_item_id, device_name, imei, condition_grade, cost, status, store_id) VALUES (?, ?, ?, ?, ?, ?, 'available', ?)",
  );
  const ids: string[] = [];
  for (const item of items) {
    const id = nanoid(12);
    insert.run(
      id,
      item.id,
      item.device_name,
      item.imei || null,
      item.condition_grade || null,
      item.quoted_price,
      storeRow?.store_id || "tg-burlington",
    );
    ids.push(id);
  }
  db.close();
  res.status(201).json({ created: ids.length, ids });
});
