import { getDb } from "../db/migrate.js";
import type { ProviderAdapter, ScrapedPrice, ScraperResult, ToScrape } from "./types.js";
import { sanitizeScrapedPrice } from "./validate.js";
import { compareEngineResults, pickPreferredRows, type DualDiffReport } from "./dualMode.js";
import { createCheerioAdapter } from "./adapters/cheerioAdapter.js";
import { createPlaywrightAdapter } from "./adapters/playwrightAdapter.js";
import { createScraplingAdapter } from "./scrapling/bridge.js";
import { createBellAdapter } from "./adapters/bellAdapter.js";
import { createTelusAdapter } from "./adapters/telusAdapter.js";
import { createUnivercellAdapter } from "./adapters/univercellAdapter.js";
import { createGorecellStepFlowAdapter } from "./adapters/gorecellStepFlowAdapter.js";

export interface PipelineConfig {
  providers: string[];
  dualMode?: boolean;
  preferredEngine?: string;
  knownProductIds?: Set<string>;
  timeoutMs?: number;
}

export interface PipelineResult {
  runId: number;
  rowsPersisted: number;
  rowsDiscarded: number;
  providerResults: ScraperResult[];
  dualDiff: DualDiffReport | null;
  health: HealthAudit;
  errors: string[];
  ok: boolean;
}

export interface HealthAudit {
  perSource: Array<{
    competitor: string;
    rows: number;
    newest: string | null;
    stale: boolean;
  }>;
  emptySources: string[];
  staleSources: string[];
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = 2,
  backoffMs = 800,
): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, backoffMs * (i + 1)));
      }
    }
  }
  throw last;
}

export function buildAdapters(providerNames: string[]): ProviderAdapter[] {
  const map: Record<string, () => ProviderAdapter> = {
    gorecell: () => createGorecellStepFlowAdapter({ name: "gorecell" }),
    "gorecell-scrapling": () => createScraplingAdapter({ name: "gorecell" }),
    "gorecell-cheerio": () => createCheerioAdapter({ name: "gorecell" }),
    "gorecell-playwright": () => createPlaywrightAdapter({ name: "gorecell" }),
    "gorecell-stepflow": () => createGorecellStepFlowAdapter({ name: "gorecell" }),
    bell: () => createBellAdapter({ name: "bell" }),
    telus: () => createTelusAdapter({ name: "telus" }),
    univercell: () => createUnivercellAdapter({ name: "univercell" }),
    scrapling: () => createScraplingAdapter({ name: "scrapling" }),
    cheerio: () => createCheerioAdapter({ name: "cheerio" }),
    playwright: () => createPlaywrightAdapter({ name: "playwright" }),
  };
  return providerNames.map((n) => {
    const factory = map[n];
    if (!factory) throw new Error(`Unknown provider adapter: ${n}`);
    return factory();
  });
}

/** Drop phantom/unknown rows (no product_id match, nonsense prices). */
export function cleanupRows(
  rows: ScrapedPrice[],
  knownProductIds?: Set<string>,
): { kept: ScrapedPrice[]; discarded: number } {
  let discarded = 0;
  const kept: ScrapedPrice[] = [];
  // Empty set must NOT discard everything — treat as "no filter".
  const filterIds = knownProductIds && knownProductIds.size > 0 ? knownProductIds : null;
  for (const raw of rows) {
    const row = sanitizeScrapedPrice(raw);
    if (!row) {
      discarded += 1;
      continue;
    }
    const price = row.trade_in_price ?? row.sell_price ?? 0;
    if (price < 5 || price > 20000) {
      discarded += 1;
      continue;
    }
    if (filterIds && row.product_id && !filterIds.has(row.product_id)) {
      discarded += 1;
      continue;
    }
    kept.push(row);
  }
  return { kept, discarded };
}

export function persistScrapedRows(rows: ScrapedPrice[], engineHint?: string): number {
  const db = getDb();
  // One row per competitor + device + storage + condition, updated in place.
  // A plain insert appended a fresh row on every run, so re-scraping — weekly,
  // or each press of "Check competitor prices" — grew the table by a full copy
  // of itself while every read only ever wanted the newest row. The conflict
  // target matches the unique index in patches.ts, COALESCE included, because
  // product_id is nullable and SQLite counts NULLs as distinct.
  const stmt = db.prepare(
    `INSERT INTO scraped_prices
      (competitor_name, make, model, product_id, variant, condition,
       trade_in_price, sell_price, currency, source_url, raw_json, scraped_at, engine)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(competitor_name, COALESCE(product_id, ''), variant, condition)
     DO UPDATE SET
       make = excluded.make,
       model = excluded.model,
       trade_in_price = excluded.trade_in_price,
       sell_price = excluded.sell_price,
       currency = excluded.currency,
       source_url = excluded.source_url,
       raw_json = excluded.raw_json,
       scraped_at = excluded.scraped_at,
       engine = excluded.engine`,
  );
  const tx = db.transaction(() => {
    for (const r of rows) {
      stmt.run(
        r.competitor_name,
        r.make,
        r.model,
        r.product_id,
        r.variant,
        r.condition,
        r.trade_in_price,
        r.sell_price,
        r.currency,
        r.raw.source,
        JSON.stringify(r.raw),
        r.scraped_at,
        r.raw.engine || engineHint || "unknown",
      );
    }
  });
  tx();
  // touch price_sources last_synced
  const competitors = [...new Set(rows.map((r) => r.competitor_name))];
  for (const c of competitors) {
    db.prepare(
      `INSERT INTO price_sources (id, name, label, last_synced_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET last_synced_at = datetime('now')`,
    ).run(c, c, c);
  }
  db.close();
  return rows.length;
}

export function auditHealth(staleHours = 168): HealthAudit {
  const db = getDb();
  const sources = db.prepare("SELECT id, name, last_synced_at FROM price_sources").all() as Array<{
    id: string;
    name: string;
    last_synced_at: string | null;
  }>;
  const perSource: HealthAudit["perSource"] = [];
  const emptySources: string[] = [];
  const staleSources: string[] = [];
  const cutoff = Date.now() - staleHours * 3600_000;

  for (const s of sources) {
    const countRow = db
      .prepare("SELECT COUNT(*) as c, MAX(scraped_at) as newest FROM scraped_prices WHERE competitor_name = ?")
      .get(s.id) as { c: number; newest: string | null };
    const newest = countRow.newest || s.last_synced_at;
    const stale = !newest || new Date(newest).getTime() < cutoff;
    const empty = countRow.c === 0;
    perSource.push({
      competitor: s.id,
      rows: countRow.c,
      newest,
      stale,
    });
    if (empty) emptySources.push(s.id);
    if (stale) staleSources.push(s.id);
  }
  db.close();
  return { perSource, emptySources, staleSources };
}

export async function runScraperPipeline(
  devices: ToScrape[],
  cfg: PipelineConfig,
): Promise<PipelineResult> {
  const timeoutMs = cfg.timeoutMs ?? 300_000;
  const errors: string[] = [];
  const providerResults: ScraperResult[] = [];
  const startedAt = new Date().toISOString();

  const db = getDb();
  const runInsert = db
    .prepare(
      `INSERT INTO scrape_runs (started_at, providers_json, ok) VALUES (?, ?, 0)`,
    )
    .run(startedAt, JSON.stringify(cfg.providers));
  const runId = Number(runInsert.lastInsertRowid);
  db.close();

  const adapters = buildAdapters(cfg.providers);
  // Default OFF — dual-mode must never replace the full multi-provider merge.
  const dualMode =
    cfg.dualMode ??
    String(process.env.TG_SCRAPE_DUAL_MODE || "0") === "1";

  // Run providers with isolation — one failure must not kill the run
  for (const adapter of adapters) {
    try {
      const result = await withRetry(
        async () => {
          const r = await withTimeout(
            adapter.scrape(devices, { timeoutMs: Math.min(120_000, timeoutMs) }),
            Math.min(180_000, timeoutMs),
            adapter.name,
          );
          // Retry when provider returned only errors (adapters rarely throw).
          if (r.rows.length === 0 && r.errors.length > 0 && devices.length > 0) {
            throw new Error(`${adapter.name} returned 0 rows: ${r.errors[0]}`);
          }
          return r;
        },
        2,
        1000,
      );
      providerResults.push(result);
      errors.push(...result.errors);
    } catch (e) {
      errors.push(`${adapter.name} failed: ${e instanceof Error ? e.message : String(e)}`);
      providerResults.push({
        provider: adapter.name,
        engine: adapter.engine,
        rows: [],
        errors: [String(e)],
        durationMs: 0,
        targeted: devices.length,
        discovered: 0,
      });
    }
  }

  let dualDiff: DualDiffReport | null = null;
  let merged: ScrapedPrice[] = providerResults.flatMap((r) => r.rows);

  if (dualMode && providerResults.length >= 2) {
    // Prefer scrapling vs first TS engine if present — but MERGE into other providers,
    // never replace the full set (that would drop Bell/TELUS/UniverCell).
    const scrapling = providerResults.find((r) => r.engine === "scrapling");
    const ts = providerResults.find((r) => r.engine === "cheerio" || r.engine === "playwright");
    if (scrapling && ts) {
      dualDiff = compareEngineResults(scrapling, ts);
      if (dualDiff.alert) {
        errors.push(`DUAL_MODE_ALERT: ${dualDiff.alertReasons.join("; ")}`);
        console.warn("[pricing-engine] dual-mode alert", dualDiff);
      }
      const preferred = pickPreferredRows(scrapling, ts, cfg.preferredEngine);
      const dualProviders = new Set([scrapling.provider, ts.provider]);
      const others = providerResults
        .filter((r) => !dualProviders.has(r.provider))
        .flatMap((r) => r.rows);
      merged = [...preferred, ...others];
    }
  }

  const { kept, discarded } = cleanupRows(merged, cfg.knownProductIds);
  const persisted = persistScrapedRows(kept);
  const health = auditHealth();

  const ok = persisted > 0 || errors.length === 0;
  const db2 = getDb();
  db2.prepare(
    `UPDATE scrape_runs SET finished_at = datetime('now'), rows_persisted = ?, rows_discarded = ?,
      dual_diff_json = ?, health_json = ?, errors_json = ?, ok = ? WHERE id = ?`,
  ).run(
    persisted,
    discarded,
    dualDiff ? JSON.stringify(dualDiff) : null,
    JSON.stringify(health),
    JSON.stringify(errors),
    ok ? 1 : 0,
    runId,
  );
  db2.close();

  return {
    runId,
    rowsPersisted: persisted,
    rowsDiscarded: discarded,
    providerResults,
    dualDiff,
    health,
    errors,
    ok,
  };
}
