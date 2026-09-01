import { Router } from "express";
import { getDb } from "../db/migrate.js";
import { cronSecretAuth } from "../middleware/cronAuth.js";
import { auditHealth, runScraperPipeline } from "../pricing-engine/orchestrator.js";
import { PricingTraining } from "../pricing-engine/training/train.js";
import { quoteWithModel, listPricingModels } from "../pricing-engine/models/registry.js";
import type { ToScrape } from "../pricing-engine/types.js";
import { STORE_TO_COMPETITOR, normalizeCondition } from "../pricing-engine/types.js";
import { syncGorecellCatalogPrices } from "../services/catalogPriceSync.js";
import { runWeeklyPriceRefresh } from "../jobs/weeklyScrape.js";
import fs from "node:fs";
import path from "node:path";

export const cronRouter = Router();
cronRouter.use(cronSecretAuth);

function loadTargetsFromConfig(): ToScrape[] {
  const cfgPath = path.resolve(import.meta.dirname, "../../config/pricing-engine.json");
  if (!fs.existsSync(cfgPath)) return [];
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8")) as {
    targets?: ToScrape[];
  };
  return cfg.targets || [];
}

function loadKnownProductIds(): Set<string> {
  const db = getDb();
  const rows = db.prepare(`SELECT id FROM devices WHERE enabled = 1`).all() as Array<{ id: string }>;
  db.close();
  return new Set(rows.map((r) => r.id));
}

function loadProviders(): string[] {
  const cfgPath = path.resolve(import.meta.dirname, "../../config/pricing-engine.json");
  if (!fs.existsSync(cfgPath)) return ["univercell", "bell", "telus"];
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8")) as {
    providers?: string[];
    dualMode?: boolean;
  };
  return cfg.providers || ["univercell", "bell", "telus"];
}

/** POST /api/cron/scrape — competitor scrape pipeline (timeout ~300s) */
cronRouter.post("/scrape", async (req, res) => {
  req.setTimeout(300_000);
  res.setTimeout(300_000);
  try {
    const cfgPath = path.resolve(import.meta.dirname, "../../config/pricing-engine.json");
    const fileCfg = fs.existsSync(cfgPath)
      ? (JSON.parse(fs.readFileSync(cfgPath, "utf-8")) as { dualMode?: boolean; preferredEngine?: string })
      : {};
    const devices = (req.body?.devices as ToScrape[] | undefined) || loadTargetsFromConfig();
    const providers = (req.body?.providers as string[] | undefined) || loadProviders();
    const known = loadKnownProductIds();
    const result = await runScraperPipeline(devices, {
      providers,
      dualMode: req.body?.dualMode ?? fileCfg.dualMode ?? false,
      preferredEngine: req.body?.preferredEngine || fileCfg.preferredEngine || process.env.TG_SCRAPE_PREFERRED_ENGINE,
      // Only filter when catalog has devices — empty set would discard every row.
      knownProductIds: known.size > 0 ? known : undefined,
      timeoutMs: 300_000,
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/**
 * POST /api/cron/sync-catalog — scrape every GoRecell-mapped device for exact
 * per-storage prices and refresh the catalog (long-running, ~10–20 min).
 */
cronRouter.post("/sync-catalog", async (req, res) => {
  req.setTimeout(1_800_000);
  res.setTimeout(1_800_000);
  try {
    const result = await syncGorecellCatalogPrices({
      limit: typeof req.body?.limit === "number" ? req.body.limit : undefined,
      deviceFilter: typeof req.body?.filter === "string" ? req.body.filter : undefined,
      delayMs: typeof req.body?.delayMs === "number" ? req.body.delayMs : 100,
      applyBeat: req.body?.applyBeat !== false,
      beatPercent: typeof req.body?.beatPercent === "number" ? req.body.beatPercent : 2,
      setFrontend: req.body?.setFrontend !== false,
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** POST /api/cron/weekly — full weekly refresh (catalog + competitor targets) */
cronRouter.post("/weekly", async (req, res) => {
  req.setTimeout(1_800_000);
  res.setTimeout(1_800_000);
  try {
    const result = await runWeeklyPriceRefresh();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** POST /api/cron/train — self-learning baseline training */
cronRouter.post("/train", (_req, res) => {
  try {
    const metrics = PricingTraining.train();
    res.json(metrics);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** GET /api/cron/health — per-source freshness + recent dual diffs */
cronRouter.get("/health", (_req, res) => {
  const health = auditHealth();
  const db = getDb();
  const lastScrape = db
    .prepare(`SELECT * FROM scrape_runs ORDER BY id DESC LIMIT 1`)
    .get();
  const lastTrain = db
    .prepare(`SELECT * FROM pricing_train_runs ORDER BY id DESC LIMIT 1`)
    .get();
  const baselineCount = (
    db.prepare(`SELECT COUNT(*) as c FROM price_baselines`).get() as { c: number }
  ).c;
  db.close();
  res.json({
    health,
    baselineCount,
    lastScrape,
    lastTrain,
    models: listPricingModels(),
  });
});

export const pricingEngineRouter = Router();

/** Quote using pluggable model registry */
pricingEngineRouter.post("/quote", (req, res) => {
  const {
    device_id,
    product_id,
    storage,
    variant,
    condition_grade,
    condition,
    model,
    msrp,
    competitor_beat_percent,
  } = req.body || {};

  const productId = String(product_id || device_id || "");
  const variantKey = String(variant || storage || "default");
  const condRaw = String(condition || condition_grade || "good");
  const cond =
    normalizeCondition(condRaw) ||
    STORE_TO_COMPETITOR[condRaw as keyof typeof STORE_TO_COMPETITOR] ||
    "good";

  if (!productId) {
    return res.status(400).json({ error: "product_id/device_id required" });
  }

  const result = quoteWithModel({
    productId,
    variant: variantKey,
    condition: cond,
    msrpOrCost: typeof msrp === "number" ? msrp : undefined,
    model,
    competitorBeatPercent: competitor_beat_percent,
  });
  res.json(result);
});

pricingEngineRouter.get("/baselines", (req, res) => {
  const db = getDb();
  const q = String(req.query.q || "");
  const rows = q
    ? db
        .prepare(
          `SELECT * FROM price_baselines WHERE product_id LIKE ? OR variant_key LIKE ? ORDER BY updated_at DESC LIMIT 200`,
        )
        .all(`%${q}%`, `%${q}%`)
    : db.prepare(`SELECT * FROM price_baselines ORDER BY updated_at DESC LIMIT 200`).all();
  db.close();
  res.json(rows);
});

pricingEngineRouter.put("/overrides", (req, res) => {
  const { product_id, variant, condition, price, note, updated_by } = req.body || {};
  const cond = normalizeCondition(String(condition || ""));
  if (!product_id || !variant || !cond || !(price > 0)) {
    return res.status(400).json({ error: "product_id, variant, condition, price required" });
  }
  const key = `${product_id}|${variant}|${cond}`;
  const db = getDb();
  db.prepare(
    `INSERT INTO price_overrides (variant_key, product_id, variant, condition, price, note, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)
     ON CONFLICT(variant_key) DO UPDATE SET price = excluded.price, note = excluded.note,
       updated_at = datetime('now'), updated_by = excluded.updated_by`,
  ).run(key, product_id, variant, cond, price, note || null, updated_by || null);
  db.close();
  res.json({ ok: true, variant_key: key });
});
