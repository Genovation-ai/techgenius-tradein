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
import { persistScrapedRows } from "../pricing-engine/orchestrator.js";
import { STORE_TO_COMPETITOR, type CompetitorCondition, type StoreCondition } from "../pricing-engine/types.js";
import { logActivityWith } from "../services/activityLog.js";

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

const STORE_GRADES = new Set(["flawless", "good", "average", "fair", "defective"]);
const MAX_PRICE = 20000;

/** One price row from a request body, or the reason it is unusable. */
function parsePriceRow(p: unknown): { ok: true; row: { device_id: string; storage: string; condition_grade: string; base_price: number; source?: string } } | { ok: false; error: string } {
  const r = (p || {}) as Record<string, unknown>;
  const device_id = typeof r.device_id === "string" ? r.device_id.trim() : "";
  const storage = typeof r.storage === "string" ? r.storage.trim() : "";
  const condition_grade = typeof r.condition_grade === "string" ? r.condition_grade.trim() : "";
  const base_price = Number(r.base_price);
  if (!device_id || !storage) return { ok: false, error: "device_id and storage are required" };
  if (!STORE_GRADES.has(condition_grade)) {
    return { ok: false, error: `condition_grade must be one of ${[...STORE_GRADES].join(", ")}` };
  }
  // A negative or text price was stored as-is, and the quote engine then paid
  // out that number (or NaN) to customers.
  if (r.base_price === "" || r.base_price == null || !Number.isFinite(base_price) || base_price < 0 || base_price > MAX_PRICE) {
    return { ok: false, error: `base_price must be a number between 0 and ${MAX_PRICE}` };
  }
  return {
    ok: true,
    row: { device_id, storage, condition_grade, base_price, source: typeof r.source === "string" ? r.source.slice(0, 40) : undefined },
  };
}

// Set/update a price point
pricingRouter.put("/", (req, res) => {
  const parsed = parsePriceRow(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const db = getDb();
  const { device_id, storage, condition_grade, base_price, source } = parsed.row;
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
  const input = (req.body || {}).prices;
  if (!Array.isArray(input) || input.length === 0) {
    return res.status(400).json({ error: "prices must be a non-empty array" });
  }
  if (input.length > 10000) return res.status(400).json({ error: "At most 10000 prices per request" });
  const prices: Array<{ device_id: string; storage: string; condition_grade: string; base_price: number; source?: string }> = [];
  for (let i = 0; i < input.length; i++) {
    const parsed = parsePriceRow(input[i]);
    if (!parsed.ok) return res.status(400).json({ error: `prices[${i}]: ${parsed.error}` });
    prices.push(parsed.row);
  }
  const db = getDb();
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
  const { scope, scope_id, condition_grade } = req.body || {};
  // Every enabled row multiplies every quote. A text value here turned the
  // whole site's quotes into null, so only finite, bounded numbers get in.
  const toNum = (v: unknown) => (v == null || v === "" ? 0 : Number(v));
  const adjust_percent = toNum(req.body?.adjust_percent);
  const adjust_amount = toNum(req.body?.adjust_amount);
  if (!Number.isFinite(adjust_percent) || adjust_percent < -90 || adjust_percent > 100) {
    return res.status(400).json({ error: "adjust_percent must be a number between -90 and 100" });
  }
  if (!Number.isFinite(adjust_amount) || Math.abs(adjust_amount) > 1000) {
    return res.status(400).json({ error: "adjust_amount must be a number between -1000 and 1000" });
  }
  if (condition_grade != null && condition_grade !== "" && !STORE_GRADES.has(String(condition_grade))) {
    return res.status(400).json({ error: `condition_grade must be one of ${[...STORE_GRADES].join(", ")}` });
  }
  const db = getDb();
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
  // The scrape table is scraped_prices; an earlier version of this query named
  // a table that does not exist, which is the sort of thing that only shows up
  // when the endpoint is actually called.
  const covered = db
    .prepare("SELECT COUNT(DISTINCT product_id) AS n FROM scraped_prices WHERE product_id IS NOT NULL")
    .get() as { n: number };
  const catalogue = db.prepare("SELECT COUNT(*) AS n FROM devices WHERE enabled = 1").get() as {
    n: number;
  };
  /**
   * How many devices the weekly GoRecell sync can actually visit.
   *
   * That sync iterates the gorecell_product_map settings rows, so with none of
   * them it finishes in seconds having refreshed nothing, and reports success
   * while doing it. Without this number the only visible symptom is low
   * coverage, which looks like a scraping problem rather than a missing
   * mapping — two very different fixes.
   */
  const mapped = db
    .prepare("SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'gorecell_product_map:%'")
    .get() as { n: number };
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
    coverage: {
      devices_with_live_prices: covered.n,
      devices_in_catalogue: catalogue.n,
      devices_mapped_for_sync: mapped.n,
    },
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
  let beatPercent: number | undefined;
  if (beat_percent != null && beat_percent !== "") {
    const parsed = Number(beat_percent);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 25) {
      return res
        .status(400)
        .json({ error: "beat_percent must be a finite number between 0 and 25" });
    }
    beatPercent = parsed;
  }
  setFrontendPricingConfig({
    source: source as FrontendPriceSource | undefined,
    mode: mode as FrontendPriceMode | undefined,
    beatPercent,
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

const COMPETITOR_IDS = new Set<string>(COMPETITOR_SOURCES.map((c) => c.id));
const GRADE_ORDER: StoreCondition[] = ["flawless", "good", "average", "fair", "defective"];

/**
 * Where live pricing has gone quiet: device/storage pairs whose newest price
 * from one competitor is missing or older than `stale_days`.
 *
 * Scrapers fail quietly — a theme change zeroes one product page and the run
 * still reports success. This is the list a person (or an assistant) works
 * through: re-scrape it if the device is mapped, otherwise enter the price.
 */
pricingRouter.get("/gaps", (req, res) => {
  const competitor = String(req.query.competitor || "gorecell");
  if (!COMPETITOR_IDS.has(competitor)) return res.status(400).json({ error: "Unknown competitor" });
  const staleDays = Math.min(Math.max(Number(req.query.stale_days) || 8, 1), 365);
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 1000);
  const q = req.query.q ? `%${String(req.query.q).slice(0, 80)}%` : null;
  const cutoff = new Date(Date.now() - staleDays * 86_400_000).toISOString();

  const db = getDb();
  try {
    const rows = db
      .prepare(
        `SELECT d.id AS device_id, d.name, d.category_id, s.value AS storage,
                (SELECT MAX(sp.scraped_at) FROM scraped_prices sp
                  WHERE sp.competitor_name = ? AND sp.product_id = d.id
                    AND LOWER(sp.variant) = LOWER(s.value)) AS newest,
                (SELECT sp.engine FROM scraped_prices sp
                  WHERE sp.competitor_name = ? AND sp.product_id = d.id
                    AND LOWER(sp.variant) = LOWER(s.value)
                  ORDER BY sp.scraped_at DESC LIMIT 1) AS engine,
                EXISTS (SELECT 1 FROM settings st WHERE st.key = 'gorecell_product_map:' || d.id
                         AND st.value IS NOT NULL AND st.value != '') AS mapped
           FROM devices d, json_each(CASE WHEN json_valid(d.storages) THEN d.storages ELSE '[]' END) s
          WHERE d.enabled = 1 ${q ? "AND (d.name LIKE ? OR d.id LIKE ?)" : ""}`,
      )
      .all(...([competitor, competitor, ...(q ? [q, q] : [])] as string[])) as Array<{
      device_id: string;
      name: string;
      category_id: string;
      storage: string;
      newest: string | null;
      engine: string | null;
      mapped: number;
    }>;

    const gaps = rows
      .filter((r) => !r.newest || r.newest < cutoff)
      .map((r) => ({
        ...r,
        mapped: Boolean(r.mapped),
        state: r.newest ? "stale" : "missing",
        age_days: r.newest ? Math.round((Date.now() - Date.parse(r.newest)) / 86_400_000) : null,
        suggested_fix:
          competitor === "gorecell" && r.mapped
            ? "rescrape_device (it is mapped to a GoRecell product)"
            : `set_competitor_price with the current ${competitor} price`,
      }))
      .sort((a, b) => (a.newest ?? "").localeCompare(b.newest ?? ""));

    const lastRun = db
      .prepare("SELECT id, started_at, finished_at, rows_persisted, errors_json FROM scrape_runs ORDER BY id DESC LIMIT 1")
      .get() as { errors_json?: string } | undefined;
    let lastRunErrors: unknown = [];
    try {
      lastRunErrors = JSON.parse(lastRun?.errors_json || "[]");
    } catch {
      lastRunErrors = [];
    }

    res.json({
      competitor,
      stale_days: staleDays,
      total_pairs: rows.length,
      gap_count: gaps.length,
      gaps: gaps.slice(0, limit),
      last_scrape_run: lastRun ? { ...lastRun, errors_json: undefined, errors: lastRunErrors } : null,
    });
  } finally {
    db.close();
  }
});

/**
 * Enter a competitor's price by hand, for when a scraper cannot reach it.
 *
 * Written into scraped_prices exactly like a scrape (engine "manual"), so it
 * goes through the same path as live data: beat %, the grade ladder and the
 * storage caps still apply, and the next successful scrape simply replaces it.
 * Returns the customer quote before and after so the effect is visible.
 *
 * Body: { competitor, product_id, variant, prices: { flawless: 450, good: 400, … }, note }
 *   or  { competitor, product_id, variant, condition, price, note }
 */
pricingRouter.post("/competitor-price", (req, res) => {
  const b = (req.body || {}) as Record<string, unknown>;
  const competitor = String(b.competitor || "");
  const productId = String(b.product_id || "").trim();
  const variantIn = String(b.variant || "").trim();
  const note = b.note != null ? String(b.note).slice(0, 300) : null;
  if (!COMPETITOR_IDS.has(competitor)) {
    return res.status(400).json({ error: `competitor must be one of ${[...COMPETITOR_IDS].join(", ")}` });
  }
  if (!productId || !variantIn) return res.status(400).json({ error: "product_id and variant are required" });

  const asGrade = (g: unknown): StoreCondition | null => {
    const v = String(g || "").toLowerCase();
    if ((GRADE_ORDER as string[]).includes(v)) return v as StoreCondition;
    const fromCompetitor: Record<string, StoreCondition> = { excellent: "flawless", cracked: "fair", broken: "defective" };
    return fromCompetitor[v] ?? null;
  };
  const entries: Array<[StoreCondition, number]> = [];
  if (b.prices && typeof b.prices === "object") {
    for (const [g, v] of Object.entries(b.prices as Record<string, unknown>)) {
      const grade = asGrade(g);
      if (!grade) return res.status(400).json({ error: `Unknown grade "${g}". Use ${GRADE_ORDER.join(", ")}` });
      entries.push([grade, Number(v)]);
    }
  } else {
    const grade = asGrade(b.condition);
    if (!grade) return res.status(400).json({ error: `condition must be one of ${GRADE_ORDER.join(", ")}` });
    entries.push([grade, Number(b.price)]);
  }
  if (!entries.length) return res.status(400).json({ error: "No prices given" });
  for (const [g, v] of entries) {
    if (!Number.isFinite(v) || v < 5 || v > MAX_PRICE) {
      return res.status(400).json({ error: `${g}: price must be between 5 and ${MAX_PRICE}` });
    }
  }
  // Within what was entered, a better grade must not be worth less than a worse one.
  const sorted = [...entries].sort((x, y) => GRADE_ORDER.indexOf(x[0]) - GRADE_ORDER.indexOf(y[0]));
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i][1] > sorted[i - 1][1]) {
      return res.status(400).json({
        error: `${sorted[i][0]} ($${sorted[i][1]}) cannot be above ${sorted[i - 1][0]} ($${sorted[i - 1][1]})`,
      });
    }
  }

  const db = getDb();
  let device: { id: string; name: string; brand_id: string | null; storages: string } | undefined;
  try {
    device = db
      .prepare("SELECT id, name, brand_id, storages FROM devices WHERE id = ? AND enabled = 1")
      .get(productId) as typeof device;
  } finally {
    db.close();
  }
  if (!device) return res.status(404).json({ error: "Unknown or disabled device" });
  let storages: string[] = [];
  try {
    storages = JSON.parse(device.storages || "[]");
  } catch {
    storages = [];
  }
  const variant = storages.find((s) => s.toLowerCase() === variantIn.toLowerCase());
  if (!variant) return res.status(400).json({ error: `variant must be one of: ${storages.join(", ") || "(none)"}` });

  const quoteAt = (grade: StoreCondition) =>
    computeServerQuote({ deviceId: productId, storage: variant, conditionGrade: grade })?.quotedPrice ?? null;
  const before = Object.fromEntries(entries.map(([g]) => [g, quoteAt(g)]));

  const actor = req.tgAuth?.name ?? req.tgAuth?.email ?? req.tgAuth?.userId ?? "unknown";
  const make = (device.brand_id || device.name.split(" ")[0] || "Unknown").split("-")[0];
  const now = new Date().toISOString();
  persistScrapedRows(
    entries.map(([grade, price]) => ({
      competitor_name: competitor,
      make,
      model: device!.name,
      product_id: productId,
      variant,
      condition: STORE_TO_COMPETITOR[grade] as CompetitorCondition,
      trade_in_price: Math.round(price),
      sell_price: null,
      currency: "CAD",
      raw: { source: `manual:${actor}`, engine: "manual", payload: { note, entered_by: actor } },
      scraped_at: now,
    })),
    "manual",
  );

  const after = Object.fromEntries(entries.map(([g]) => [g, quoteAt(g)]));
  const db2 = getDb();
  try {
    for (const [g, v] of entries) {
      logActivityWith(
        db2,
        {
          entityType: "price",
          entityId: `${productId}|${variant}|${g}`,
          action: "competitor_price_entered",
          field: competitor,
          oldValue: before[g] == null ? null : String(before[g]),
          newValue: String(Math.round(v)),
          note: note ?? undefined,
        },
        { name: actor, role: req.tgAuth?.role ?? null, orgId: req.tgAuth?.orgId ?? null },
      );
    }
  } finally {
    db2.close();
  }

  res.status(201).json({
    ok: true,
    competitor,
    product_id: productId,
    variant,
    entered: Object.fromEntries(entries.map(([g, v]) => [g, Math.round(v)])),
    customer_quote_before: before,
    customer_quote_after: after,
    note: "Saved as a manual competitor price. The next successful scrape replaces it.",
  });
});
