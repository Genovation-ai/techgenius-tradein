/**
 * Lightweight in-process scheduler for weekly competitor + catalog scrapes.
 * No external cron dependency — uses setTimeout cascading from env TG_SCRAPE_CRON
 * or a default of Sunday 03:00 local time.
 *
 * Enable with TG_WEEKLY_SCRAPE=1 (or "true"). Disable with TG_WEEKLY_SCRAPE=0.
 */
import { syncGorecellCatalogPrices } from "../services/catalogPriceSync.js";
import { runScraperPipeline } from "../pricing-engine/orchestrator.js";
import type { ToScrape } from "../pricing-engine/types.js";
import fs from "node:fs";
import path from "node:path";

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

/** Next occurrence of weekday 0=Sun … 6=Sat at hour:minute local. */
export function msUntilWeeklySlot(weekday = 0, hour = 3, minute = 0): number {
  const now = new Date();
  const next = new Date(now);
  next.setSeconds(0, 0);
  next.setHours(hour, minute, 0, 0);
  const dayDiff = (weekday - now.getDay() + 7) % 7;
  next.setDate(now.getDate() + dayDiff);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 7);
  }
  return next.getTime() - now.getTime();
}

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;

export async function runWeeklyPriceRefresh(): Promise<{
  catalog: Awaited<ReturnType<typeof syncGorecellCatalogPrices>>;
  competitors?: unknown;
  repairMarket?: unknown;
}> {
  if (running) {
    throw new Error("Weekly price refresh already running");
  }
  running = true;
  console.log("[weekly-scrape] starting full catalog GoRecell sync…");
  try {
    const catalog = await syncGorecellCatalogPrices({
      delayMs: 100,
      applyBeat: true,
      beatPercent: Number(process.env.TG_BEAT_PERCENT || 2),
      setFrontend: true,
      onProgress: (p) => {
        if (p.done % 25 === 0 || p.done === p.total) {
          console.log(`[weekly-scrape] catalog ${p.done}/${p.total} (${p.deviceId} ${p.ok ? "ok" : "fail"})`);
        }
      },
    });
    console.log(
      `[weekly-scrape] catalog done: ${catalog.devicesOk}/${catalog.devicesAttempted} devices, ${catalog.scrapedRows} rows`,
    );

    let competitors: unknown;
    const targets = loadTargets();
    if (targets.length > 0) {
      console.log(`[weekly-scrape] competitor scrape for ${targets.length} targets…`);
      competitors = await runScraperPipeline(targets, {
        providers: loadProviders().filter((p) => p !== "gorecell"),
        dualMode: false,
        timeoutMs: 300_000,
      });
    }
    // Repair part prices refresh on the same weekly cadence, after the
    // trade-in work, and a failure here must not mark the whole run failed.
    let repairMarket: unknown;
    try {
      const { syncRepairMarketPrices } = await import("../services/repairMarket.js");
      const r = await syncRepairMarketPrices({ delayMs: 350 });
      repairMarket = { devices: r.devices, found: r.found, fx: r.fx };
      console.log(`[weekly-scrape] repair parts: ${r.found} prices across ${r.devices} devices`);
    } catch (e) {
      console.warn("[weekly-scrape] repair part refresh failed:", e);
    }
    return { catalog, competitors, repairMarket };
  } finally {
    running = false;
  }
}

function scheduleNext(): void {
  const ms = msUntilWeeklySlot(0, 3, 0);
  const hours = (ms / 3600_000).toFixed(1);
  console.log(`[weekly-scrape] next run in ${hours}h (Sunday 03:00 local)`);
  timer = setTimeout(() => {
    void runWeeklyPriceRefresh()
      .catch((e) => console.error("[weekly-scrape] failed:", e))
      .finally(() => scheduleNext());
  }, ms);
  // Prevent keeping process alive solely for the timer in some runtimes — we want it alive with the server.
  if (timer && typeof timer === "object" && "unref" in timer) {
    // keep referenced so weekly jobs fire while server runs
  }
}

export function startWeeklyScrapeScheduler(): void {
  const flag = (process.env.TG_WEEKLY_SCRAPE ?? "1").toLowerCase();
  if (flag === "0" || flag === "false" || flag === "off") {
    console.log("[weekly-scrape] disabled (TG_WEEKLY_SCRAPE=0)");
    return;
  }
  if (timer) return;
  scheduleNext();
}

export function stopWeeklyScrapeScheduler(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}
