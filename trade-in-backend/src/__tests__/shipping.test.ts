import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { EasyPostProvider, shippingReadiness, shopAddress } from "../services/shipping.js";

describe("carrier shipping", () => {
  beforeEach(() => {
    delete process.env.TG_EASYPOST_API_KEY;
  });

  it("knows it cannot buy a label without an account", () => {
    expect(new EasyPostProvider().configured()).toBe(false);
    expect(shippingReadiness().ready).toBe(false);
    expect(shippingReadiness().missing).toContain("TG_EASYPOST_API_KEY");
  });

  it("is ready once the key is there", () => {
    process.env.TG_EASYPOST_API_KEY = "EZAK_test";
    expect(new EasyPostProvider().configured()).toBe(true);
    expect(shippingReadiness().ready).toBe(true);
    expect(shippingReadiness().missing).toEqual([]);
  });

  it("refuses to act rather than silently using no key", async () => {
    const p = new EasyPostProvider();
    await expect(
      p.rates({
        to: { name: "A", street1: "1 St", city: "Burlington", state: "ON", zip: "L7R", country: "CA" },
        from: { name: "B", street1: "2 St", city: "Toronto", state: "ON", zip: "M5V", country: "CA" },
        parcel: { length_cm: 25, width_cm: 18, height_cm: 8, weight_kg: 0.6 },
      }),
    ).rejects.toThrow(/TG_EASYPOST_API_KEY/);
  });
});

describe("the shop's return address", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`CREATE TABLE org_settings (
      org_id TEXT PRIMARY KEY, company_name TEXT, company_phone TEXT, company_email TEXT,
      ship_street1 TEXT, ship_street2 TEXT, ship_city TEXT, ship_state TEXT,
      ship_zip TEXT, ship_country TEXT);`);
  });

  it("is null until the shop has filled it in, so nothing is guessed", () => {
    db.prepare("INSERT INTO org_settings (org_id, company_name) VALUES ('o1','Shop')").run();
    expect(shopAddress(db, "o1")).toBeNull();
  });

  it("is null when half filled in — a partial address buys a lost parcel", () => {
    db.prepare(
      "INSERT INTO org_settings (org_id, company_name, ship_street1) VALUES ('o2','Shop','1 King St')",
    ).run();
    expect(shopAddress(db, "o2")).toBeNull();
  });

  it("comes back complete once it is", () => {
    db.prepare(
      `INSERT INTO org_settings (org_id, company_name, company_phone, ship_street1, ship_city, ship_state, ship_zip, ship_country)
       VALUES ('o3','Tech Genius','905-555-0100','796 Brant St','Burlington','ON','L7R 2J2','CA')`,
    ).run();
    const a = shopAddress(db, "o3");
    expect(a?.name).toBe("Tech Genius");
    expect(a?.city).toBe("Burlington");
    expect(a?.country).toBe("CA");
    expect(a?.phone).toBe("905-555-0100");
  });

  it("does not throw on a database that predates the columns", () => {
    const old = new Database(":memory:");
    old.exec("CREATE TABLE org_settings (org_id TEXT PRIMARY KEY, company_name TEXT);");
    expect(shopAddress(old, "o1")).toBeNull();
    old.close();
  });
});
