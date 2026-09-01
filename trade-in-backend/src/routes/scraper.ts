import { Router } from "express";
import { runScraperPipeline, buildAdapters } from "../pricing-engine/orchestrator.js";
import { ensureCompetitorSourcesSeeded } from "../services/competitorPricing.js";
import { syncGorecellCatalogPrices } from "../services/catalogPriceSync.js";
import type { ToScrape } from "../pricing-engine/types.js";
import fs from "node:fs";
import path from "node:path";

export const scraperRouter = Router();

function loadTargets(): ToScrape[] {
  const cfgPath = path.resolve(import.meta.dirname, "../../config/pricing-engine.json");
  if (!fs.existsSync(cfgPath)) return [];
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8")) as { targets?: ToScrape[] };
  return cfg.targets || [];
}

function loadProviders(): string[] {
  const cfgPath = path.resolve(import.meta.dirname, "../../config/pricing-engine.json");
  if (!fs.existsSync(cfgPath)) return ["univercell", "bell", "telus", "gorecell"];
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8")) as { providers?: string[] };
  return cfg.providers || ["univercell", "bell", "telus", "gorecell"];
}

/**
 * Legacy CSS-selector scraper, superseded.
 *
 * config/scrape.json targets GoRecell product pages with CSS selectors, but
 * GoRecell serves its prices as a `query_data` JSON blob — which is exactly why
 * gorecellStepFlowAdapter exists. The selectors have never matched, so this
 * endpoint reported success while importing zero rows across every recorded
 * run, and seeded the phantom `local-market` source that shows up empty in
 * every report.
 *
 * Answering with a 410 rather than deleting the route: a cron or script may
 * still be pointed here, and a clear redirect is more useful than a 404 or,
 * worse, a silent success that quietly stops refreshing prices.
 */
scraperRouter.post("/run", (_req, res) => {
  res.status(410).json({
    error: "Superseded scraper",
    detail:
      "config/scrape.json used CSS selectors that no longer match GoRecell, so this imported 0 rows. " +
      "Use POST /api/scraper/run-live for competitor scrapes, or POST /api/scraper/sync-catalog for the full GoRecell catalog.",
    use_instead: ["/api/scraper/run-live", "/api/scraper/sync-catalog"],
  });
});

/**
 * Live competitor scrape — UniverCell / Bell / TELUS / GoRecell.
 * Persists into scraped_prices for the Pricing admin + frontend source picker.
 */
scraperRouter.post("/run-live", async (req, res) => {
  req.setTimeout(300_000);
  res.setTimeout(300_000);
  try {
    ensureCompetitorSourcesSeeded();
    const devices = (req.body?.devices as ToScrape[] | undefined) || loadTargets();
    const providers = (req.body?.providers as string[] | undefined) || loadProviders();
    // Don't filter by known product ids — competitor product_ids may not match catalog yet
    const result = await runScraperPipeline(devices, {
      providers,
      dualMode: false,
      timeoutMs: 300_000,
    });
    res.json({
      message: `Live scrape finished. ${result.rowsPersisted} rows persisted.`,
      ...result,
      providers,
      deviceCount: devices.length,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/**
 * Full-catalog GoRecell sync — every mapped device, every storage tier.
 * Prefer this over run-live when refreshing exact catalog pricing.
 */
scraperRouter.post("/sync-catalog", async (req, res) => {
  req.setTimeout(1_800_000);
  res.setTimeout(1_800_000);
  try {
    ensureCompetitorSourcesSeeded();
    const result = await syncGorecellCatalogPrices({
      limit: typeof req.body?.limit === "number" ? req.body.limit : undefined,
      deviceFilter: typeof req.body?.filter === "string" ? req.body.filter : undefined,
      delayMs: typeof req.body?.delayMs === "number" ? req.body.delayMs : 100,
      applyBeat: req.body?.applyBeat !== false,
      beatPercent: typeof req.body?.beatPercent === "number" ? req.body.beatPercent : 2,
      setFrontend: req.body?.setFrontend !== false,
    });
    res.json({
      message: `Catalog sync finished. ${result.devicesOk}/${result.devicesAttempted} devices, ${result.scrapedRows} scraped rows.`,
      ...result,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

scraperRouter.get("/status", (_req, res) => {
  let adapters: string[] = [];
  try {
    adapters = buildAdapters(loadProviders()).map((a) => a.name);
  } catch {
    adapters = loadProviders();
  }
  res.json({
    status: "ready",
    config: "config/pricing-engine.json",
    providers: adapters,
    weeklyScrape: (process.env.TG_WEEKLY_SCRAPE ?? "1") !== "0",
    targets: loadTargets().map((t) => ({
      productId: t.productId,
      model: t.model,
      variant: t.variant,
    })),
  });
});
