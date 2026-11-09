import { afterAll, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The resolver holds one promise: every enabled device the GoRecell
 * catalogue carries ends up with a map row, and devices it does not carry
 * are left unmapped rather than guessed at. The slug variants the resolver
 * tries are all deterministic, so this test seeds a tiny catalogue and
 * checks the match count and the row that landed in settings.
 */

const tmp = mkdtempSync(join(tmpdir(), "tg-gorecell-map-"));
process.env.TG_DB_PATH = join(tmp, "tradein.db");

const seed = new Database(process.env.TG_DB_PATH!);
seed.exec(`
  CREATE TABLE brands (id TEXT PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE devices (
    id TEXT PRIMARY KEY,
    brand_id TEXT,
    name TEXT NOT NULL,
    enabled INTEGER DEFAULT 1
  );
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT
  );
`);
seed.prepare("INSERT INTO brands (id, name) VALUES (?, ?)").run("apple", "Apple");
seed.prepare("INSERT INTO brands (id, name) VALUES (?, ?)").run("samsung", "Samsung");
seed.prepare("INSERT INTO devices (id, brand_id, name, enabled) VALUES (?, ?, ?, 1)")
  .run("iphone-15", "apple", "iPhone 15");
seed.prepare("INSERT INTO devices (id, brand_id, name, enabled) VALUES (?, ?, ?, 1)")
  .run("galaxy-s24", "samsung", "Galaxy S24");
seed.prepare("INSERT INTO devices (id, brand_id, name, enabled) VALUES (?, ?, ?, 1)")
  .run("some-niche-device", null, "Some Niche Device");
seed.prepare("INSERT INTO devices (id, brand_id, name, enabled) VALUES (?, ?, ?, 0)")
  .run("ancient-feature-phone", null, "Ancient Feature Phone");
// Pretend one device is already mapped by hand — it must stay as-is.
seed.prepare(
  "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))",
).run("gorecell_product_map:iphone-15", "9999");
seed.close();

const fakeHtml = `
  <html><body>
  <script>
    var products = [
      {"_id": 1600, "_name": "Apple iPhone 15", "_url": "https://gorecell.ca/product/apple-iphone-15/"},
      {"_id": 2100, "_name": "Samsung Galaxy S24", "_url": "https://gorecell.ca/product/samsung-galaxy-s24/"}
    ];
  </script>
  </body></html>
`;

const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
  new Response(fakeHtml, { status: 200, headers: { "content-type": "text/html" } }),
);

afterAll(() => {
  fetchSpy.mockRestore();
  rmSync(tmp, { recursive: true, force: true });
});

async function load() {
  return await import("../services/gorecellProductMap.js");
}

describe("the auto-mapper fills what can be filled and nothing else", () => {
  it("matches enabled devices by slug and skips the ones not on GoRecell", async () => {
    const mod = await load();
    const r = await mod.resolveGorecellProductMap();
    expect(r.ok).toBe(true);
    expect(r.totalDevices).toBe(3); // 3 enabled, 1 disabled excluded
    expect(r.alreadyMapped).toBe(1); // iphone-15 was pre-seeded
    expect(r.newlyMapped).toBe(1); // galaxy-s24 is the only new match
    expect(r.stillUnmapped).toBe(1); // some-niche-device is not on GoRecell
    expect(r.unmappedExamples).toEqual(["some-niche-device"]);
    expect(r.catalogueSize).toBe(2);
  });

  it("writes the matched row to settings and leaves the hand-set one alone", async () => {
    const db = new Database(process.env.TG_DB_PATH!);
    const galaxy = db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get("gorecell_product_map:galaxy-s24") as { value: string } | undefined;
    const iphone = db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get("gorecell_product_map:iphone-15") as { value: string } | undefined;
    db.close();
    expect(galaxy?.value).toBe("2100");
    expect(iphone?.value).toBe("9999"); // the pre-seeded override must not be touched
  });

  it("dryRun reports counts without writing", async () => {
    const mod = await load();
    // Add a fresh unmapped device with a hit so dryRun has something to find.
    const db = new Database(process.env.TG_DB_PATH!);
    db.prepare("INSERT INTO brands (id, name) VALUES (?, ?)").run("google", "Google");
    db.prepare("INSERT INTO devices (id, brand_id, name, enabled) VALUES (?, ?, ?, 1)")
      .run("pixel-8", "google", "Pixel 8");
    db.close();
    fetchSpy.mockResolvedValueOnce(
      new Response(
        `<script>var products = [{"_id": 42, "_url": "https://gorecell.ca/product/google-pixel-8/"}];</script>`,
        { status: 200 },
      ),
    );
    const r = await mod.resolveGorecellProductMap({ dryRun: true });
    expect(r.newlyMapped).toBe(1);
    const db2 = new Database(process.env.TG_DB_PATH!);
    const row = db2
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get("gorecell_product_map:pixel-8");
    db2.close();
    expect(row).toBeUndefined();
  });
});
