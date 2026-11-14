import { afterAll, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Over-quoting regression.
 *
 * resolveFrontendBasePrice applies `beat %` to produce the base price from the
 * live gorecell scrape, then quoteEngine stacks boosters on top: an enabled
 * price_adjustments row (multiplicative), carrier = "Unlocked" (×1.04), battery
 * health, promo codes, and payout = "store-credit" (×1.05). Before the clamp,
 * an unlocked + store-credit customer walked away with a quote ~7% ABOVE the
 * same-grade gorecell number — the "beat 2%" setting in the pricing config was
 * silently defeated by downstream boosters and the shop looked more expensive
 * than the competitor it was configured to undercut. With any positive row in
 * price_adjustments the overshoot grew further.
 *
 * The rule the clamp enforces: the final quoted price for a grade never
 * exceeds the raw competitor reference for that same grade. Boosters are
 * allowed to lift a beaten price back toward parity (so a store-credit
 * customer sees a visibly better offer than a cash one) but they cannot cross
 * the competitor's own line.
 */

const tmp = mkdtempSync(join(tmpdir(), "tg-quote-clamp-"));
process.env.TG_DB_PATH = join(tmp, "tradein.db");

const seed = new Database(process.env.TG_DB_PATH!);
seed.exec(`
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
  CREATE TABLE devices (
    id TEXT PRIMARY KEY,
    name TEXT,
    brand_id TEXT,
    category_id TEXT,
    storages TEXT,
    enabled INTEGER DEFAULT 1
  );
  CREATE TABLE prices (
    id INTEGER PRIMARY KEY,
    device_id TEXT NOT NULL,
    storage TEXT NOT NULL,
    condition_grade TEXT NOT NULL,
    carrier TEXT,
    base_price REAL NOT NULL,
    source TEXT,
    updated_at TEXT,
    UNIQUE(device_id, storage, condition_grade, carrier)
  );
  CREATE TABLE scraped_prices (
    id INTEGER PRIMARY KEY,
    competitor_name TEXT,
    product_id TEXT,
    make TEXT,
    model TEXT,
    variant TEXT,
    condition TEXT,
    trade_in_price REAL,
    sell_price REAL,
    currency TEXT,
    source_url TEXT,
    scraped_at TEXT,
    engine TEXT
  );
  CREATE TABLE price_adjustments (
    id INTEGER PRIMARY KEY,
    scope TEXT,
    scope_id TEXT,
    adjust_percent REAL DEFAULT 0,
    adjust_amount REAL DEFAULT 0,
    condition_grade TEXT,
    enabled INTEGER DEFAULT 1
  );
  CREATE TABLE promo_codes (
    id INTEGER PRIMARY KEY,
    code TEXT UNIQUE,
    discount_percent REAL DEFAULT 0,
    discount_amount REAL DEFAULT 0,
    active INTEGER DEFAULT 1,
    expires_at TEXT,
    max_uses INTEGER,
    uses INTEGER DEFAULT 0
  );
`);
seed.prepare(
  `INSERT INTO devices (id, name, brand_id, category_id, storages) VALUES (?, ?, ?, ?, ?)`,
).run("iphone-15", "iPhone 15", "apple-smartphone", "smartphone", JSON.stringify(["128GB"]));
seed.prepare(
  `INSERT INTO settings (key, value) VALUES
   ('frontend_price_source', 'gorecell'),
   ('frontend_price_mode', 'beat'),
   ('frontend_beat_percent', '2')`,
).run();
// GoRecell has a real "like new" / flawless quote for this grade at $460.
seed.prepare(
  `INSERT INTO scraped_prices
   (competitor_name, product_id, variant, condition, trade_in_price, scraped_at)
   VALUES ('gorecell', 'iphone-15', '128GB', 'excellent', 460, datetime('now'))`,
).run();
seed.close();

async function load() {
  return await import("../services/quoteEngine.js");
}

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("the final quote never crosses the competitor it is beating", () => {
  it("unlocked + store-credit cannot push the quote above the gorecell reference", async () => {
    const mod = await load();
    const q = mod.computeServerQuote({
      deviceId: "iphone-15",
      storage: "128GB",
      conditionGrade: "flawless",
      carrier: "Unlocked",
      payoutMethod: "store-credit",
    });
    expect(q).not.toBeNull();
    // Raw gorecell flawless is 460; the clamp caps at 460 even after +4% +5%.
    expect(q!.quotedPrice).toBeLessThanOrEqual(460);
    expect(q!.competitorPrice).toBe(460);
  });

  it("a positive price_adjustments row cannot push the quote above the reference", async () => {
    const db = new Database(process.env.TG_DB_PATH!);
    db.prepare(
      `INSERT INTO price_adjustments (scope, scope_id, adjust_percent, enabled)
       VALUES ('global', NULL, 15, 1)`,
    ).run();
    db.close();

    const mod = await load();
    const q = mod.computeServerQuote({
      deviceId: "iphone-15",
      storage: "128GB",
      conditionGrade: "flawless",
    });
    expect(q!.quotedPrice).toBeLessThanOrEqual(460);
  });
});
