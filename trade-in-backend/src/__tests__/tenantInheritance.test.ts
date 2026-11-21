import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { SCHEMA } from "../db/schema.js";
import { applySchemaPatches } from "../db/patches.js";
import { DEFAULT_ORG_ID, inheritTenantFromParents, resolveStoreId, storeOfOrg } from "../services/tenancy.js";
import { sniffImage } from "../services/fileType.js";

/**
 * Rows written without org_id were adopted into the default tenant on the next
 * boot, so another shop's photos, customers and notifications showed up in
 * Tech Genius's lists. Child rows now take the tenant of what they hang off.
 */
function freshDb() {
  const db = new Database(":memory:");
  db.exec(SCHEMA);
  applySchemaPatches(db);
  db.prepare("INSERT INTO orgs (id, slug, name) VALUES ('org-b', 'shop-b', 'Shop B')").run();
  db.prepare("INSERT INTO org_stores (id, org_id, name, enabled) VALUES ('b-main', 'org-b', 'B Main', 1)").run();
  db.prepare("INSERT INTO customers (id, first_name, last_name) VALUES ('cust-b', 'Bee', 'Shopper')").run();
  db.prepare("INSERT INTO offers (id, customer_id, status, org_id) VALUES ('TG-B1', 'cust-b', 'active_lead', 'org-b')").run();
  return db;
}

describe("child rows inherit their tenant", () => {
  it("an upload, notification or customer written without org_id gets the offer's at once", () => {
    const db = freshDb();
    db.prepare("INSERT INTO uploads (id, offer_id, filename, storage_path) VALUES ('u1', 'TG-B1', 'a.png', 'a.png')").run();
    db.prepare("INSERT INTO notifications (offer_id, type, subject) VALUES ('TG-B1', 'offer_submitted', 's')").run();
    expect(db.prepare("SELECT org_id FROM uploads WHERE id = 'u1'").get()).toEqual({ org_id: "org-b" });
    expect(db.prepare("SELECT org_id FROM notifications WHERE offer_id = 'TG-B1'").get()).toEqual({ org_id: "org-b" });
    expect(db.prepare("SELECT org_id FROM customers WHERE id = 'cust-b'").get()).toEqual({ org_id: "org-b" });
  });

  it("rows already adopted into the wrong tenant are moved back", () => {
    const db = freshDb();
    db.prepare("INSERT INTO uploads (id, offer_id, filename, storage_path, org_id) VALUES ('u2', 'TG-B1', 'a.png', 'a.png', ?)").run(DEFAULT_ORG_ID);
    db.prepare("UPDATE customers SET org_id = ? WHERE id = 'cust-b'").run(DEFAULT_ORG_ID);
    inheritTenantFromParents(db);
    expect(db.prepare("SELECT org_id FROM uploads WHERE id = 'u2'").get()).toEqual({ org_id: "org-b" });
    expect(db.prepare("SELECT org_id FROM customers WHERE id = 'cust-b'").get()).toEqual({ org_id: "org-b" });
  });
});

describe("store ids", () => {
  it("only a store of the tenant is used", () => {
    const db = freshDb();
    expect(storeOfOrg(db, "org-b", "b-main")).toBe("b-main");
    expect(storeOfOrg(db, "org-b", "tg-burlington")).toBeNull();
    expect(resolveStoreId(db, "org-b", "tg-burlington")).toBe("b-main");
    expect(resolveStoreId(db, DEFAULT_ORG_ID, undefined)).toBe("tg-burlington");
  });
});

describe("file sniffing", () => {
  it("knows images by their bytes, not their name", () => {
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImage(Buffer.from("GIF89a....", "latin1"))).toBe("image/gif");
    expect(sniffImage(Buffer.from("<html><script>", "latin1"))).toBeNull();
  });
});
