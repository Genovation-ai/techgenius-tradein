import type { Database } from "better-sqlite3";
import { ensureSaasSchema } from "../services/tenancy.js";

/** Additive schema patches for existing DBs (CREATE IF NOT EXISTS / ALTER safe). */
export function applySchemaPatches(db: Database): void {
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

  // SaaS multi-tenant foundation (orgs, stores, settings, API keys)
  ensureSaasSchema(db);
}
