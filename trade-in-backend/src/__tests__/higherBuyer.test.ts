import { afterAll, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * When another cash buyer pays more for the same device, storage and grade,
 * the quote follows it (UniverCell paid 8-11% more than GoRecell on "good"
 * iPhones). Stale, scaled or implausible prices from the other buyer are
 * ignored so a bad scrape cannot inflate payouts.
 */

const tmp = mkdtempSync(join(tmpdir(), "tg-higher-buyer-"));
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
const scrape = seed.prepare(
  `INSERT INTO scraped_prices (competitor_name, product_id, variant, condition, trade_in_price, scraped_at)
   VALUES (?, 'iphone-15', '128GB', ?, ?, ?)`,
);
scrape.run("gorecell", "excellent", 460, new Date().toISOString());
scrape.run("gorecell", "good", 400, new Date().toISOString());
seed.close();

function setUnivercell(price: number | null, ageDays = 0) {
  const db = new Database(process.env.TG_DB_PATH!);
  db.prepare("DELETE FROM scraped_prices WHERE competitor_name = 'univercell'").run();
  if (price != null) {
    db.prepare(
      `INSERT INTO scraped_prices (competitor_name, product_id, variant, condition, trade_in_price, scraped_at)
       VALUES ('univercell', 'iphone-15', '128GB', 'good', ?, ?)`,
    ).run(price, new Date(Date.now() - ageDays * 86_400_000).toISOString());
  }
  db.close();
}

function setFollow(value: string | null) {
  const db = new Database(process.env.TG_DB_PATH!);
  db.prepare("DELETE FROM settings WHERE key = 'frontend_follow_higher_buyers'").run();
  if (value != null) db.prepare("INSERT INTO settings (key, value) VALUES ('frontend_follow_higher_buyers', ?)").run(value);
  db.close();
}

async function quoteGood() {
  const mod = await import("../services/quoteEngine.js");
  return mod.computeServerQuote({ deviceId: "iphone-15", storage: "128GB", conditionGrade: "good" })!;
}

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("the quote follows the higher cash buyer", () => {
  it("uses GoRecell when it is the only buyer", async () => {
    setUnivercell(null);
    const q = await quoteGood();
    expect(q.competitorPrice).toBe(400);
    expect(q.quotedPrice).toBe(392);
  });

  it("rises to UniverCell when it pays more, still beating it by the set percent", async () => {
    setUnivercell(436);
    const q = await quoteGood();
    expect(q.priceSource).toBe("univercell");
    expect(q.competitorPrice).toBe(436);
    expect(q.quotedPrice).toBe(427);
  });

  it("ignores a UniverCell price older than three weeks", async () => {
    setUnivercell(436, 30);
    expect((await quoteGood()).competitorPrice).toBe(400);
  });

  it("ignores a UniverCell price more than 25% above GoRecell", async () => {
    setUnivercell(600);
    expect((await quoteGood()).competitorPrice).toBe(400);
  });

  it("never lifts a grade above the better grade", async () => {
    setUnivercell(470);
    const q = await quoteGood();
    // flawless is GoRecell 460 beaten to 451; good may not pass it.
    expect(q.quotedPrice).toBeLessThanOrEqual(451);
  });

  it("can be switched off", async () => {
    setUnivercell(436);
    setFollow("0");
    expect((await quoteGood()).competitorPrice).toBe(400);
    setFollow(null);
  });
});
