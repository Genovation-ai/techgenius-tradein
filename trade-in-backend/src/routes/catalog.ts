import { Router } from "express";
import { getDb } from "../db/migrate.js";
import { nanoid } from "nanoid";
import { apiKeyAuth } from "../middleware/auth.js";
import { getFrontendPricingConfig } from "../services/competitorPricing.js";
import {
  ensureDeviceFromName,
  looksLikeProductName,
} from "../services/deviceBootstrap.js";

export const catalogRouter = Router();

// Categories
catalogRouter.get("/categories", (_req, res) => {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM categories ORDER BY sort_order").all();
  db.close();
  res.json(rows);
});

catalogRouter.post("/categories", apiKeyAuth, (req, res) => {
  const db = getDb();
  const { name, icon } = req.body;
  const id = nanoid(12);
  db.prepare("INSERT INTO categories (id, name, icon) VALUES (?, ?, ?)").run(id, name, icon || null);
  db.close();
  res.status(201).json({ id, name });
});

// Brands
catalogRouter.get("/brands", (req, res) => {
  const db = getDb();
  const categoryId = req.query.category_id as string | undefined;
  const rows = categoryId
    ? db.prepare("SELECT * FROM brands WHERE category_id = ? AND enabled = 1").all(categoryId)
    : db.prepare("SELECT * FROM brands WHERE enabled = 1").all();
  db.close();
  res.json(rows);
});

catalogRouter.post("/brands", apiKeyAuth, (req, res) => {
  const db = getDb();
  const { name, category_id } = req.body;
  const id = nanoid(12);
  db.prepare("INSERT INTO brands (id, name, category_id) VALUES (?, ?, ?)").run(id, name, category_id);
  db.close();
  res.status(201).json({ id, name });
});

// Devices
catalogRouter.get("/devices", (req, res) => {
  const db = getDb();
  const { category_id, brand_id, q, include_prices, limit, include_unquotable } = req.query;
  const rowLimit = Math.min(Math.max(parseInt(limit as string, 10) || 1000, 1), 5000);

  // A device with no priced configuration is a dead end: the shopper picks it,
  // answers every question, and gets an error instead of an offer. Hide those
  // from the customer catalog by default.
  //
  // Deliberately a listing filter rather than `enabled = 0`: the price syncs
  // only touch enabled rows, so disabling would freeze a device out of pricing
  // forever. This way the moment a sync gives it a price it reappears on its
  // own. Admin passes include_unquotable=1 to see and fix them.
  const showUnquotable = include_unquotable === "true" || include_unquotable === "1";
  let sql = "SELECT * FROM devices WHERE enabled = 1";
  if (!showUnquotable) {
    sql += " AND EXISTS (SELECT 1 FROM prices p WHERE p.device_id = devices.id AND p.base_price > 0)";
  }
  const params: unknown[] = [];
  if (category_id) { sql += " AND category_id = ?"; params.push(category_id); }
  if (brand_id) { sql += " AND brand_id = ?"; params.push(brand_id); }
  if (q) {
    sql += " AND (name LIKE ? OR id LIKE ?)";
    params.push(`%${q}%`, `%${q}%`);
  }
  sql += ` ORDER BY name LIMIT ${rowLimit}`;
  type DeviceRow = {
    id: string;
    category_id: string;
    brand_id: string;
    name: string;
    storages: string;
    image_url: string | null;
    enabled: number;
    created_at: string;
    max_price_flawless?: number;
    price_mode?: string;
    beat_percent?: number;
    price_matrix?: Record<string, Partial<Record<string, number>>>;
    prices?: Array<{
      device_id: string;
      storage: string;
      condition_grade: string;
      base_price: number;
      source: string;
      updated_at: string;
    }>;
  };
  const rows = (db.prepare(sql).all(...params) as DeviceRow[]).map((r) => ({
    ...r,
    storages: (() => {
      try {
        return JSON.parse(r.storages ?? "[]") as string[];
      } catch {
        return [] as string[];
      }
    })(),
  })) as Array<Omit<DeviceRow, "storages"> & { storages: string[] }>;

  const includePrices = include_prices === "true" || include_prices === "1";
  if (includePrices && rows.length > 0) {
    const cfg = getFrontendPricingConfig();
    const beatFactor =
      cfg.mode === "beat" && cfg.source !== "manual" ? 1 - cfg.beatPercent / 100 : 1;
    const applyBeat = (n: number) => Math.max(1, Math.round(n * beatFactor));

    const deviceIds = rows.map((r) => r.id);
    const placeholders = deviceIds.map(() => "?").join(",");
    const maxFlawlessRows = db
      .prepare(
        `SELECT device_id, MAX(base_price) AS max_price_flawless
         FROM prices
         WHERE condition_grade = 'flawless' AND device_id IN (${placeholders})
         GROUP BY device_id`,
      )
      .all(...deviceIds) as Array<{ device_id: string; max_price_flawless: number }>;

    const byId = new Map(
      maxFlawlessRows.map((r) => [r.device_id, applyBeat(r.max_price_flawless)]),
    );
    for (const row of rows) {
      row.max_price_flawless = byId.get(row.id) ?? 0;
    }

    // Full per-storage × grade matrix for admin / quote UIs (offer-facing amounts)
    const priceRows = db
      .prepare(
        `SELECT device_id, storage, condition_grade, base_price, source, updated_at
         FROM prices WHERE device_id IN (${placeholders})
         ORDER BY storage, condition_grade`,
      )
      .all(...deviceIds) as Array<{
      device_id: string;
      storage: string;
      condition_grade: string;
      base_price: number;
      source: string;
      updated_at: string;
    }>;

    const matrixByDevice = new Map<
      string,
      Record<string, Partial<Record<string, number>>>
    >();
    const listByDevice = new Map<string, typeof priceRows>();
    for (const p of priceRows) {
      const offerPrice = applyBeat(p.base_price);
      if (!matrixByDevice.has(p.device_id)) matrixByDevice.set(p.device_id, {});
      const m = matrixByDevice.get(p.device_id)!;
      if (!m[p.storage]) m[p.storage] = {};
      m[p.storage][p.condition_grade] = offerPrice;
      if (!listByDevice.has(p.device_id)) listByDevice.set(p.device_id, []);
      listByDevice.get(p.device_id)!.push({ ...p, base_price: offerPrice });
    }
    for (const row of rows) {
      row.price_matrix = matrixByDevice.get(row.id) || {};
      row.prices = listByDevice.get(row.id) || [];
      row.price_mode = cfg.mode;
      row.beat_percent = cfg.beatPercent;
    }
  }
  db.close();
  res.json(rows);
});

catalogRouter.post("/devices", apiKeyAuth, (req, res) => {
  const db = getDb();
  const { name, category_id, brand_id, storages, image_url } = req.body;
  const id = nanoid(12);
  db.prepare(
    "INSERT INTO devices (id, category_id, brand_id, name, storages, image_url) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, category_id, brand_id, name, JSON.stringify(storages || []), image_url || null);
  db.close();
  res.status(201).json({ id, name });
});

/**
 * SaaS bootstrap: create (or reuse) a catalog device from a product name only.
 * Builds a product image under /devices/{slug}.png and seeds starter prices.
 */
catalogRouter.post("/devices/from-name", apiKeyAuth, async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ error: "name is required" });
    const result = await ensureDeviceFromName({
      name,
      categoryId: req.body?.category_id || null,
      brandId: req.body?.brand_id || null,
      rebuildImage: Boolean(req.body?.rebuild_image),
      seedPrices: req.body?.seed_prices !== false,
    });
    res.status(result.created ? 201 : 200).json(result);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Bootstrap failed" });
  }
});

/** Public-ish ensure used by the phone picker when a new model is searched. */
catalogRouter.post("/devices/ensure", async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    if (!looksLikeProductName(name)) {
      return res.status(400).json({
        error: "Enter a full model name (e.g. iPhone 17 Pro Max) to add it.",
      });
    }
    const result = await ensureDeviceFromName({
      name,
      categoryId: req.body?.category_id || null,
      rebuildImage: Boolean(req.body?.rebuild_image),
      seedPrices: true,
    });
    res.status(result.created ? 201 : 200).json(result);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Ensure failed" });
  }
});

catalogRouter.put("/devices/:id", apiKeyAuth, (req, res) => {
  const db = getDb();
  const { name, storages, image_url, enabled } = req.body;
  db.prepare(
    "UPDATE devices SET name = COALESCE(?, name), storages = COALESCE(?, storages), image_url = COALESCE(?, image_url), enabled = COALESCE(?, enabled) WHERE id = ?"
  ).run(name, storages ? JSON.stringify(storages) : null, image_url, enabled, req.params.id);
  db.close();
  res.json({ ok: true });
});

// Condition groups
catalogRouter.get("/conditions", (_req, res) => {
  const db = getDb();
  const groups = db.prepare("SELECT * FROM condition_groups").all();
  const conditions = db.prepare("SELECT * FROM conditions ORDER BY sort_order").all();
  db.close();
  res.json({ groups, conditions });
});

catalogRouter.post("/conditions/groups", apiKeyAuth, (req, res) => {
  const db = getDb();
  const { name, category_id } = req.body;
  const id = nanoid(12);
  db.prepare("INSERT INTO condition_groups (id, name, category_id) VALUES (?, ?, ?)").run(id, name, category_id);
  db.close();
  res.status(201).json({ id, name });
});

catalogRouter.post("/conditions", apiKeyAuth, (req, res) => {
  const db = getDb();
  const { group_id, grade, label, description, sort_order } = req.body;
  const id = nanoid(12);
  db.prepare(
    "INSERT INTO conditions (id, group_id, grade, label, description, sort_order) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, group_id, grade, label, description || null, sort_order || 0);
  db.close();
  res.status(201).json({ id });
});
