import { describe, expect, it } from "vitest";
import Database, { type Database as DatabaseType } from "better-sqlite3";
import { DEFAULT_ORG_ID, getOrgById, getOrgBySlug } from "../services/tenancy.js";

/**
 * A public request may name the tenant it belongs to. It may not invent one.
 *
 * Both public routes — the trade-in submit and the repair booking — trusted
 * any string beginning "org-" as a tenant id, so a request could write a
 * customer and a booking under whichever tenant it cared to name. This pins
 * the rule they now share: an id is used only if it exists.
 */
function dbWithOrg() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE orgs (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
           status TEXT NOT NULL DEFAULT 'active', plan TEXT NOT NULL DEFAULT 'starter', created_at TEXT)`);
  db.prepare("INSERT INTO orgs (id, slug, name) VALUES ('org-real', 'real-shop', 'Real Shop')").run();
  return db;
}

// Mirrors resolveOrg in routes/repairs.ts and the two sites in routes/widget.ts.
function resolve(db: DatabaseType, hint: string): string {
  if (!hint) return DEFAULT_ORG_ID;
  const org = hint.startsWith("org-") ? getOrgById(db, hint) : getOrgBySlug(db, hint);
  return org?.id ?? DEFAULT_ORG_ID;
}

describe("a public request cannot name a tenant that does not exist", () => {
  it("accepts a real id and a real slug", () => {
    const db = dbWithOrg();
    expect(resolve(db, "org-real")).toBe("org-real");
    expect(resolve(db, "real-shop")).toBe("org-real");
  });

  it("refuses an invented id, falling to the default rather than the string", () => {
    const db = dbWithOrg();
    expect(resolve(db, "org-victim")).toBe(DEFAULT_ORG_ID);
    expect(resolve(db, "org-")).toBe(DEFAULT_ORG_ID);
    expect(resolve(db, "org-real'; DROP TABLE orgs;--")).toBe(DEFAULT_ORG_ID);
  });

  it("an unknown slug is not a tenant either", () => {
    expect(resolve(dbWithOrg(), "nobody")).toBe(DEFAULT_ORG_ID);
  });
});
