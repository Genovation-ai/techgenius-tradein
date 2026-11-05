import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * This test exists because the sell page quietly stopped undercutting
 * competitors. When the shop had the Pricing rule set to "Manual / Tech
 * Genius table" + "Beat competitor −N%", the backend returned the raw
 * sticker and skipped the beat, so Gadget Swap looked more expensive than
 * UniverCell/Bell even though the admin UI said otherwise.
 *
 * The rule the test holds the code to is simple: whichever source the shop
 * follows, mode: beat must come off the number. If someone deletes the
 * manual branch again, this fails.
 */

const tmp = mkdtempSync(join(tmpdir(), "tg-frontend-pricing-"));
process.env.TG_DB_PATH = join(tmp, "tradein.db");

// Seed before importing so the module captures the overridden path.
const seedDb = new Database(process.env.TG_DB_PATH!);
seedDb.exec(`
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
  CREATE TABLE prices (
    id INTEGER PRIMARY KEY,
    device_id TEXT NOT NULL,
    storage TEXT NOT NULL,
    condition_grade TEXT NOT NULL,
    carrier TEXT,
    base_price REAL NOT NULL,
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
`);
seedDb.prepare(
  `INSERT INTO prices (device_id, storage, condition_grade, carrier, base_price)
   VALUES (?, ?, ?, ?, ?)`,
).run("iphone-15", "128GB", "flawless", null, 600);
seedDb.close();

async function load() {
  return await import("../services/competitorPricing.js");
}

beforeAll(() => {
  // Vitest isolates each test file — no cross-contamination to worry about.
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("the sell page honours beat% whichever source the shop follows", () => {
  it("manual source + match: raw manual price goes out", async () => {
    const mod = await load();
    mod.setFrontendPricingConfig({ source: "manual", mode: "match", beatPercent: 0 });
    const r = mod.resolveFrontendBasePrice({
      productId: "iphone-15",
      variant: "128GB",
      conditionGrade: "flawless",
    });
    expect(r.basePrice).toBe(600);
    expect(r.source).toBe("manual");
    expect(r.mode).toBe("match");
  });

  it("manual source + beat 10%: beat actually comes off (regression)", async () => {
    const mod = await load();
    mod.setFrontendPricingConfig({ source: "manual", mode: "beat", beatPercent: 10 });
    const r = mod.resolveFrontendBasePrice({
      productId: "iphone-15",
      variant: "128GB",
      conditionGrade: "flawless",
    });
    // 600 × (1 − 0.10) = 540 — not 600.
    expect(r.basePrice).toBe(540);
    expect(r.source).toBe("manual");
    expect(r.mode).toBe("beat");
    // The admin page preview reads competitorPrice — it should show the
    // sticker the beat was taken off, not null.
    expect(r.competitorPrice).toBe(600);
  });

  it("manual source + beat 0%: no undercut, no rounding drift", async () => {
    const mod = await load();
    mod.setFrontendPricingConfig({ source: "manual", mode: "beat", beatPercent: 0 });
    const r = mod.resolveFrontendBasePrice({
      productId: "iphone-15",
      variant: "128GB",
      conditionGrade: "flawless",
    });
    expect(r.basePrice).toBe(600);
  });
});
