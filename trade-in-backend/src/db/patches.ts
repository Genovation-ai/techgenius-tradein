import type { Database } from "better-sqlite3";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ensureSaasSchema } from "../services/tenancy.js";

/** Additive schema patches for existing DBs (CREATE IF NOT EXISTS / ALTER safe). */
export function applySchemaPatches(db: Database): void {
  /*
   * Where a shop's parcels go back to.
   *
   * Needed to buy a real carrier label, and kept per shop rather than in an
   * environment variable because on a multi-tenant platform every shop has a
   * different one and must be able to correct it without asking us.
   */
  const settingsCols = new Set(
    (db.prepare("PRAGMA table_info(org_settings)").all() as Array<{ name: string }>).map((c) => c.name),
  );
  if (settingsCols.size) {
    for (const col of [
      "ship_street1",
      "ship_street2",
      "ship_city",
      "ship_state",
      "ship_zip",
      "ship_country",
    ]) {
      if (!settingsCols.has(col)) db.exec(`ALTER TABLE org_settings ADD COLUMN ${col} TEXT`);
    }
  }

  /*
   * Where a tenant sells, and in what currency.
   *
   * price_source is null for a region with no catalogue of its own. That is
   * not a gap to be filled by converting Canadian prices — a used phone is
   * worth a different amount in a different market, and an exchange rate
   * knows nothing about carrier locking or import duty. A region with no
   * source quotes by hand, which the widget already does for any device it
   * has no price for.
   */
  db.exec(`
    CREATE TABLE IF NOT EXISTS regions (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      currency TEXT NOT NULL,
      price_source TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  db.prepare(
    `INSERT INTO regions (code, name, currency, price_source) VALUES (?, ?, ?, ?)
     ON CONFLICT(code) DO NOTHING`,
  ).run("CA", "Canada", "CAD", "gorecell");
  db.prepare(
    `INSERT INTO regions (code, name, currency, price_source) VALUES (?, ?, ?, ?)
     ON CONFLICT(code) DO NOTHING`,
  ).run("US", "United States", "USD", null);

  /*
   * What each tenant used, one row per billable thing.
   *
   * This is both the meter and the analytics. A plan limit that cannot be
   * computed from stored rows is a limit nobody can explain to the customer
   * who hit it, so the count and the evidence are the same table.
   */
  db.exec(`
    CREATE TABLE IF NOT EXISTS usage_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      qty INTEGER NOT NULL DEFAULT 1,
      ref_id TEXT,
      occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_usage_org_month
      ON usage_events(org_id, kind, occurred_at);
  `);

  // Provenance the repair quote shows the customer: whether the supplier had
  // the part in stock when it was read, and how many grades were listed for
  // it. Added after the fact, so existing rows keep working without them.
  const marketCols = new Set(
    (db.prepare("PRAGMA table_info(repair_market_prices)").all() as Array<{ name: string }>).map((c) => c.name),
  );
  if (marketCols.size) {
    if (!marketCols.has("in_stock")) db.exec("ALTER TABLE repair_market_prices ADD COLUMN in_stock INTEGER");
    if (!marketCols.has("alternatives")) db.exec("ALTER TABLE repair_market_prices ADD COLUMN alternatives INTEGER");
  }

  const offerCols = new Set(
    (db.prepare("PRAGMA table_info(offers)").all() as Array<{ name: string }>).map((c) => c.name),
  );
  if (!offerCols.has("store_id")) {
    db.exec("ALTER TABLE offers ADD COLUMN store_id TEXT DEFAULT 'tg-burlington'");
  }
  if (!offerCols.has("created_by")) {
    db.exec("ALTER TABLE offers ADD COLUMN created_by TEXT");
  }
  if (!offerCols.has("source")) {
    db.exec("ALTER TABLE offers ADD COLUMN source TEXT DEFAULT 'widget'");
  }
  if (!offerCols.has("ai_scan_json")) {
    db.exec("ALTER TABLE offers ADD COLUMN ai_scan_json TEXT");
  }

  const invCols = new Set(
    (db.prepare("PRAGMA table_info(inventory)").all() as Array<{ name: string }>).map((c) => c.name),
  );
  if (!invCols.has("sold_at")) {
    db.exec("ALTER TABLE inventory ADD COLUMN sold_at TEXT");
  }
  if (!invCols.has("sold_note")) {
    db.exec("ALTER TABLE inventory ADD COLUMN sold_note TEXT");
  }
  if (!invCols.has("store_id")) {
    db.exec("ALTER TABLE inventory ADD COLUMN store_id TEXT DEFAULT 'tg-burlington'");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      offer_id TEXT NOT NULL REFERENCES offers(id),
      customer_id TEXT REFERENCES customers(id),
      amount REAL NOT NULL DEFAULT 0,
      currency TEXT DEFAULT 'CAD',
      status TEXT DEFAULT 'draft',
      line_items_json TEXT NOT NULL DEFAULT '[]',
      notes TEXT,
      issued_at TEXT DEFAULT (datetime('now')),
      paid_at TEXT,
      store_id TEXT DEFAULT 'tg-burlington'
    );

    CREATE TABLE IF NOT EXISTS email_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id TEXT,
      offer_id TEXT,
      recipient TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      provider_response TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      sent_at TEXT
    );

    CREATE TABLE IF NOT EXISTS uploads (
      id TEXT PRIMARY KEY,
      offer_id TEXT REFERENCES offers(id),
      filename TEXT NOT NULL,
      mime_type TEXT,
      size_bytes INTEGER DEFAULT 0,
      storage_path TEXT NOT NULL,
      uploaded_by TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY,
      inventory_id TEXT NOT NULL REFERENCES inventory(id),
      sell_price REAL NOT NULL,
      note TEXT,
      sold_by TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS crm_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      offer_id TEXT,
      payload_json TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      response TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      sent_at TEXT
    );
  `);

  // Audit trail. A buyback desk handles other people's property and pays out
  // real money, so "who moved this offer to completed, and when" has to be
  // answerable months later — a customer disputing a payout, a manager checking
  // an operator, an insurer asking when a device was received. Statuses alone
  // record the current state and throw away the history.
  db.exec(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      field TEXT,
      old_value TEXT,
      new_value TEXT,
      actor TEXT,
      actor_role TEXT,
      note TEXT,
      org_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_activity_entity ON activity_log(entity_type, entity_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at);
  `);

  // Abandoned buyback leads: a shopper who priced a device and gave contact
  // details but never submitted. The single largest recoverable revenue pool in
  // a buyback business, and previously thrown away — nothing was recorded until
  // checkout succeeded. Kept out of `offers` so an unfinished quote never
  // pollutes pipeline counts, revenue reports or the payouts board.
  db.exec(`
    CREATE TABLE IF NOT EXISTS abandoned_leads (
      id TEXT PRIMARY KEY,
      org_id TEXT,
      store_id TEXT,
      first_name TEXT,
      last_name TEXT,
      email TEXT,
      phone TEXT,
      offer_type TEXT,
      payout_method TEXT,
      items_json TEXT NOT NULL DEFAULT '[]',
      quoted_total REAL DEFAULT 0,
      furthest_step TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      converted_offer_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_abandoned_leads_status ON abandoned_leads(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_abandoned_leads_email ON abandoned_leads(email);
  `);

  // Laptops are priced on two spec axes; record the memory config alongside the
  // drive so hand-off knows the full configuration that was quoted.
  const offerItemCols = new Set(
    (db.prepare("PRAGMA table_info(offer_items)").all() as Array<{ name: string }>).map((c) => c.name),
  );
  if (offerItemCols.size && !offerItemCols.has("memory")) {
    db.exec("ALTER TABLE offer_items ADD COLUMN memory TEXT");
  }
  // Customer-declared colour. Never priced on — it is there so the parcel on
  // the bench can be matched to the offer on the screen.
  if (offerItemCols.size && !offerItemCols.has("color")) {
    db.exec("ALTER TABLE offer_items ADD COLUMN color TEXT");
  }

  const uploadCols = new Set(
    (db.prepare("PRAGMA table_info(uploads)").all() as Array<{ name: string }>).map((c) => c.name),
  );
  if (uploadCols.size && !uploadCols.has("angle")) {
    db.exec("ALTER TABLE uploads ADD COLUMN angle TEXT");
  }

  // Frontend template the widget renders with (see services/widgetTemplate.ts).
  db.prepare(
    `INSERT OR IGNORE INTO settings (key, value) VALUES ('frontend_template', 'techgenius')`,
  ).run();

  db.prepare(
    `INSERT OR IGNORE INTO settings (key, value) VALUES ('stores', ?)`,
  ).run(
    JSON.stringify([
      { id: "tg-burlington", name: "Tech Genius Burlington" },
      { id: "tg-shop", name: "Shop Tech Genius" },
    ]),
  );

  // Indexes for the paths the admin portal hits on every page load. Without
  // these SQLite full-scans: offer_items on each offer detail view, offers on
  // every status filter, and the offers list sorts the whole table through a
  // temp B-tree just to show the newest 50. Invisible at ten offers, and
  // steadily worse as a real shop accumulates them, so they go in now while the
  // tables are small enough for the index build to be instant.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_offer_items_offer   ON offer_items(offer_id);
    CREATE INDEX IF NOT EXISTS idx_offers_created      ON offers(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_offers_status       ON offers(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_offers_customer     ON offers(customer_id);
    CREATE INDEX IF NOT EXISTS idx_inventory_status    ON inventory(status);
    CREATE INDEX IF NOT EXISTS idx_email_outbox_status ON email_outbox(status);
    CREATE INDEX IF NOT EXISTS idx_notifications_offer ON notifications(offer_id);
    CREATE INDEX IF NOT EXISTS idx_customers_email     ON customers(email);
  `);

  // SaaS multi-tenant foundation (orgs, stores, settings, API keys)
  ensureSaasSchema(db);

  repointStalePlaceholderImages(db);
  dedupeScrapedPrices(db);
  seedGorecellProductMap(db);
}

/**
 * Give the weekly GoRecell sync something to visit.
 *
 * The sync iterates gorecell_product_map rows in settings — one per device,
 * mapping our id to GoRecell's product id. Those rows were built by an import
 * script run against a database by hand, which happened on a laptop and never
 * on the deployment. So the deployment had a 416-device catalogue, a weekly
 * sync that finished in fifteen seconds having visited nothing, and live
 * prices for twelve devices. Nothing was failing; there was simply nothing to
 * do, and the job said so by saying nothing.
 *
 * The map now ships with the code, and this seeds it on boot when the table
 * has none. Only ids that exist in this database's devices table are written,
 * so a mapping for a model this deployment does not carry cannot leave the
 * sync chasing a device that is not there. It never overwrites: a deployment
 * that has its own map keeps it.
 */
function seedGorecellProductMap(db: Database): void {
  const existing = (
    db.prepare("SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'gorecell_product_map:%'").get() as {
      n: number;
    }
  ).n;
  if (existing > 0) return;

  const file = [
    path.resolve(import.meta.dirname, "../../config/gorecell-product-map.json"),
    path.resolve(import.meta.dirname, "../../../config/gorecell-product-map.json"),
  ].find((c) => existsSync(c));
  if (!file) return;

  let map: Record<string, string>;
  try {
    map = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
  } catch (err) {
    console.warn("[pricing] could not read gorecell-product-map.json:", err);
    return;
  }

  const known = new Set(
    (db.prepare("SELECT id FROM devices").all() as Array<{ id: string }>).map((r) => r.id),
  );
  const insert = db.prepare(
    "INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))",
  );
  let seeded = 0;
  const run = db.transaction(() => {
    for (const [deviceId, productId] of Object.entries(map)) {
      if (!known.has(deviceId) || !productId) continue;
      insert.run(`gorecell_product_map:${deviceId}`, String(productId));
      seeded++;
    }
  });
  run();
  console.log(`[pricing] seeded GoRecell product map for ${seeded} of ${Object.keys(map).length} devices`);
}

/**
 * Collapse the scrape log to one row per price, and keep it that way.
 *
 * Every scrape run inserted a fresh row for every price it found, with no
 * constraint stopping it, so the table held the same competitor, device,
 * storage and condition over and over — locally 19,886 rows covering 3,360
 * actual prices, some stored twenty-four times. Nothing read wrongly, because
 * every query already asks for the latest row per key, but the file grows
 * without limit and the manual "Check competitor prices" button adds a
 * complete duplicate set on each press.
 *
 * The newest row per key survives — exactly the row every read already
 * resolves to — so no price a customer or the shop can see changes. The unique
 * index then makes a repeat physically impossible rather than merely unlikely,
 * and the writer upserts against it.
 *
 * product_id is nullable and SQLite treats NULLs in a unique index as distinct
 * from one another, which would have let null-keyed rows duplicate freely, so
 * the index keys on COALESCE rather than on the column.
 *
 * The index is created only here, never in schema.ts. migrate() executes the
 * schema before the patches, so declaring it there built it against a table
 * that still held duplicates and threw UNIQUE constraint failed on boot — the
 * collapse has to happen first, in the same transaction.
 */
function dedupeScrapedPrices(db: Database): void {
  const has = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='scraped_prices'")
    .get();
  if (!has) return;

  const already = db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_scraped_prices_unique'")
    .get();
  if (already) return;

  const before = (db.prepare("SELECT COUNT(*) AS n FROM scraped_prices").get() as { n: number }).n;

  const run = db.transaction(() => {
    db.exec(`
      DELETE FROM scraped_prices
       WHERE id NOT IN (
         SELECT MAX(id) FROM scraped_prices
          GROUP BY competitor_name, COALESCE(product_id, ''), variant, condition
       );
    `);
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_scraped_prices_unique
        ON scraped_prices(competitor_name, COALESCE(product_id, ''), variant, condition);
    `);
  });
  run();

  const after = (db.prepare("SELECT COUNT(*) AS n FROM scraped_prices").get() as { n: number }).n;
  if (before !== after) {
    console.log(`[pricing] scrape log collapsed ${before} rows to ${after} (one per price)`);
  }
}

/**
 * Point a device at its real photograph once one exists on disk.
 *
 * Device images are served from whatever `devices.image_url` holds, and for a
 * device with no photograph that was a generated plate at
 * `/devices/_silhouette-<id>.png`. Dropping a real photograph in as
 * `/devices/<id>.png` therefore changed nothing a customer could see: the
 * column still named the plate, and the widget kept rendering "Photo coming
 * soon" over a file that had been replaced. Thirty devices sat like that,
 * including iPads whose photographs had already shipped.
 *
 * So the column follows the disk. If a device still names a plate and a real
 * file exists under its own id, the column is repointed. Nothing is touched
 * when the file is absent, and a device already naming something other than a
 * plate is left alone — a deliberate override stays a deliberate override.
 *
 * Runs on boot so a deployment that carries new photographs also publishes
 * them, without a manual step that would eventually be forgotten.
 */
function repointStalePlaceholderImages(db: Database): void {
  const here = import.meta.dirname;
  const devicesDir = [
    path.resolve(here, "../../public/devices"),
    path.resolve(here, "../../../public/devices"),
    path.resolve(here, "../../../trade-in-platform/public/devices"),
  ].find((c) => existsSync(c));
  if (!devicesDir) return;

  const stale = db
    .prepare("SELECT id, image_url FROM devices WHERE image_url LIKE '/devices/_silhouette-%'")
    .all() as Array<{ id: string; image_url: string }>;
  if (!stale.length) return;

  const update = db.prepare("UPDATE devices SET image_url = ? WHERE id = ?");
  let moved = 0;
  const apply = db.transaction(() => {
    for (const d of stale) {
      if (!existsSync(path.join(devicesDir, `${d.id}.png`))) continue;
      update.run(`/devices/${d.id}.png`, d.id);
      moved++;
    }
  });
  apply();
  if (moved) console.log(`[images] repointed ${moved} device(s) from a plate to a real photo`);
}

/**
 * Give repair pricing something to quote from on the first boot after deploy.
 *
 * The weekly sync refreshes these in place, but it only runs once a week, and
 * triggering it by hand needs a credential the machine that scraped these does
 * not have. So the first load ships in the repository, exactly as the GoRecell
 * product map does, and the weekly job takes over from there.
 *
 * Rows are upserted rather than ignored: shipping a newer scrape should update
 * a stale price, not sit behind it. A device we do not carry is skipped, and a
 * price the shop has since overridden is untouched — overrides live in
 * repair_parts and win over anything here.
 *
 * Called after the catalogue is hydrated, not from applySchemaPatches. A fresh
 * volume has ~63 devices at migrate time and the real ~416 only once the
 * snapshot is loaded, so seeding any earlier skipped every row for a device
 * that was about to exist — which on a new deployment was all of them.
 */
export function seedRepairMarketPrices(db: Database): void {
  const file = [
    path.resolve(import.meta.dirname, "../../config/repair-market-prices.json"),
    path.resolve(import.meta.dirname, "../../../config/repair-market-prices.json"),
  ].find((c) => existsSync(c));
  if (!file) return;

  interface Row {
    source: string;
    device_id: string;
    problem: string;
    product_title: string;
    price: number;
    currency: string;
    price_cad: number;
    fx_rate: number;
    source_url: string;
    scraped_at: string;
    in_stock?: number;
    alternatives?: number;
  }

  let rows: Row[];
  try {
    rows = JSON.parse(readFileSync(file, "utf8")) as Row[];
  } catch (err) {
    console.warn("[repair-market] could not read repair-market-prices.json:", err);
    return;
  }
  if (!Array.isArray(rows) || rows.length === 0) return;

  const known = new Set((db.prepare("SELECT id FROM devices").all() as Array<{ id: string }>).map((r) => r.id));
  const upsert = db.prepare(
    `INSERT INTO repair_market_prices
       (source, device_id, problem, product_title, price, currency, price_cad, fx_rate, source_url, scraped_at, in_stock, alternatives)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source, device_id, problem) DO UPDATE SET
       product_title = excluded.product_title, price = excluded.price, currency = excluded.currency,
       price_cad = excluded.price_cad, fx_rate = excluded.fx_rate, source_url = excluded.source_url,
       scraped_at = excluded.scraped_at, in_stock = excluded.in_stock, alternatives = excluded.alternatives
     WHERE excluded.scraped_at >= repair_market_prices.scraped_at`,
  );

  let seeded = 0;
  let skipped = 0;
  const run = db.transaction(() => {
    for (const r of rows) {
      if (!known.has(r.device_id) || !(r.price_cad > 0)) { skipped++; continue; }
      upsert.run(
        r.source, r.device_id, r.problem, r.product_title, r.price, r.currency,
        r.price_cad, r.fx_rate, r.source_url, r.scraped_at, r.in_stock ?? null, r.alternatives ?? null,
      );
      seeded++;
    }
  });
  run();
  console.log(`[repair-market] seeded ${seeded} part prices (${skipped} skipped) from repair-market-prices.json`);
}
