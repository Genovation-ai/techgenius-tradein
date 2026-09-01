import { Router } from "express";
import { getDb } from "../db/migrate.js";
import { logActivityWith, historyFor, type Actor } from "../services/activityLog.js";
import type { Request } from "express";
import { nanoid } from "nanoid";
import { notifyOfferStatusChange, recordOfferNotification } from "../services/notifications.js";
import { ensureInvoiceForCompletedOffer } from "./invoices.js";
import { requireCapability } from "../middleware/auth.js";
import { computeServerQuote } from "../services/quoteEngine.js";
import { dispatchCrmWebhook } from "../services/crmWebhook.js";

export const offersRouter = Router();

const ALLOWED_STATUSES = new Set([
  "active_lead",
  "in_transit",
  "delivered",
  "being_inspected",
  "general_hold",
  "payout_processing",
  "revised_offer",
  "completed",
  "returned",
]);

// List offers with filters (server-side search)
/**
 * Abandoned buybacks — people who priced a device and left contact details but
 * never submitted. This is the shop's follow-up list.
 */
offersRouter.get("/leads", requireCapability("offers:read"), (req, res) => {
  const db = getDb();
  try {
    const status = String(req.query.status || "open");
    const store = req.query.store_id ? String(req.query.store_id) : null;
    const params: unknown[] = [status];
    let sql = "SELECT * FROM abandoned_leads WHERE status = ?";
    if (store) {
      sql += " AND store_id = ?";
      params.push(store);
    }
    sql += " ORDER BY updated_at DESC LIMIT 300";
    const rows = (db.prepare(sql).all(...params) as Array<Record<string, unknown>>).map((r) => ({
      ...r,
      items: JSON.parse(String(r.items_json || "[]")),
    }));
    const totals = db
      .prepare(
        `SELECT status, COUNT(*) AS count, COALESCE(SUM(quoted_total), 0) AS value
           FROM abandoned_leads GROUP BY status`,
      )
      .all();
    res.json({ rows, totals });
  } finally {
    db.close();
  }
});

/** Close a lead by hand — recovered off-platform, or not worth chasing. */
offersRouter.patch("/leads/:id", requireCapability("offers:write"), (req, res) => {
  const next = String(req.body?.status || "");
  if (!["open", "contacted", "converted", "dismissed"].includes(next)) {
    return res.status(400).json({ error: "status must be open, contacted, converted or dismissed" });
  }
  const db = getDb();
  try {
    const result = db
      .prepare("UPDATE abandoned_leads SET status = ?, updated_at = datetime('now') WHERE id = ?")
      .run(next, req.params.id);
    if (!result.changes) return res.status(404).json({ error: "Lead not found" });
    res.json({ ok: true, id: req.params.id, status: next });
  } finally {
    db.close();
  }
});

offersRouter.get("/", requireCapability("offers:read"), (req, res) => {
  const db = getDb();
  const { status, offer_type, limit, q, store_id } = req.query;
  const orgId = req.tgAuth?.orgId;
  let sql =
    "SELECT o.*, c.first_name, c.last_name, c.email FROM offers o LEFT JOIN customers c ON o.customer_id = c.id WHERE 1=1";
  const params: unknown[] = [];
  if (orgId) {
    sql += " AND (o.org_id = ? OR o.org_id IS NULL)";
    params.push(orgId);
  }
  if (status) {
    sql += " AND o.status = ?";
    params.push(status);
  }
  if (offer_type) {
    sql += " AND o.offer_type = ?";
    params.push(offer_type);
  }
  if (store_id) {
    sql += " AND o.store_id = ?";
    params.push(String(store_id));
  }
  if (q && String(q).trim()) {
    const like = `%${String(q).trim().replace(/%/g, "")}%`;
    sql +=
      " AND (o.id LIKE ? OR c.email LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ? OR (c.first_name || ' ' || c.last_name) LIKE ?)";
    params.push(like, like, like, like, like);
  }
  sql += " ORDER BY o.created_at DESC LIMIT ?";
  const rowLimit = Math.min(Math.max(parseInt(String(limit || "50"), 10) || 50, 1), 500);
  params.push(rowLimit);
  const rows = db.prepare(sql).all(...params);
  db.close();
  res.json(rows);
});

offersRouter.get("/:id", requireCapability("offers:read"), (req, res) => {
  const db = getDb();
  const offer = db
    .prepare(
      `SELECT o.*, c.first_name, c.last_name, c.email, c.phone
     FROM offers o LEFT JOIN customers c ON o.customer_id = c.id
     WHERE o.id = ?`,
    )
    .get(req.params.id);
  if (!offer) {
    db.close();
    return res.status(404).json({ error: "Not found" });
  }
  const items = db
    .prepare(
      `SELECT oi.*, d.image_url AS device_image_url
     FROM offer_items oi
     LEFT JOIN devices d ON d.id = oi.device_id
     WHERE oi.offer_id = ?`,
    )
    .all(req.params.id);
  const invoice = db
    .prepare("SELECT id, status, amount FROM invoices WHERE offer_id = ? ORDER BY issued_at DESC LIMIT 1")
    .get(req.params.id);
  const uploads = db
    .prepare(
      "SELECT id, filename, mime_type, size_bytes, created_at, angle FROM uploads WHERE offer_id = ? ORDER BY created_at DESC",
    )
    .all(req.params.id);
  db.close();
  const offerRow = offer as Record<string, unknown>;
  let aiScan = null;
  if (typeof offerRow.ai_scan_json === "string" && offerRow.ai_scan_json) {
    try {
      aiScan = JSON.parse(offerRow.ai_scan_json);
    } catch {
      aiScan = null;
    }
  }
  res.json({ ...offerRow, items, invoice, uploads, ai_scan: aiScan });
});

/** Staff hand-off: create walk-in / drop-off offer from admin. */
offersRouter.post("/handoff", requireCapability("offers:handoff"), async (req, res) => {
  const contact = req.body?.contact || {};
  const itemsIn = (req.body?.items || []) as Array<{
    device_id?: string;
    device_name?: string;
    storage: string;
    condition_grade: string;
    carrier?: string;
    battery_health?: number;
    imei?: string;
  }>;
  if (!contact.first_name || !contact.last_name || !itemsIn.length) {
    return res.status(400).json({ error: "contact + items required" });
  }

  const { ensureDeviceFromName } = await import("../services/deviceBootstrap.js");

  const priced = [];
  for (const item of itemsIn) {
    let deviceId = String(item.device_id || "").trim();
    let deviceName = String(item.device_name || "").trim();

    // Counter / telephone intake: name alone is enough — bootstrap device + image.
    if ((!deviceId || deviceId === "auto" || deviceId === "new") && deviceName) {
      const boot = await ensureDeviceFromName({ name: deviceName, seedPrices: true });
      deviceId = boot.device.id;
      deviceName = boot.device.name;
      if (!item.storage && boot.device.storages?.[0]) {
        item.storage = boot.device.storages[0];
      }
    }
    if (!deviceId) {
      return res.status(400).json({ error: "Each item needs device_id or device_name" });
    }

    const q = computeServerQuote({
      deviceId,
      storage: item.storage,
      conditionGrade: item.condition_grade,
      carrier: item.carrier,
      batteryHealth: item.battery_health,
      promoCode: req.body?.promo_code,
    });
    if (!q) return res.status(422).json({ error: `No price for ${deviceId}` });
    priced.push({
      ...item,
      device_id: deviceId,
      device_name: deviceName || deviceId,
      quoted_price: q.quotedPrice,
    });
  }

  const db = getDb();
  const customerId = nanoid(12);
  db.prepare(
    "INSERT INTO customers (id, first_name, last_name, email, phone) VALUES (?, ?, ?, ?, ?)",
  ).run(
    customerId,
    String(contact.first_name).slice(0, 120),
    String(contact.last_name).slice(0, 120),
    contact.email ? String(contact.email).slice(0, 254) : null,
    contact.phone ? String(contact.phone).slice(0, 40) : null,
  );

  const id = `TG-${Date.now().toString(36).toUpperCase()}-${nanoid(4).toUpperCase()}`;
  const total = priced.reduce((s, i) => s + i.quoted_price, 0);
  db.prepare(
    `INSERT INTO offers (id, customer_id, status, offer_type, total_value, payout_method, promo_code, notes, store_id, created_by, source, org_id)
     VALUES (?, ?, 'active_lead', ?, ?, ?, ?, ?, ?, ?, 'handoff', ?)`,
  ).run(
    id,
    customerId,
    req.body?.offer_type || "drop-off",
    total,
    req.body?.payout_method || "cash",
    req.body?.promo_code || null,
    req.body?.notes || null,
    req.body?.store_id || "tg-burlington",
    req.tgAuth?.userId || null,
    req.tgAuth?.orgId || "org-tech-genius",
  );
  db.prepare("UPDATE customers SET org_id = ? WHERE id = ?").run(
    req.tgAuth?.orgId || "org-tech-genius",
    customerId,
  );

  const insertItem = db.prepare(
    `INSERT INTO offer_items (offer_id, device_id, device_name, storage, carrier, condition_grade, quoted_price, battery_health, imei)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const item of priced) {
    insertItem.run(
      id,
      item.device_id,
      item.device_name,
      item.storage,
      item.carrier || null,
      item.condition_grade,
      item.quoted_price,
      item.battery_health ?? null,
      item.imei || null,
    );
  }

  recordOfferNotification(db, {
    offerId: id,
    type: "handoff_created",
    channel: "in_app",
    recipient: contact.email || null,
    subject: `Hand-off offer ${id} ($${total})`,
  });
  notifyOfferStatusChange(db, id, "active_lead");
  db.close();

  await dispatchCrmWebhook(id, {
    type: "offer.created",
    source: "handoff",
    offer_id: id,
    total_value: total,
    contact,
  });

  res.status(201).json({ id, total_value: total, status: "active_lead" });
});

offersRouter.post("/", requireCapability("offers:write"), (req, res) => {
  const db = getDb();
  const { customer_id, offer_type, items, payout_method, promo_code, notes, store_id } = req.body;

  const id = `TG-${Date.now().toString(36).toUpperCase()}-${nanoid(4).toUpperCase()}`;
  const totalValue = (items || []).reduce(
    (s: number, i: { quoted_price: number }) => s + (i.quoted_price || 0),
    0,
  );

  db.prepare(
    `INSERT INTO offers (id, customer_id, status, offer_type, total_value, payout_method, promo_code, notes, store_id, created_by, source, org_id)
     VALUES (?, ?, 'active_lead', ?, ?, ?, ?, ?, ?, ?, 'api', ?)`,
  ).run(
    id,
    customer_id || null,
    offer_type || "mail-in",
    totalValue,
    payout_method || null,
    promo_code || null,
    notes || null,
    store_id || "tg-burlington",
    req.tgAuth?.userId || null,
    req.tgAuth?.orgId || "org-tech-genius",
  );

  const insertItem = db.prepare(
    `INSERT INTO offer_items (offer_id, device_id, device_name, storage, carrier, condition_grade, quoted_price, battery_health, imei)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const item of items || []) {
    insertItem.run(
      id,
      item.device_id || null,
      item.device_name,
      item.storage || null,
      item.carrier || null,
      item.condition_grade || null,
      item.quoted_price || 0,
      item.battery_health || null,
      item.imei || null,
    );
  }
  db.close();
  res.status(201).json({ id, total_value: totalValue, status: "active_lead" });
});

offersRouter.patch("/:id/status", requireCapability("offers:write"), (req, res) => {
  const db = getDb();
  const status = String(req.body?.status || "").trim();
  if (!ALLOWED_STATUSES.has(status)) {
    db.close();
    return res.status(400).json({ error: "Invalid status" });
  }

  const existingOffer = db
    .prepare("SELECT id, status FROM offers WHERE id = ?")
    .get(req.params.id) as { id: string; status: string } | undefined;
  if (!existingOffer) {
    db.close();
    return res.status(404).json({ error: "Not found" });
  }

  db.prepare("UPDATE offers SET status = ?, updated_at = datetime('now') WHERE id = ?").run(
    status,
    req.params.id,
  );

  logActivityWith(
    db,
    {
      entityType: "offer",
      entityId: req.params.id,
      action: "status_changed",
      field: "status",
      oldValue: existingOffer.status,
      newValue: status,
    },
    actorOf(req),
  );

  let inventoryCreated = 0;
  let invoiceId: string | null = null;
  if (status === "completed") {
    const existing = db
      .prepare(
        `SELECT COUNT(*) as c FROM inventory i
       JOIN offer_items oi ON oi.id = i.offer_item_id
       WHERE oi.offer_id = ?`,
      )
      .get(req.params.id) as { c: number };
    if (!existing.c) {
      const items = db.prepare("SELECT * FROM offer_items WHERE offer_id = ?").all(req.params.id) as Array<{
        id: number;
        device_name: string;
        imei?: string;
        condition_grade?: string;
        quoted_price: number;
      }>;
      const storeRow = db.prepare("SELECT store_id FROM offers WHERE id = ?").get(req.params.id) as {
        store_id?: string;
      };
      const insert = db.prepare(
        "INSERT INTO inventory (id, offer_item_id, device_name, imei, condition_grade, cost, status, store_id) VALUES (?, ?, ?, ?, ?, ?, 'available', ?)",
      );
      for (const item of items) {
        insert.run(
          nanoid(12),
          item.id,
          item.device_name,
          item.imei || null,
          item.condition_grade || null,
          item.quoted_price,
          storeRow?.store_id || "tg-burlington",
        );
        inventoryCreated += 1;
      }
    }
    db.prepare(
      `UPDATE offers SET payout_status = CASE
         WHEN payout_status IS NULL OR payout_status = 'pending' THEN 'ready'
         ELSE payout_status
       END, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(req.params.id);
    invoiceId = ensureInvoiceForCompletedOffer(db, req.params.id);
  }

  notifyOfferStatusChange(db, req.params.id, status);
  db.close();
  res.json({ ok: true, status, inventory_created: inventoryCreated, invoice_id: invoiceId });
});

offersRouter.patch("/:id", requireCapability("offers:write"), (req, res) => {
  const db = getDb();
  const { payout_method, payout_status, shipping_label_url, tracking_number, courier, notes, store_id } =
    req.body;

  // Status moves live on PATCH /:id/status because they also create invoices and
  // inventory. This route used to accept `status` into the void and answer 200,
  // so a caller believed an offer had advanced when nothing had happened —
  // silent success is worse than an error, and it fooled our own smoke test.
  if (req.body && Object.prototype.hasOwnProperty.call(req.body, "status")) {
    db.close();
    return res.status(400).json({
      error: "Use PATCH /api/offers/:id/status to change status",
      detail:
        "Status transitions also issue invoices and create inventory, so they are handled by a dedicated endpoint.",
    });
  }

  const before = db
    .prepare("SELECT payout_method, payout_status, tracking_number, courier, store_id FROM offers WHERE id = ?")
    .get(req.params.id) as Record<string, string | null> | undefined;
  if (!before) {
    db.close();
    return res.status(404).json({ error: "Not found" });
  }

  db.prepare(
    `UPDATE offers SET
      payout_method = COALESCE(?, payout_method),
      payout_status = COALESCE(?, payout_status),
      shipping_label_url = COALESCE(?, shipping_label_url),
      tracking_number = COALESCE(?, tracking_number),
      courier = COALESCE(?, courier),
      notes = COALESCE(?, notes),
      store_id = COALESCE(?, store_id),
      updated_at = datetime('now')
    WHERE id = ?`,
  ).run(
    payout_method,
    payout_status,
    shipping_label_url,
    tracking_number,
    courier,
    notes,
    store_id,
    req.params.id,
  );

  // Record only what actually moved, so the trail stays readable.
  const changes: Array<[string, unknown]> = [
    ["payout_method", payout_method],
    ["payout_status", payout_status],
    ["tracking_number", tracking_number],
    ["courier", courier],
    ["store_id", store_id],
  ];
  for (const [field, next] of changes) {
    if (next == null || String(next) === String(before[field] ?? "")) continue;
    logActivityWith(db, {
      entityType: "offer", entityId: req.params.id, action: "updated",
      field, oldValue: before[field], newValue: String(next),
    }, actorOf(req));
  }
  if (notes != null) {
    logActivityWith(db, {
      entityType: "offer", entityId: req.params.id, action: "note_added", field: "notes",
      newValue: String(notes).slice(0, 200),
    }, actorOf(req));
  }

  db.close();
  res.json({ ok: true });
});

/** Generate printable mail-in shipping label (HTML) and store URL. */
offersRouter.post("/:id/shipping-label", requireCapability("shipping:write"), (req, res) => {
  const db = getDb();
  const offer = db
    .prepare(
      `SELECT o.*, c.first_name, c.last_name, c.email, c.phone
       FROM offers o LEFT JOIN customers c ON c.id = o.customer_id WHERE o.id = ?`,
    )
    .get(req.params.id) as Record<string, unknown> | undefined;
  if (!offer) {
    db.close();
    return res.status(404).json({ error: "Not found" });
  }
  const tracking =
    String(req.body?.tracking_number || offer.tracking_number || "").trim() ||
    `TG${Date.now().toString(36).toUpperCase()}`;
  const courier = String(req.body?.courier || offer.courier || "Canada Post").slice(0, 40);
  const labelUrl = `/api/offers/${encodeURIComponent(req.params.id)}/shipping-label`;
  db.prepare(
    `UPDATE offers SET shipping_label_url = ?, tracking_number = ?, courier = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(labelUrl, tracking, courier, req.params.id);
  recordOfferNotification(db, {
    offerId: req.params.id,
    type: "shipping_label_generated",
    channel: "in_app",
    subject: `Shipping label ${tracking} for ${req.params.id}`,
  });
  db.close();
  res.json({ ok: true, shipping_label_url: labelUrl, tracking_number: tracking, courier });
});

offersRouter.get("/:id/shipping-label", requireCapability("shipping:write"), (req, res) => {
  const db = getDb();
  const offer = db
    .prepare(
      `SELECT o.*, c.first_name, c.last_name, c.email, c.phone,
              (SELECT value FROM settings WHERE key = 'company_name') AS company_name,
              (SELECT value FROM settings WHERE key = 'company_phone') AS company_phone
       FROM offers o LEFT JOIN customers c ON c.id = o.customer_id WHERE o.id = ?`,
    )
    .get(req.params.id) as Record<string, unknown> | undefined;
  const items = db
    .prepare("SELECT device_name, storage, condition_grade FROM offer_items WHERE offer_id = ?")
    .all(req.params.id) as Array<{ device_name: string; storage?: string; condition_grade?: string }>;
  db.close();
  if (!offer) return res.status(404).send("Not found");

  const html = `<!doctype html><html><head><meta charset="utf-8"/><title>Label ${offer.id}</title>
  <style>
    body{font-family:Arial,sans-serif;margin:1.5rem;color:#111}
    .box{border:2px solid #111;padding:1rem;max-width:420px}
    h1{font-size:1.1rem;margin:0 0 .5rem}
    .code{font-size:1.4rem;font-weight:700;letter-spacing:.04em}
    @media print{button{display:none}}
  </style></head><body>
  <button onclick="print()">Print label</button>
  <div class="box">
    <h1>${offer.company_name || "Tech Genius Burlington"}</h1>
    <p>MAIL-IN TRADE-IN<br/>${offer.company_phone || ""}</p>
    <p class="code">${offer.tracking_number || offer.id}</p>
    <p>Offer: ${offer.id}<br/>From: ${offer.first_name || ""} ${offer.last_name || ""}<br/>${offer.email || ""} · ${offer.phone || ""}</p>
    <p>Courier: ${offer.courier || "Canada Post"}</p>
    <ul>${items.map((i) => `<li>${i.device_name} ${i.storage || ""} ${i.condition_grade || ""}</li>`).join("")}</ul>
    <p><strong>Ship to:</strong><br/>Tech Genius Burlington<br/>Trade-In Desk<br/>Burlington, ON</p>
  </div></body></html>`;
  res.type("html").send(html);
});

/** Who is making this change, for the audit trail. */
function actorOf(req: Request): Actor {
  return {
    name: req.tgAuth?.name ?? req.tgAuth?.userId ?? "unknown",
    role: req.tgAuth?.role ?? null,
    orgId: req.tgAuth?.orgId ?? null,
  };
}

/** Full change history for one offer — who did what, when. */
offersRouter.get("/:id/history", requireCapability("offers:read"), (req, res) => {
  res.json(historyFor("offer", req.params.id));
});
