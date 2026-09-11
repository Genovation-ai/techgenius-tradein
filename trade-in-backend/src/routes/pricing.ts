import { Router } from "express";
import { getDb } from "../db/migrate.js";
import {
  applyCompetitorSourceToPrices,
  COMPETITOR_SOURCES,
  competitorMatrix,
  getFrontendPricingConfig,
  listLatestCompetitorPrices,
  resolveFrontendBasePrice,
  setFrontendPricingConfig,
  type FrontendPriceMode,
  type FrontendPriceSource,
} from "../services/competitorPricing.js";
import { computeServerQuote } from "../services/quoteEngine.js";

export const pricingRouter = Router();

// Get prices for a device
pricingRouter.get("/device/:deviceId", (req, res) => {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM prices WHERE device_id = ? ORDER BY storage, condition_grade")
    .all(req.params.deviceId);
  db.close();
  res.json(rows);
});

// Set/update a price point
pricingRouter.put("/", (req, res) => {
  const db = getDb();
  const { device_id, storage, condition_grade, base_price, source } = req.body;
  db.prepare(
    `INSERT INTO prices (device_id, storage, condition_grade, base_price, source, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(device_id, storage, condition_grade) DO UPDATE SET
       base_price = excluded.base_price, source = excluded.source, updated_at = datetime('now')`,
  ).run(device_id, storage, condition_grade, base_price, source || "manual");
  db.close();
  res.json({ ok: true });
});

// Bulk set prices (for scraper output)
pricingRouter.post("/bulk", (req, res) => {
  const db = getDb();
  const { prices } = req.body as {
    prices: Array<{
      device_id: string;
      storage: string;
      condition_grade: string;
      base_price: number;
      source?: string;
    }>;
  };
  const stmt = db.prepare(
    `INSERT INTO prices (device_id, storage, condition_grade, base_price, source, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(device_id, storage, condition_grade) DO UPDATE SET
       base_price = excluded.base_price, source = excluded.source, updated_at = datetime('now')`,
  );
  const tx = db.transaction(() => {
    for (const p of prices) {
      stmt.run(p.device_id, p.storage, p.condition_grade, p.base_price, p.source || "scraper");
    }
  });
  tx();
  db.close();
  res.json({ ok: true, count: prices.length });
});

// Get adjustments
pricingRouter.get("/adjustments", (_req, res) => {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM price_adjustments WHERE enabled = 1").all();
  db.close();
  res.json(rows);
});

// Create/update adjustment
pricingRouter.post("/adjustments", (req, res) => {
  const db = getDb();
  const { scope, scope_id, adjust_percent, adjust_amount, condition_grade } = req.body;
  db.prepare(
    `INSERT INTO price_adjustments (scope, scope_id, adjust_percent, adjust_amount, condition_grade)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    scope || "global",
    scope_id || null,
    adjust_percent || 0,
    adjust_amount || 0,
    condition_grade || null,
  );
  db.close();
  res.status(201).json({ ok: true });
});

pricingRouter.delete("/adjustments/:id", (req, res) => {
  const db = getDb();
  db.prepare("DELETE FROM price_adjustments WHERE id = ?").run(req.params.id);
  db.close();
  res.json({ ok: true });
});

// Price sources
pricingRouter.get("/sources", (_req, res) => {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM price_sources ORDER BY label").all();
  db.close();
  res.json(rows);
});

/**
 * Whether the prices behind today's quotes are actually current.
 *
 * The product's promise is that nothing quietly goes stale — that if a source
 * stops answering, the shop is told rather than served last month's numbers as
 * though they were this week's. Nothing was reading last_synced_at, so an
 * enabled source that had never once succeeded looked exactly like a healthy
 * one. This is what makes that promise checkable.
 *
 * A source is late when it has not synced within twice its own interval: one
 * missed run is a blip, two is a pattern worth a shop owner's attention.
 */
pricingRouter.get("/freshness", (_req, res) => {
  const db = getDb();
  const rows = db
    .prepare("SELECT id, label, enabled, last_synced_at, sync_interval_hours FROM price_sources")
    .all() as Array<{
    id: string;
    label: string;
    enabled: number;
    last_synced_at: string | null;
    sync_interval_hours: number | null;
  }>;
  const covered = db
    .prepare("SELECT COUNT(DISTINCT product_id) AS n FROM competitor_prices")
    .get() as { n: number };
  const catalogue = db.prepare("SELECT COUNT(*) AS n FROM devices WHERE enabled = 1").get() as {
    n: number;
  };
  db.close();

  const now = Date.now();
  const sources = rows
    .filter((r) => r.enabled)
    .map((r) => {
      const every = (r.sync_interval_hours || 168) * 3600 * 1000;
      const last = r.last_synced_at ? Date.parse(r.last_synced_at.replace(" ", "T") + "Z") : null;
      const ageMs = last ? now - last : null;
      return {
        id: r.id,
        label: r.label,
        last_synced_at: r.last_synced_at,
        age_hours: ageMs == null ? null : Math.round(ageMs / 3600000),
        // Never synced counts as late: an enabled source that has never
        // answered is the exact case this is here to surface.
        state: ageMs == null ? "never" : ageMs > every * 2 ? "late" : "ok",
      };
    });

  res.json({
    sources,
    stale: sources.filter((s) => s.state !== "ok").map((s) => s.label),
    coverage: { devices_with_live_prices: covered.n, devices_in_catalogue: catalogue.n },
  });
});

/** Competitor scrape details for admin Pricing page */
pricingRouter.get("/competitors", (req, res) => {
  const productId = req.query.product_id ? String(req.query.product_id) : undefined;
  const q = req.query.q ? String(req.query.q) : undefined;
  const rows = listLatestCompetitorPrices({ productId, q, limit: 800 });
  const cfg = getFrontendPricingConfig();
  res.json({
    sources: COMPETITOR_SOURCES,
    frontend: cfg,
    rows,
  });
});

/** Side-by-side matrix for one device + storage */
pricingRouter.get("/competitors/matrix", (req, res) => {
  const productId = String(req.query.product_id || "");
  const variant = String(req.query.variant || req.query.storage || "128GB");
  if (!productId) return res.status(400).json({ error: "product_id required" });
  const matrix = competitorMatrix(productId, variant);
  const cfg = getFrontendPricingConfig();
  const preview = resolveFrontendBasePrice({
    productId,
    variant,
    conditionGrade: String(req.query.condition || "flawless"),
  });
  res.json({ product_id: productId, variant, matrix, frontend: cfg, preview });
});

/** Choose which competitor price the Framer/frontend widget reflects */
pricingRouter.get("/frontend-source", (_req, res) => {
  res.json(getFrontendPricingConfig());
});

pricingRouter.put("/frontend-source", (req, res) => {
  const { source, mode, beat_percent } = req.body || {};
  const allowed: FrontendPriceSource[] = [
    "manual",
    "univercell",
    "bell",
    "telus",
    "gorecell",
    "best",
  ];
  if (source && !allowed.includes(source)) {
    return res.status(400).json({ error: `source must be one of: ${allowed.join(", ")}` });
  }
  if (mode && mode !== "match" && mode !== "beat") {
    return res.status(400).json({ error: "mode must be match or beat" });
  }
  setFrontendPricingConfig({
    source: source as FrontendPriceSource | undefined,
    mode: mode as FrontendPriceMode | undefined,
    beatPercent: beat_percent != null ? Number(beat_percent) : undefined,
  });
  res.json({ ok: true, ...getFrontendPricingConfig() });
});

/** Copy a competitor's latest scrapes into the prices table (optional hard apply) */
pricingRouter.post("/apply-source", (req, res) => {
  const competitor = String(req.body?.competitor || "");
  if (!COMPETITOR_SOURCES.some((s) => s.id === competitor)) {
    return res.status(400).json({ error: "Unknown competitor" });
  }
  const result = applyCompetitorSourceToPrices(competitor);
  // Also set as the live frontend source
  setFrontendPricingConfig({ source: competitor as FrontendPriceSource });
  res.json({ ok: true, ...result, frontend: getFrontendPricingConfig() });
});

// Calculate offer price (used by widget API / Framer) — shared with widget submit
pricingRouter.post("/quote", (req, res) => {
  const { device_id, storage, memory, condition_grade, carrier, battery_health, promo_code, payout_method } =
    req.body;

  if (!device_id || !storage || !condition_grade) {
    return res.status(400).json({ error: "device_id, storage, and condition_grade required" });
  }

  const result = computeServerQuote({
    deviceId: String(device_id),
    storage: String(storage),
    memory: memory ? String(memory) : null,
    conditionGrade: String(condition_grade),
    carrier,
    batteryHealth: battery_health,
    promoCode: promo_code,
    payoutMethod: payout_method,
  });

  if (!result) {
    return res.status(404).json({ error: "No price found for this configuration" });
  }

  res.json({
    quoted_price: result.quotedPrice,
    base_price: result.basePrice,
    price_source: result.priceSource,
    price_mode: result.priceMode,
    competitor_price: result.competitorPrice,
    scaled_from_excellent: result.scaledFromExcellent,
    scraped_at: result.scrapedAt,
    from_manual_table: result.fromManualTable,
    promo_applied: result.promoApplied,
    store_credit_boost: result.storeCreditBoost,
    multi_spec: result.multiSpec,
    limiting_spec: result.limitingSpec,
  });
});
