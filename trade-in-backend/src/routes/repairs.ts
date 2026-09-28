import { Router, type Request } from "express";
import type { Database } from "better-sqlite3";
import { nanoid } from "nanoid";
import { getDb } from "../db/migrate.js";
import { requireCapability } from "../middleware/auth.js";
import { orgFilter, orgIdOf } from "../middleware/orgScope.js";
import { DEFAULT_ORG_ID, getOrgById, getOrgBySlug } from "../services/tenancy.js";
import {
  REPAIR_STAGES,
  getProblems,
  getRepairSettings,
  isRepairProblem,
  problemLabel,
  quoteRepair,
  setProblems,
  setRepairSettings,
  vendorLabel,
} from "../services/repairPricing.js";

/**
 * Repairs: the second thing a shop does, in the same workspace as the first.
 *
 * Two routers. `repairPublicRouter` is what the widget talks to — the list of
 * problems, a price, a booking, a tracker — and needs no key. `repairsRouter`
 * is the admin side, behind the same API-key auth and org scoping as offers,
 * so a tenant sees its own repairs and nobody else's.
 */

export const repairPublicRouter = Router();
export const repairsRouter = Router();

/**
 * Which tenant a public request belongs to.
 *
 * The widget sends the shop's slug or id. An id is verified to exist before it
 * is used: the first version trusted any string beginning "org-", which let a
 * request write a customer and a booking under any tenant it cared to name.
 * A hint that names nothing falls to the default org, never to the string.
 */
function resolveOrg(db: Database, req: Request): string {
  const hint = String(
    (req.body as { org?: string })?.org ||
      (req.query as { org?: string })?.org ||
      req.headers["x-org-slug"] ||
      req.headers["x-org-id"] ||
      "",
  ).trim();
  if (!hint) return DEFAULT_ORG_ID;
  const org = hint.startsWith("org-") ? getOrgById(db, hint) : getOrgBySlug(db, hint);
  return org?.id ?? DEFAULT_ORG_ID;
}

/* ——— public ——— */

repairPublicRouter.get("/problems", (req, res) => {
  const db = getDb();
  try {
    res.json(getProblems(db, resolveOrg(db, req)).map(({ id, label }) => ({ id, label })));
  } finally {
    db.close();
  }
});

repairPublicRouter.post("/quote", (req, res) => {
  const { device_id, problem } = (req.body || {}) as { device_id?: string; problem?: string };
  const db = getDb();
  try {
    const orgId = resolveOrg(db, req);
    if (!device_id || !isRepairProblem(db, orgId, problem)) {
      return res.status(400).json({ error: "device_id and a known problem are required" });
    }
    const device = db.prepare("SELECT id, name FROM devices WHERE id = ? AND enabled = 1").get(device_id) as
      | { id: string; name: string }
      | undefined;
    if (!device) return res.status(404).json({ error: "Unknown device" });
    const q = quoteRepair(db, orgId, device.id, problem);
    res.json({
      device_id: device.id,
      device_name: device.name,
      problem,
      problem_label: problemLabel(db, orgId, problem),
      price: q.price,
      price_source: q.source,
      // "quote" means the shop will price it by hand; the booking still goes
      // through, and the customer is told that rather than shown a number.
      needs_quote: q.source === "quote",
      // The customer is shown the price and nothing behind it. Which supplier
      // the part came from, what it cost and what was added are the shop's own
      // numbers; they live in the admin, beside the markup and labour that
      // produced them.
    });
  } finally {
    db.close();
  }
});

repairPublicRouter.post("/book", (req, res) => {
  const body = (req.body || {}) as {
    contact?: { first_name?: string; last_name?: string; email?: string; phone?: string };
    device_id?: string;
    problem?: string;
    fulfilment?: string;
    notes?: string;
    store_id?: string;
  };
  const c = body.contact || {};
  const db = getDb();
  try {
    const orgId = resolveOrg(db, req);
    if (!c.first_name || !(c.email || c.phone) || !body.device_id || !isRepairProblem(db, orgId, body.problem)) {
      return res
        .status(400)
        .json({ error: "contact.first_name, an email or phone, device_id and a known problem are required" });
    }
    const device = db.prepare("SELECT id, name FROM devices WHERE id = ?").get(body.device_id) as
      | { id: string; name: string }
      | undefined;
    if (!device) return res.status(404).json({ error: "Unknown device" });
    const problem = body.problem; // narrowed by isRepairProblem above
    const q = quoteRepair(db, orgId, device.id, problem);
    const customerId = nanoid(12);
    const id = `TG-R-${Date.now().toString(36).toUpperCase()}-${nanoid(4).toUpperCase()}`;
    const fulfilment = body.fulfilment === "mail-in" ? "mail-in" : "drop-off";

    db.transaction(() => {
      db.prepare(
        "INSERT INTO customers (id, first_name, last_name, email, phone, org_id) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(customerId, String(c.first_name).slice(0, 80), String(c.last_name || "").slice(0, 80), c.email || null, c.phone || null, orgId);
      db.prepare(
        `INSERT INTO repairs (id, org_id, store_id, customer_id, device_id, device_name, problem, problem_label,
                              quoted_price, price_source, fulfilment, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'booked', ?)`,
      ).run(
        id, orgId, body.store_id || null, customerId, device.id, device.name, problem,
        problemLabel(db, orgId, problem), q.price, q.source, fulfilment, body.notes ? String(body.notes).slice(0, 500) : null,
      );
    })();

    res.status(201).json({ id, quoted_price: q.price, needs_quote: q.source === "quote", fulfilment });
  } finally {
    db.close();
  }
});

repairPublicRouter.get("/:id", (req, res) => {
  const db = getDb();
  try {
    const r = db
      .prepare("SELECT id, device_name, problem_label, quoted_price, price_source, fulfilment, status, created_at FROM repairs WHERE id = ?")
      .get(req.params.id) as Record<string, unknown> | undefined;
    if (!r) return res.status(404).json({ error: "Repair not found" });
    const stage = REPAIR_STAGES.find((s) => s.id === r.status);
    res.json({ ...r, status_label: stage?.label ?? "Unknown", stages: REPAIR_STAGES });
  } finally {
    db.close();
  }
});

/* ——— admin ——— */

repairsRouter.get("/", requireCapability("offers:read"), (req, res) => {
  const db = getDb();
  try {
    const f = orgFilter(req, "r");
    const status = req.query.status ? String(req.query.status) : null;
    const rows = db
      .prepare(
        `SELECT r.*, c.first_name, c.last_name, c.email, c.phone
           FROM repairs r LEFT JOIN customers c ON c.id = r.customer_id
          WHERE 1=1 ${f.sql} ${status ? "AND r.status = ?" : ""}
          ORDER BY r.created_at DESC LIMIT 200`,
      )
      .all(...f.params, ...(status ? [status] : []));
    res.json({ repairs: rows, stages: REPAIR_STAGES });
  } finally {
    db.close();
  }
});

repairsRouter.patch("/:id/status", requireCapability("offers:write"), (req, res) => {
  const status = String((req.body as { status?: string })?.status || "");
  if (!REPAIR_STAGES.some((s) => s.id === status)) return res.status(400).json({ error: "Unknown stage" });
  const db = getDb();
  try {
    const f = orgFilter(req);
    const r = db.prepare(`UPDATE repairs SET status = ?, updated_at = datetime('now') WHERE id = ? ${f.sql}`).run(status, req.params.id, ...f.params);
    if (!r.changes) return res.status(404).json({ error: "Repair not found" });
    res.json({ ok: true, status });
  } finally {
    db.close();
  }
});

repairsRouter.patch("/:id", requireCapability("offers:write"), (req, res) => {
  const { quoted_price, notes } = (req.body || {}) as { quoted_price?: number; notes?: string };
  const db = getDb();
  try {
    const f = orgFilter(req);
    const r = db
      .prepare(
        `UPDATE repairs SET
           quoted_price = COALESCE(?, quoted_price),
           price_source = CASE WHEN ? IS NOT NULL THEN 'override' ELSE price_source END,
           notes = COALESCE(?, notes),
           updated_at = datetime('now')
         WHERE id = ? ${f.sql}`,
      )
      .run(quoted_price ?? null, quoted_price ?? null, notes ?? null, req.params.id, ...f.params);
    if (!r.changes) return res.status(404).json({ error: "Repair not found" });
    res.json({ ok: true });
  } finally {
    db.close();
  }
});

// Pricing knobs and the parts table.
repairsRouter.get("/pricing", requireCapability("pricing:read"), (req, res) => {
  const db = getDb();
  try {
    const orgId = orgIdOf(req);
    const settings = getRepairSettings(db, orgId);
    const parts = db
      .prepare(
        `SELECT p.device_id, d.name AS device_name, p.problem, p.part_cost, p.override_price, p.updated_at
           FROM repair_parts p LEFT JOIN devices d ON d.id = p.device_id
          WHERE p.org_id IS ? OR p.org_id IS NULL
          ORDER BY d.name, p.problem`,
      )
      .all(orgId);
    // The same provenance the customer is shown, so the shop can answer a
    // question about a price without leaving the admin: which supplier, which
    // product, in stock or not, and how many grades were on offer.
    const market = (
      db
        .prepare(
          `SELECT m.source, m.device_id, d.name AS device_name, m.problem, m.product_title, m.price, m.currency,
                  m.price_cad, m.fx_rate, m.source_url, m.scraped_at, m.in_stock, m.alternatives
             FROM repair_market_prices m LEFT JOIN devices d ON d.id = m.device_id
            WHERE m.price_cad > 0
            ORDER BY d.name, m.problem, (m.fx_rate = 1) DESC`,
        )
        .all() as Array<Record<string, unknown> & { source: string; in_stock: number | null }>
    ).map((r) => ({
      ...r,
      vendor_label: vendorLabel(r.source),
      in_stock: r.in_stock == null ? null : r.in_stock === 1,
    }));
    // How much of the catalogue is actually priced, per source. Without this
    // the only way to know coverage is to click every device.
    const coverage = db
      .prepare(
        `SELECT m.source, COUNT(*) AS prices, COUNT(DISTINCT m.device_id) AS devices
           FROM repair_market_prices m
           JOIN devices d ON d.id = m.device_id AND d.enabled = 1
          WHERE m.price_cad > 0
          GROUP BY m.source`,
      )
      .all() as Array<{ source: string; prices: number; devices: number }>;
    const totalDevices = (db.prepare("SELECT COUNT(*) AS n FROM devices WHERE enabled = 1").get() as { n: number }).n;
    const pricedDevices = (
      db
        .prepare(
          `SELECT COUNT(DISTINCT m.device_id) AS n FROM repair_market_prices m
             JOIN devices d ON d.id = m.device_id AND d.enabled = 1 WHERE m.price_cad > 0`,
        )
        .get() as { n: number }
    ).n;
    res.json({
      settings,
      parts,
      problems: getProblems(db, orgId, true),
      market,
      coverage: {
        by_source: coverage.map((c) => ({ ...c, vendor_label: vendorLabel(c.source) })),
        devices_priced: pricedDevices,
        devices_total: totalDevices,
      },
    });
  } finally {
    db.close();
  }
});

repairsRouter.put("/pricing/settings", requireCapability("pricing:write"), (req, res) => {
  const { markup_percent, labour_fee } = (req.body || {}) as { markup_percent?: number; labour_fee?: number };
  const db = getDb();
  try {
    setRepairSettings(db, orgIdOf(req), {
      markupPercent: markup_percent != null && Number.isFinite(Number(markup_percent)) ? Number(markup_percent) : undefined,
      labourFee: labour_fee != null && Number.isFinite(Number(labour_fee)) ? Number(labour_fee) : undefined,
    });
    res.json({ ok: true, settings: getRepairSettings(db, orgIdOf(req)) });
  } finally {
    db.close();
  }
});

repairsRouter.put("/pricing/parts", requireCapability("pricing:write"), (req, res) => {
  const { device_id, problem, part_cost, override_price } = (req.body || {}) as {
    device_id?: string; problem?: string; part_cost?: number | null; override_price?: number | null;
  };
  const db = getDb();
  try {
    if (!device_id || !isRepairProblem(db, orgIdOf(req), problem)) {
      return res.status(400).json({ error: "device_id and a known problem are required" });
    }
    db.prepare(
      `INSERT INTO repair_parts (org_id, device_id, problem, part_cost, override_price, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(org_id, device_id, problem) DO UPDATE SET
         part_cost = excluded.part_cost, override_price = excluded.override_price, updated_at = datetime('now')`,
    ).run(orgIdOf(req), device_id, problem, part_cost ?? null, override_price ?? null);
    res.json({ ok: true, quote: quoteRepair(db, orgIdOf(req), device_id, problem) });
  } finally {
    db.close();
  }
});

/**
 * What customers are offered as "what's wrong", edited by the shop.
 * The whole list is sent each time; order is the order shown.
 */
repairsRouter.put("/pricing/problems", requireCapability("pricing:write"), (req, res) => {
  const db = getDb();
  try {
    const saved = setProblems(db, orgIdOf(req), (req.body as { problems?: unknown })?.problems);
    if (!saved) return res.status(400).json({ error: "Send a list with at least one enabled problem; labels cannot contain < or >" });
    res.json({ ok: true, problems: saved });
  } finally {
    db.close();
  }
});

/**
 * Refresh the published part prices. Long-running — hundreds of devices at a
 * polite pace — so it answers at once and works on; the Pricing tab shows the
 * new rows when it is done. Anything hostile to the source (a tight loop, a
 * burst) is refused by the same lock the weekly job uses.
 */
/**
 * What the last refresh did, so the tab can say so.
 *
 * The run reads a few thousand pages at a deliberately polite pace and takes
 * the better part of an hour. Firing it and telling the shop to "reload when
 * it's done" gave them no way to know when that was, or whether it had
 * achieved anything — and a run the supplier throttled looks, from outside,
 * exactly like a run that finished.
 */
interface MarketSyncState {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  progress: { done: number; total: number } | null;
  result: Record<string, unknown> | null;
  errors: string[];
}
const marketSync: MarketSyncState = {
  running: false,
  startedAt: null,
  finishedAt: null,
  progress: null,
  result: null,
  errors: [],
};
let marketSyncRunning = false;
repairsRouter.post("/pricing/market/refresh", requireCapability("pricing:write"), (_req, res) => {
  if (marketSyncRunning) return res.status(409).json({ error: "A refresh is already running" });
  marketSyncRunning = true;
  marketSync.running = true;
  marketSync.startedAt = new Date().toISOString();
  marketSync.finishedAt = null;
  marketSync.progress = null;
  marketSync.result = null;
  marketSync.errors = [];
  res.status(202).json({ ok: true, started: true });
  // Both suppliers, the Canadian one first. MobileSentrix quotes in CAD and
  // covers the laptops, watches, consoles and Samsung models iFixit does not
  // stock, so it does the bulk of the work; iFixit then fills what it can of
  // the remainder. A failure in one does not stop the other.
  void (async () => {
    try {
      const { syncSentrixPrices } = await import("../services/repairMarketSentrix.js");
      const r = await syncSentrixPrices({ onProgress: (p) => { marketSync.progress = { done: p.done, total: p.total }; } });
      marketSync.result = { ...(marketSync.result || {}), mobilesentrix: { priced: r.priced, devices: r.devices, pairs: r.pairs, rejected: r.rejected } };
      marketSync.errors.push(...r.errors);
      console.log("[repair-market] mobilesentrix:", JSON.stringify({ devices: r.devices, priced: r.priced, pairs: r.pairs }));
    } catch (e) {
      marketSync.errors.push(`MobileSentrix: ${e instanceof Error ? e.message : String(e)}`);
      console.warn("[repair-market] mobilesentrix failed:", e);
    }
    try {
      const { syncIfixitParts } = await import("../services/repairMarketIfixit.js");
      // Only the devices still without a price: the supplier the shop buys
      // from is the better number wherever it has one.
      const r = await syncIfixitParts({
        onlyMissing: true,
        onProgress: (p) => { marketSync.progress = { done: p.done, total: p.total }; },
      });
      marketSync.result = { ...(marketSync.result || {}), ifixit: { priced: r.priced, devices: r.devicesPriced, looked: r.devices } };
      marketSync.errors.push(...r.errors);
      console.log("[repair-market] ifixit:", JSON.stringify({ looked: r.devices, resolved: r.resolved, priced: r.priced }));
    } catch (e) {
      marketSync.errors.push(`iFixit: ${e instanceof Error ? e.message : String(e)}`);
      console.warn("[repair-market] ifixit failed:", e);
    }
    marketSync.running = false;
    marketSync.finishedAt = new Date().toISOString();
    marketSync.progress = null;
    marketSyncRunning = false;
  })();
});

/** Where the refresh has got to, so the tab can show it rather than guess. */
repairsRouter.get("/pricing/market/status", requireCapability("pricing:read"), (_req, res) => {
  res.json({
    running: marketSync.running,
    started_at: marketSync.startedAt,
    finished_at: marketSync.finishedAt,
    progress: marketSync.progress,
    result: marketSync.result,
    errors: marketSync.errors.slice(0, 5),
  });
});

/**
 * Bulk part costs, pasted from the shop's supplier.
 *
 * The market sync reads MobileSentrix's published Canadian prices, but a
 * published price is list price: the shop's own negotiated cost is lower, and
 * for the devices no supplier lists publicly there is no figure at all. Either
 * way the shop brings the numbers: lines of `device, problem, cost`, where the
 * device is our id or the name as the catalogue shows it. Every line is
 * checked against the catalogue and the problem list; a line that names
 * nothing we have is reported back, not silently dropped or guessed at.
 */
repairsRouter.post("/pricing/parts/import", requireCapability("pricing:write"), (req, res) => {
  const text = String((req.body as { csv?: string })?.csv || "");
  if (!text.trim()) return res.status(400).json({ error: "Send csv text: device, problem, part_cost per line" });
  const db = getDb();
  try {
    const orgId = orgIdOf(req);
    const devices = db.prepare("SELECT id, name FROM devices").all() as Array<{ id: string; name: string }>;
    const byId = new Map(devices.map((d) => [d.id, d.id]));
    const byName = new Map(devices.map((d) => [d.name.toLowerCase().trim(), d.id]));
    const problems = getProblems(db, orgId, true);
    const byLabel = new Map(problems.map((p) => [p.label.toLowerCase().trim(), p.id]));
    const byPid = new Set(problems.map((p) => p.id));
    const upsert = db.prepare(
      `INSERT INTO repair_parts (org_id, device_id, problem, part_cost, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(org_id, device_id, problem) DO UPDATE SET part_cost = excluded.part_cost, updated_at = datetime('now')`,
    );
    const rejected: Array<{ line: number; text: string; why: string }> = [];
    let imported = 0;
    const lines = text.split(/\r?\n/);
    db.transaction(() => {
      lines.forEach((raw, i) => {
        const line = raw.trim();
        if (!line || /^(device|model)\b/i.test(line)) return; // blank or a header
        const cells = line.split(/,|\t/).map((c) => c.trim().replace(/^"|"$/g, ""));
        if (cells.length < 3) return void rejected.push({ line: i + 1, text: line, why: "needs device, problem, cost" });
        const [dev, prob, costRaw] = cells;
        const deviceId = byId.get(dev) ?? byName.get(dev.toLowerCase());
        if (!deviceId) return void rejected.push({ line: i + 1, text: line, why: `no device called "${dev}"` });
        const problem = byPid.has(prob.toLowerCase().replace(/\s+/g, "_")) ? prob.toLowerCase().replace(/\s+/g, "_") : byLabel.get(prob.toLowerCase());
        if (!problem) return void rejected.push({ line: i + 1, text: line, why: `no problem called "${prob}"` });
        const cost = Number(costRaw.replace(/[$,]/g, ""));
        if (!Number.isFinite(cost) || cost <= 0) return void rejected.push({ line: i + 1, text: line, why: `"${costRaw}" is not a cost` });
        upsert.run(orgId, deviceId, problem, cost);
        imported++;
      });
    })();
    res.json({ ok: true, imported, rejected });
  } finally {
    db.close();
  }
});
