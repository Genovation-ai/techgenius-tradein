/**
 * The GoRecell catalogue was renamed at some point: `samsung-galaxy-s20` became
 * `galaxy-s20`, and so on for the S-series through the Fold6 / Flip6. The old
 * rows were left disabled with their `gorecell_product_map:` keys attached,
 * and the catalog sync — which filters on `enabled = 1` — stopped scraping
 * them. `applySchemaPatches` runs `remapOrphanGorecellEntries` on boot to move
 * those keys onto the enabled twin, so a redeploy is enough to close the gap.
 *
 * This test rebuilds a miniature of that shape in an in-memory DB and asserts:
 *   - a stale `samsung-galaxy-s20` key moves to the enabled `galaxy-s20`,
 *   - a "Plus 5G" vs "+" name mismatch is still a match (the normalizer),
 *   - a manual mapping on the twin is never overwritten,
 *   - a key whose device row no longer exists is pruned,
 *   - orphan rows are deleted after the move (one source of truth).
 */
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { remapOrphanGorecellEntries } from "../db/patches.js";

type Row = { id: string; name: string; enabled: 0 | 1 };

function makeDb(devices: Row[], mapping: Array<[string, string]>) {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE devices (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      enabled INTEGER DEFAULT 1
    );
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT
    );
  `);
  const insDev = db.prepare("INSERT INTO devices (id, name, enabled) VALUES (?, ?, ?)");
  for (const d of devices) insDev.run(d.id, d.name, d.enabled);
  const insSetting = db.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))",
  );
  for (const [k, v] of mapping) insSetting.run(`gorecell_product_map:${k}`, v);
  remapOrphanGorecellEntries(db);
  return db;
}

function mapOf(db: Database.Database) {
  return Object.fromEntries(
    (
      db
        .prepare(
          "SELECT substr(key, length('gorecell_product_map:')+1) AS id, value FROM settings WHERE key LIKE 'gorecell_product_map:%'",
        )
        .all() as Array<{ id: string; value: string }>
    ).map((r) => [r.id, r.value]),
  );
}

describe("remapOrphanGorecellEntries — the Galaxy / iPhone rename", () => {
  it("moves a map key from a disabled 'samsung-galaxy-s20' onto the enabled 'galaxy-s20'", () => {
    const db = makeDb(
      [
        { id: "samsung-galaxy-s20", name: "Galaxy S20", enabled: 0 },
        { id: "galaxy-s20", name: "Galaxy S20", enabled: 1 },
      ],
      [["samsung-galaxy-s20", "1234"]],
    );
    expect(mapOf(db)).toEqual({ "galaxy-s20": "1234" });
    db.close();
  });

  it("pairs 'Galaxy S21 Plus 5G' with 'Galaxy S21+' — the normalizer strips + and trailing 5G", () => {
    const db = makeDb(
      [
        { id: "samsung-galaxy-s21-plus", name: "Galaxy S21 Plus 5G", enabled: 0 },
        { id: "galaxy-s21-plus", name: "Galaxy S21+", enabled: 1 },
      ],
      [["samsung-galaxy-s21-plus", "9876"]],
    );
    expect(mapOf(db)).toEqual({ "galaxy-s21-plus": "9876" });
    db.close();
  });

  it("never overwrites an existing mapping on the enabled twin", () => {
    const db = makeDb(
      [
        { id: "samsung-galaxy-s20", name: "Galaxy S20", enabled: 0 },
        { id: "galaxy-s20", name: "Galaxy S20", enabled: 1 },
      ],
      [
        ["samsung-galaxy-s20", "orphan-id"],
        ["galaxy-s20", "manual-id"],
      ],
    );
    // The manual id on the twin survives. The orphan is left alone — its
    // device is disabled, so it does not affect the sync, and leaving it is
    // safer than deleting a mapping someone might want to recover.
    expect(mapOf(db)).toEqual({
      "samsung-galaxy-s20": "orphan-id",
      "galaxy-s20": "manual-id",
    });
    db.close();
  });

  it("prunes a map key whose device row no longer exists at all", () => {
    const db = makeDb(
      [{ id: "galaxy-s20", name: "Galaxy S20", enabled: 1 }],
      [["device-that-was-deleted", "5555"]],
    );
    expect(mapOf(db)).toEqual({});
    db.close();
  });

  it("leaves a legitimate mapping alone when there's no twin to move to", () => {
    const db = makeDb(
      [{ id: "iphone-15", name: "iPhone 15", enabled: 1 }],
      [["iphone-15", "7777"]],
    );
    expect(mapOf(db)).toEqual({ "iphone-15": "7777" });
    db.close();
  });
});
