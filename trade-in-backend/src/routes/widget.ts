import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "../db/migrate.js";
import { nanoid } from "nanoid";
import { computeServerQuote } from "../services/quoteEngine.js";
import { notifyOfferStatusChange, recordOfferNotification } from "../services/notifications.js";
import { CUSTOMER_JOURNEY, customerStatus, journeyIndex } from "../services/customerStatus.js";
import { dispatchCrmWebhook } from "../services/crmWebhook.js";
import { ensureDeviceFromName, looksLikeProductName } from "../services/deviceBootstrap.js";
import { DEFAULT_ORG_ID, getOrgBySlug, listOrgStores } from "../services/tenancy.js";
import { getWidgetTemplate, orgWidgetTemplate, WIDGET_TEMPLATES } from "../services/widgetTemplate.js";
import type { Database } from "better-sqlite3";

export const widgetRouter = Router();

const UPLOAD_ROOT = path.resolve(import.meta.dirname, "../../data/uploads");

/**
 * Public: which frontend template the widget should render with.
 * Pass ?org=slug for a tenant override; without it you get the global setting.
 * The widget calls this before first paint, so it must stay key-free and cheap.
 */
widgetRouter.get("/template", (req, res) => {
  const slug = String(req.query.org || "").trim();
  if (!slug) {
    return res.json({ template: getWidgetTemplate(), templates: WIDGET_TEMPLATES });
  }
  const db = getDb();
  try {
    const org = getOrgBySlug(db, slug);
    if (!org) return res.status(404).json({ error: "Organization not found" });
    res.json({ template: orgWidgetTemplate(db, org.id), templates: WIDGET_TEMPLATES });
  } finally {
    db.close();
  }
});

/**
 * Colours the widget offers. The column is free text, so this is what keeps a
 * crafted request from writing arbitrary strings into a field the shop reads
 * off a packing bench. Kept in step with DEVICE_COLORS in the widget.
 */
const ALLOWED_COLORS = new Set([
  "Black",
  "White",
  "Silver",
  "Grey",
  "Gold",
  "Blue",
  "Green",
  "Red",
  "Purple",
  "Pink",
  "Yellow",
  "Other",
]);

function defaultStoreId(db: Database, orgId: string): string {
  const stores = listOrgStores(db, orgId, true);
  return stores[0]?.id || "tg-burlington";
}

/**
 * Phone picker bootstrap: customer searched a model that isn't in catalog yet.
 * Builds image + adds device so the trade-in flow can continue.
 */
widgetRouter.post("/ensure-device", async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    if (!looksLikeProductName(name)) {
      return res.status(400).json({
        error: "Enter a full phone / device model name (e.g. iPhone 17 Pro Max).",
      });
    }
    const result = await ensureDeviceFromName({
      name,
      categoryId: req.body?.category_id || "smartphone",
      rebuildImage: Boolean(req.body?.rebuild_image),
      seedPrices: true,
    });
    res.status(result.created ? 201 : 200).json(result);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Could not add device" });
  }
});

/**
 * Public: record an abandoned buyback.
 *
 * Called by the widget as soon as a shopper has both a priced device and a way
 * to reach them, then updated as they progress. Most people who price a device
 * never finish, and until now every one of them was discarded — the shop had no
 * idea who nearly sold them a phone. This is deliberately upsert-by-email so
 * repeat visits update one lead rather than creating a pile.
 *
 * Prices here are only what the widget last displayed, recorded for follow-up
 * context. They are never authoritative: converting a lead re-quotes on the
 * server like any other offer.
 */
widgetRouter.post("/lead", (req, res) => {
  const body = (req.body || {}) as {
    first_name?: string;
    last_name?: string;
    email?: string;
    phone?: string;
    offer_type?: string;
    payout_method?: string;
    furthest_step?: string;
    quoted_total?: number;
    items?: Array<{ device_id?: string; device_name?: string; storage?: string; condition_grade?: string; quoted_price?: number }>;
    org?: string;
    store_id?: string;
  };

  const email = String(body.email || "").trim().slice(0, 254);
  const phone = String(body.phone || "").trim().slice(0, 40);
  // Without a way to contact them there is nothing to follow up on.
  if (!email && !phone) {
    return res.status(400).json({ error: "email or phone is required to record a lead" });
  }

  const items = Array.isArray(body.items) ? body.items.slice(0, 50) : [];
  const db = getDb();
  try {
    let orgId = DEFAULT_ORG_ID;
    const slug = String(body.org || req.headers["x-org-slug"] || "").trim();
    if (slug) {
      const hit = slug.startsWith("org-") ? null : getOrgBySlug(db, slug);
      orgId = hit?.id || (slug.startsWith("org-") ? slug : DEFAULT_ORG_ID);
    }

    const existing = email
      ? (db
          .prepare("SELECT id FROM abandoned_leads WHERE email = ? AND status = 'open' LIMIT 1")
          .get(email) as { id: string } | undefined)
      : undefined;

    const payload = {
      first_name: String(body.first_name || "").slice(0, 120) || null,
      last_name: String(body.last_name || "").slice(0, 120) || null,
      email: email || null,
      phone: phone || null,
      offer_type: body.offer_type ? String(body.offer_type).slice(0, 40) : null,
      payout_method: body.payout_method ? String(body.payout_method).slice(0, 40) : null,
      items_json: JSON.stringify(items).slice(0, 20_000),
      quoted_total: Number(body.quoted_total) || 0,
      furthest_step: body.furthest_step ? String(body.furthest_step).slice(0, 40) : null,
      store_id: body.store_id ? String(body.store_id).slice(0, 64) : defaultStoreId(db, orgId),
    };

    if (existing) {
      // COALESCE on the incoming value, not the stored one: the widget fires
      // this repeatedly as the shopper progresses and a later call may carry
      // only an email. Overwriting blindly wiped the name we already had —
      // leaving staff a lead they could not address by name.
      db.prepare(
        `UPDATE abandoned_leads SET
           first_name = COALESCE(?, first_name),
           last_name = COALESCE(?, last_name),
           email = COALESCE(?, email),
           phone = COALESCE(?, phone),
           offer_type = COALESCE(?, offer_type),
           payout_method = COALESCE(?, payout_method),
           items_json = ?, quoted_total = ?,
           furthest_step = COALESCE(?, furthest_step),
           store_id = COALESCE(?, store_id),
           updated_at = datetime('now')
         WHERE id = ?`,
      ).run(
        payload.first_name, payload.last_name, payload.email, payload.phone,
        payload.offer_type, payload.payout_method, payload.items_json, payload.quoted_total,
        payload.furthest_step, payload.store_id, existing.id,
      );
      return res.json({ id: existing.id, updated: true });
    }

    const id = `LEAD-${nanoid(10).toUpperCase()}`;
    db.prepare(
      `INSERT INTO abandoned_leads (id, org_id, store_id, first_name, last_name, email, phone,
         offer_type, payout_method, items_json, quoted_total, furthest_step)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id, orgId, payload.store_id, payload.first_name, payload.last_name, payload.email,
      payload.phone, payload.offer_type, payload.payout_method, payload.items_json,
      payload.quoted_total, payload.furthest_step,
    );
    res.status(201).json({ id, updated: false });
  } finally {
    db.close();
  }
});

/** Public widget submission — creates customer + offer; prices always re-quoted server-side. */
widgetRouter.post("/submit", (req, res) => {
  const db = getDb();
  const {
    contact,
    offer_type,
    payout_method,
    promo_code,
    items,
    ai_scan,
  } = req.body as {
    contact?: {
      first_name?: string;
      last_name?: string;
      email?: string;
      phone?: string;
    };
    offer_type?: string;
    payout_method?: string;
    promo_code?: string;
    ai_scan?: unknown;
    items?: Array<{
      device_id?: string;
      device_name: string;
      storage?: string;
      memory?: string;
      carrier?: string;
      color?: string;
      condition_grade?: string;
      quoted_price?: number;
      battery_health?: number | null;
      imei?: string;
    }>;
  };

  if (!contact?.first_name || !contact?.last_name || !items?.length) {
    db.close();
    return res.status(400).json({ error: "contact.first_name, contact.last_name, and items are required" });
  }

  if (items.length > 50) {
    db.close();
    return res.status(400).json({ error: "Too many items in a single submission" });
  }

  const clip = (v: unknown, max: number): string | null => {
    if (v == null) return null;
    const s = String(v).trim();
    return s ? s.slice(0, max) : null;
  };
  contact.first_name = clip(contact.first_name, 120) || "";
  contact.last_name = clip(contact.last_name, 120) || "";
  contact.email = clip(contact.email, 254) || undefined;
  contact.phone = clip(contact.phone, 40) || undefined;

  // Re-quote every line on the server — never trust client quoted_price.
  const pricedItems: Array<{
    device_id: string | null;
    device_name: string;
    storage: string | null;
    memory: string | null;
    carrier: string | null;
    color: string | null;
    condition_grade: string | null;
    quoted_price: number;
    battery_health: number | null;
    imei: string | null;
  }> = [];

  for (const item of items) {
    const deviceId = item.device_id ? String(item.device_id).slice(0, 64) : "";
    const storage = item.storage ? String(item.storage).slice(0, 40) : "";
    const memory = item.memory ? String(item.memory).slice(0, 40) : "";
    const grade = item.condition_grade ? String(item.condition_grade).slice(0, 40) : "";

    if (!deviceId || !storage || !grade) {
      db.close();
      return res.status(400).json({
        error: "Each item requires device_id, storage, and condition_grade so the server can price it",
      });
    }

    const quote = computeServerQuote({
      deviceId,
      storage,
      memory: memory || null,
      conditionGrade: grade,
      carrier: item.carrier,
      batteryHealth: item.battery_health,
      promoCode: promo_code,
      payoutMethod: payout_method,
    });

    if (!quote) {
      db.close();
      return res.status(422).json({
        error: `No server price for ${item.device_name || deviceId} ${storage} / ${grade}`,
      });
    }

    pricedItems.push({
      device_id: deviceId,
      device_name: String(item.device_name || "Unknown device").slice(0, 200),
      storage,
      memory: memory || null,
      carrier: item.carrier ? String(item.carrier).slice(0, 40) : null,
      // Whatever the browser sends is untrusted text on a page staff will read.
      // Only the colours the widget actually offers are accepted; anything else
      // is dropped rather than stored, since it is optional and decorative.
      color: ALLOWED_COLORS.has(String(item.color || "").trim())
        ? String(item.color).trim()
        : null,
      condition_grade: grade,
      quoted_price: quote.quotedPrice,
      battery_health: item.battery_health ?? null,
      imei: item.imei ? String(item.imei).slice(0, 40) : null,
    });
  }

  const customerId = nanoid(12);
  const id = `TG-${Date.now().toString(36).toUpperCase()}-${nanoid(4).toUpperCase()}`;
  const totalValue = pricedItems.reduce((s, i) => s + i.quoted_price, 0);

  // Resolve SaaS tenant from body / headers (public widget)
  const orgHint = String(
    (req.body as { org?: string; org_slug?: string; org_id?: string })?.org ||
      (req.body as { org_slug?: string })?.org_slug ||
      (req.body as { org_id?: string })?.org_id ||
      req.headers["x-org-slug"] ||
      req.headers["x-org-id"] ||
      "",
  ).trim();
  let orgId = DEFAULT_ORG_ID;
  if (orgHint) {
    if (orgHint.startsWith("org-")) orgId = orgHint;
    else {
      const hit = getOrgBySlug(db, orgHint);
      if (hit) orgId = hit.id;
    }
  }
  const storeId = (req.body as { store_id?: string })?.store_id || defaultStoreId(db, orgId);

  // One offer is one transaction. These six writes describe a single customer
  // action, and a partial application of them is worse than none: an offer with
  // no items cannot be paid out, a lead marked "converted" against an offer that
  // was never written is unrecoverable, and a promo use counted without an offer
  // silently burns a redemption. SQLite rolls the whole set back on any throw.
  const commitOffer = db.transaction(() => {
    db.prepare(
      "INSERT INTO customers (id, first_name, last_name, email, phone, org_id) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      customerId,
      contact.first_name,
      contact.last_name,
      contact.email || null,
      contact.phone || null,
      orgId,
    );

    db.prepare(
      `INSERT INTO offers (id, customer_id, status, offer_type, total_value, payout_method, promo_code, store_id, source, ai_scan_json, org_id)
       VALUES (?, ?, 'active_lead', ?, ?, ?, ?, ?, 'widget', ?, ?)`,
    ).run(
      id,
      customerId,
      offer_type || "mail-in",
      totalValue,
      payout_method || null,
      promo_code || null,
      storeId,
      ai_scan ? JSON.stringify(ai_scan).slice(0, 50_000) : null,
      orgId,
    );

    // This shopper came back and finished, so their lead is no longer abandoned.
    // Marked rather than deleted, so "leads recovered" stays measurable.
    if (contact.email) {
      db.prepare(
        `UPDATE abandoned_leads SET status = 'converted', converted_offer_id = ?, updated_at = datetime('now')
          WHERE email = ? AND status = 'open'`,
      ).run(id, contact.email);
    }

    const insertItem = db.prepare(
      `INSERT INTO offer_items (offer_id, device_id, device_name, storage, memory, carrier, color, condition_grade, quoted_price, battery_health, imei)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const item of pricedItems) {
      insertItem.run(
        id,
        item.device_id,
        item.device_name,
        item.storage,
        item.memory,
        item.carrier,
        item.color,
        item.condition_grade,
        item.quoted_price,
        item.battery_health,
        item.imei,
      );
    }

    if (promo_code) {
      db.prepare(
        `UPDATE promo_codes SET uses = uses + 1
         WHERE code = ? AND active = 1
           AND (max_uses IS NULL OR uses < max_uses)`,
      ).run(String(promo_code).toUpperCase());
    }
  });
  commitOffer();

  recordOfferNotification(db, {
    offerId: id,
    type: "offer_submitted",
    channel: "in_app",
    recipient: contact.email || null,
    subject: `New trade-in offer ${id} ($${totalValue})`,
  });
  notifyOfferStatusChange(db, id, "active_lead");

  db.close();

  void dispatchCrmWebhook(id, {
    type: "offer.created",
    source: "widget",
    offer_id: id,
    total_value: totalValue,
    contact,
  });

  res.status(201).json({
    id,
    total_value: totalValue,
    status: "active_lead",
    items: pricedItems.map((i) => ({
      device_id: i.device_id,
      quoted_price: i.quoted_price,
    })),
  });
});

/**
 * Attach angle photos from the trade-in vision step to a just-created offer.
 * Offer IDs are unguessable (TG-…); no auth required for widget evidence.
 */
widgetRouter.post("/offers/:id/media", (req, res) => {
  const offerId = String(req.params.id || "");
  const files = (req.body?.files || []) as Array<{
    filename?: string;
    mime_type?: string;
    content_base64?: string;
    angle?: string;
  }>;
  if (!offerId || !Array.isArray(files) || !files.length) {
    return res.status(400).json({ error: "offer id + files[] required" });
  }
  if (files.length > 8) return res.status(400).json({ error: "Max 8 media files" });

  fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
  const db = getDb();
  const offer = db.prepare("SELECT id FROM offers WHERE id = ?").get(offerId);
  if (!offer) {
    db.close();
    return res.status(404).json({ error: "Offer not found" });
  }

  const saved = [];
  for (const file of files) {
    const mime = String(file.mime_type || "image/jpeg").slice(0, 80);
    if (!/^image\/(jpeg|png|webp|gif)$/.test(mime)) {
      continue;
    }
    let buf: Buffer;
    try {
      buf = Buffer.from(String(file.content_base64 || ""), "base64");
    } catch {
      continue;
    }
    if (!buf.length || buf.length > 6 * 1024 * 1024) continue;

    const id = nanoid(12);
    const filename = String(file.filename || `${file.angle || "photo"}.jpg`)
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(0, 120);
    const stored = `${id}-${filename}`;
    fs.writeFileSync(path.join(UPLOAD_ROOT, stored), buf);

    const angle = file.angle ? String(file.angle).slice(0, 20) : null;
    try {
      db.prepare(
        `INSERT INTO uploads (id, offer_id, filename, mime_type, size_bytes, storage_path, uploaded_by, angle)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
      ).run(id, offerId, filename, mime, buf.length, stored, angle);
    } catch {
      db.prepare(
        `INSERT INTO uploads (id, offer_id, filename, mime_type, size_bytes, storage_path, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      ).run(id, offerId, filename, mime, buf.length, stored);
    }
    saved.push({ id, filename, angle, url: `/api/uploads/${id}/file` });
  }

  db.close();
  res.status(201).json({ ok: true, count: saved.length, files: saved });
});

/** Public offer tracking (limited fields) */
widgetRouter.get("/offers/:id", (req, res) => {
  const db = getDb();
  const offer = db
    .prepare(
      `SELECT o.id, o.status, o.total_value, o.offer_type, o.payout_method, o.created_at,
            c.first_name, c.last_name, c.email
     FROM offers o
     LEFT JOIN customers c ON o.customer_id = c.id
     WHERE o.id = ?`,
    )
    .get(req.params.id) as Record<string, unknown> | undefined;

  if (!offer) {
    db.close();
    return res.status(404).json({ error: "Offer not found" });
  }

  const items = db
    .prepare(
      "SELECT device_name, storage, carrier, color, condition_grade, quoted_price FROM offer_items WHERE offer_id = ?",
    )
    .all(req.params.id);

  db.close();
  if (typeof offer.email === "string" && offer.email.includes("@")) {
    const [local, domain] = offer.email.split("@");
    const maskedLocal =
      local.length <= 2 ? `${local[0] ?? ""}*` : `${local[0]}***${local[local.length - 1]}`;
    offer.email = `${maskedLocal}@${domain}`;
  }
  // The tracker used to render whatever came back here, which was the raw
  // column: a customer was told their offer was "active_lead".
  const shown = customerStatus(String(offer.status));
  res.json({
    ...offer,
    status_label: shown.label,
    status_note: shown.note,
    journey: CUSTOMER_JOURNEY,
    journey_index: journeyIndex(String(offer.status)),
    items,
  });
});

/**
 * Customer portal unlock — requires matching email on the offer.
 * Returns richer status than public track (payout, tracking, invoice).
 */
widgetRouter.post("/portal", (req, res) => {
  const offerId = String(req.body?.offer_id || "").trim();
  const email = String(req.body?.email || "")
    .trim()
    .toLowerCase();
  if (!offerId || !email) {
    return res.status(400).json({ error: "offer_id and email are required" });
  }

  const db = getDb();
  const offer = db
    .prepare(
      `SELECT o.id, o.status, o.total_value, o.offer_type, o.payout_method, o.payout_status,
              o.tracking_number, o.courier, o.shipping_label_url, o.created_at, o.updated_at,
              c.first_name, c.last_name, c.email, c.phone
       FROM offers o
       LEFT JOIN customers c ON o.customer_id = c.id
       WHERE o.id = ?`,
    )
    .get(offerId) as Record<string, unknown> | undefined;

  if (!offer) {
    db.close();
    return res.status(404).json({ error: "Offer not found" });
  }

  const storedEmail = String(offer.email || "")
    .trim()
    .toLowerCase();
  if (!storedEmail || storedEmail !== email) {
    db.close();
    return res.status(403).json({ error: "Email does not match this offer" });
  }

  const items = db
    .prepare(
      "SELECT device_name, storage, carrier, color, condition_grade, quoted_price FROM offer_items WHERE offer_id = ?",
    )
    .all(offerId);
  const invoice = db
    .prepare("SELECT id, status, amount, issued_at FROM invoices WHERE offer_id = ? ORDER BY issued_at DESC LIMIT 1")
    .get(offerId);
  db.close();

  // workflow_stages.label is what the staff board calls this stage. The person
  // who sold us the phone gets the customer wording instead.
  const shown = customerStatus(String(offer.status));
  res.json({
    ...offer,
    status_label: shown.label,
    status_note: shown.note,
    journey: CUSTOMER_JOURNEY,
    journey_index: journeyIndex(String(offer.status)),
    items,
    invoice: invoice || null,
    portal: true,
  });
});
