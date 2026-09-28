import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { getProblems, quoteRepair, setProblems, setRepairSettings } from "../services/repairPricing.js";

/**
 * The one rule that must hold: a repair price is either something the shop
 * set, or something read from a published listing, or nothing. Never a guess.
 */
function fresh() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
    CREATE TABLE repair_parts (id INTEGER PRIMARY KEY, org_id TEXT, device_id TEXT, problem TEXT,
      part_cost REAL, override_price REAL, updated_at TEXT, UNIQUE(org_id, device_id, problem));
    CREATE TABLE repair_market_prices (id INTEGER PRIMARY KEY, source TEXT, device_id TEXT, problem TEXT,
      product_title TEXT, price REAL, currency TEXT, price_cad REAL, fx_rate REAL, source_url TEXT, scraped_at TEXT,
      in_stock INTEGER, alternatives INTEGER);
  `);
  return db;
}

describe("repair pricing never invents a number", () => {
  it("with nothing on file, says the shop will quote it", () => {
    const q = quoteRepair(fresh(), null, "iphone-15", "screen");
    expect(q.price).toBeNull();
    expect(q.source).toBe("quote");
  });

  it("applies the formula the owner gave: part × (1 + markup) + labour", () => {
    const db = fresh();
    db.prepare("INSERT INTO repair_parts (org_id, device_id, problem, part_cost) VALUES (NULL, 'iphone-15', 'screen', 180)").run();
    const q = quoteRepair(db, null, "iphone-15", "screen");
    expect(q.source).toBe("formula");
    expect(q.price).toBe(298); // 180 * 1.10 + 100
  });

  it("follows the knobs when the shop moves them", () => {
    const db = fresh();
    db.prepare("INSERT INTO repair_parts (org_id, device_id, problem, part_cost) VALUES (NULL, 'iphone-15', 'screen', 180)").run();
    setRepairSettings(db, null, { markupPercent: 5, labourFee: 80 });
    expect(quoteRepair(db, null, "iphone-15", "screen").price).toBe(269);
  });

  it("an override ignores the formula entirely", () => {
    const db = fresh();
    db.prepare("INSERT INTO repair_parts (org_id, device_id, problem, part_cost, override_price) VALUES (NULL, 'iphone-15', 'screen', 180, 250)").run();
    const q = quoteRepair(db, null, "iphone-15", "screen");
    expect(q.source).toBe("override");
    expect(q.price).toBe(250);
  });

  it("uses a published part price only when the shop set nothing, and says so", () => {
    const db = fresh();
    db.prepare(
      "INSERT INTO repair_market_prices (source, device_id, problem, product_title, price, currency, price_cad, fx_rate, source_url, scraped_at) VALUES ('ifixit','iphone-15','screen','iPhone 15 Screen',89.99,'USD',126.00,1.4002,'https://x','2026-09-19T00:00:00Z')",
    ).run();
    const q = quoteRepair(db, null, "iphone-15", "screen");
    expect(q.source).toBe("market");
    expect(q.price).toBe(239); // 126 * 1.10 + 100 = 238.6
    expect(q.market?.productTitle).toBe("iPhone 15 Screen");
  });

  it("carries where the price came from, in enough detail to check it", () => {
    const db = fresh();
    db.prepare(
      `INSERT INTO repair_market_prices (source, device_id, problem, product_title, price, currency, price_cad, fx_rate, source_url, scraped_at, in_stock, alternatives)
       VALUES ('mobilesentrix','iphone-15','screen','OLED Assembly For iPhone 15',57.67,'CAD',57.67,1,'https://www.mobilesentrix.ca/x','2026-09-25T00:00:00Z',1,8)`,
    ).run();
    const q = quoteRepair(db, null, "iphone-15", "screen");
    expect(q.market?.vendor).toBe("mobilesentrix");
    expect(q.market?.vendorLabel).toBe("MobileSentrix Canada");
    expect(q.market?.sourceUrl).toBe("https://www.mobilesentrix.ca/x");
    expect(q.market?.listedCurrency).toBe("CAD");
    expect(q.market?.fxRate).toBe(1);
    expect(q.market?.inStock).toBe(true);
    expect(q.market?.alternatives).toBe(8);
  });

  it("prefers a price already in CAD over one converted from USD", () => {
    // The Canadian listing is what a Canadian shop actually pays, and no
    // exchange rate can drift underneath it — even when the USD row is newer.
    const db = fresh();
    db.prepare(
      `INSERT INTO repair_market_prices (source, device_id, problem, product_title, price, currency, price_cad, fx_rate, source_url, scraped_at)
       VALUES ('mobilesentrix','iphone-15','screen','CAD part',57.67,'CAD',57.67,1,'https://ca','2026-09-01T00:00:00Z')`,
    ).run();
    db.prepare(
      `INSERT INTO repair_market_prices (source, device_id, problem, product_title, price, currency, price_cad, fx_rate, source_url, scraped_at)
       VALUES ('ifixit','iphone-15','screen','USD part',89.99,'USD',126.00,1.4002,'https://us','2026-09-25T00:00:00Z')`,
    ).run();
    const q = quoteRepair(db, null, "iphone-15", "screen");
    expect(q.market?.productTitle).toBe("CAD part");
    expect(q.partCost).toBe(57.67);
  });

  it("ignores a market row with no usable price", () => {
    const db = fresh();
    db.prepare(
      `INSERT INTO repair_market_prices (source, device_id, problem, product_title, price, currency, price_cad, fx_rate, source_url, scraped_at)
       VALUES ('mobilesentrix','iphone-15','screen','broken',0,'CAD',0,1,'https://x','2026-09-25T00:00:00Z')`,
    ).run();
    const q = quoteRepair(db, null, "iphone-15", "screen");
    expect(q.source).toBe("quote");
    expect(q.price).toBeNull();
  });

  it("the shop's own cost beats the market price", () => {
    const db = fresh();
    db.prepare("INSERT INTO repair_market_prices (source, device_id, problem, product_title, price, currency, price_cad, fx_rate, source_url, scraped_at) VALUES ('ifixit','iphone-15','screen','x',89.99,'USD',126,1.4,'u','2026-09-19')").run();
    db.prepare("INSERT INTO repair_parts (org_id, device_id, problem, part_cost) VALUES (NULL, 'iphone-15', 'screen', 100)").run();
    const q = quoteRepair(db, null, "iphone-15", "screen");
    expect(q.source).toBe("formula");
    expect(q.price).toBe(210);
  });

  it("a market price for a different part does not leak across", () => {
    const db = fresh();
    db.prepare("INSERT INTO repair_market_prices (source, device_id, problem, product_title, price, currency, price_cad, fx_rate, source_url, scraped_at) VALUES ('ifixit','iphone-15','battery','x',40,'USD',56,1.4,'u','2026-09-19')").run();
    expect(quoteRepair(db, null, "iphone-15", "screen").source).toBe("quote");
  });
});

describe("what customers are offered is the shop's list", () => {
  it("starts from the built-in list", () => {
    expect(getProblems(fresh(), null).length).toBeGreaterThanOrEqual(10);
  });

  it("a saved list replaces it, disabled rows hidden from customers", () => {
    const db = fresh();
    const saved = setProblems(db, null, [
      { id: "screen", label: "Screen replacement", enabled: true },
      { id: "software", label: "Software", enabled: false },
      { id: "sim_tray", label: "SIM tray", enabled: true },
    ]);
    expect(saved?.length).toBe(3);
    expect(getProblems(db, null).map((p) => p.id)).toEqual(["screen", "sim_tray"]);
    expect(getProblems(db, null, true).length).toBe(3);
  });

  it("refuses markup in a label and a list with nothing enabled", () => {
    const db = fresh();
    expect(setProblems(db, null, [{ id: "x", label: "<b>hi</b>", enabled: true }])).toBeNull();
    expect(setProblems(db, null, [{ id: "x", label: "Fine", enabled: false }])).toBeNull();
  });
});
