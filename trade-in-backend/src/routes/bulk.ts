import { Router } from "express";
import { nanoid } from "nanoid";
import { getDb } from "../db/migrate.js";
import { requireCapability } from "../middleware/auth.js";
import { computeServerQuote } from "../services/quoteEngine.js";
import { notifyOfferStatusChange, recordOfferNotification } from "../services/notifications.js";
import { dispatchCrmWebhook } from "../services/crmWebhook.js";
import { ensureDeviceFromName } from "../services/deviceBootstrap.js";

export const bulkRouter = Router();

type BulkItemIn = {
  device_id?: string;
  device_name?: string;
  storage: string;
  condition_grade: string;
  carrier?: string;
  battery_health?: number;
};

async function resolveBulkItem(
  item: BulkItemIn,
): Promise<BulkItemIn & { device_id: string; device_name: string }> {
  let deviceId = String(item.device_id || "").trim();
  let deviceName = String(item.device_name || "").trim();

  if ((!deviceId || deviceId === "auto" || deviceId === "new") && deviceName) {
    const boot = await ensureDeviceFromName({ name: deviceName, seedPrices: true });
    deviceId = boot.device.id;
    deviceName = boot.device.name;
    if (!item.storage && boot.device.storages?.[0]) item.storage = boot.device.storages[0];
  } else if (!deviceId && deviceName) {
    const boot = await ensureDeviceFromName({ name: deviceName, seedPrices: true });
    deviceId = boot.device.id;
    deviceName = boot.device.name;
  } else if (deviceId && !deviceName) {
    deviceName = deviceId;
  }

  if (!deviceId) throw new Error("Each item needs device_id or device_name");
  return { ...item, device_id: deviceId, device_name: deviceName || deviceId };
}

bulkRouter.post("/quote", requireCapability("bulk:quote"), async (req, res) => {
  const items = (req.body?.items || []) as BulkItemIn[];
  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: "items[] required" });
  }
  if (items.length > 100) return res.status(400).json({ error: "Max 100 items" });

  const promo = req.body?.promo_code ? String(req.body.promo_code) : null;
  const quoted = [];
  try {
    for (const raw of items) {
      const item = await resolveBulkItem(raw);
      if (!item.storage || !item.condition_grade) {
        return res.status(400).json({ error: "Each item needs storage and condition_grade" });
      }
      const q = computeServerQuote({
        deviceId: item.device_id,
        storage: item.storage,
        conditionGrade: item.condition_grade,
        carrier: item.carrier,
        batteryHealth: item.battery_health,
        promoCode: promo,
      });
      if (!q) {
        quoted.push({
          device_id: item.device_id,
          storage: item.storage,
          condition_grade: item.condition_grade,
          error: "No price",
          quoted_price: null,
        });
      } else {
        quoted.push({
          device_id: item.device_id,
          device_name: item.device_name,
          storage: item.storage,
          condition_grade: item.condition_grade,
          quoted_price: q.quotedPrice,
          price_source: q.priceSource,
        });
      }
    }
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "Resolve failed" });
  }
  const total = quoted.reduce((s, i) => s + (i.quoted_price || 0), 0);
  res.json({ items: quoted, total_value: total, count: quoted.length });
});

/** Create a multi-device offer from bulk quote (enterprise Instant Bulk). */
bulkRouter.post("/offer", requireCapability("bulk:quote"), async (req, res) => {
  const contact = req.body?.contact || {};
  const items = (req.body?.items || []) as BulkItemIn[];
  if (!contact.first_name || !contact.last_name || !items.length) {
    return res.status(400).json({ error: "contact + items required" });
  }

  const promo = req.body?.promo_code ? String(req.body.promo_code) : null;
  const priced = [];
  try {
    for (const raw of items) {
      const item = await resolveBulkItem(raw);
      const q = computeServerQuote({
        deviceId: item.device_id,
        storage: item.storage,
        conditionGrade: item.condition_grade,
        carrier: item.carrier,
        batteryHealth: item.battery_health,
        promoCode: promo,
      });
      if (!q) {
        return res.status(422).json({ error: `No price for ${item.device_id}` });
      }
      priced.push({
        ...item,
        quoted_price: q.quotedPrice,
      });
    }
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : "Resolve failed" });
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
  const storeId = String(req.body?.store_id || "tg-burlington");
  const orgId = req.tgAuth?.orgId || "org-tech-genius";
  db.prepare(
    `INSERT INTO offers (id, customer_id, status, offer_type, total_value, payout_method, promo_code, store_id, created_by, source, org_id)
     VALUES (?, ?, 'active_lead', ?, ?, ?, ?, ?, ?, 'bulk', ?)`,
  ).run(
    id,
    customerId,
    req.body?.offer_type || "mail-in",
    total,
    req.body?.payout_method || null,
    promo,
    storeId,
    req.tgAuth?.userId || null,
    orgId,
  );
  db.prepare("UPDATE customers SET org_id = ? WHERE id = ?").run(orgId, customerId);

  const insertItem = db.prepare(
    `INSERT INTO offer_items (offer_id, device_id, device_name, storage, carrier, condition_grade, quoted_price, battery_health)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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
    );
  }

  if (promo) {
    db.prepare("UPDATE promo_codes SET uses = uses + 1 WHERE code = ? AND active = 1").run(
      promo.toUpperCase(),
    );
  }

  recordOfferNotification(db, {
    offerId: id,
    type: "bulk_offer_created",
    channel: "in_app",
    recipient: contact.email || null,
    subject: `Bulk offer ${id} ($${total})`,
  });
  notifyOfferStatusChange(db, id, "active_lead");

  await dispatchCrmWebhook(id, {
    type: "offer.created",
    source: "bulk",
    offer_id: id,
    total_value: total,
    contact,
  });

  db.close();
  res.status(201).json({ id, total_value: total, status: "active_lead", items: priced.length });
});
