/**
 * Restore the catalog + pricing tables from catalog-backup.json.
 *
 * The counterpart to `npm run catalog:export`. This exists because a fresh
 * deploy is not a working shop: migrate() + seedCatalog() produce ~63 devices
 * at seed prices, while the real catalog is ~416 devices with GoRecell-derived
 * pricing. Health still reports "ok", so the shortfall is easy to miss until a
 * customer cannot find their phone.
 *
 * Idempotent: rows are upserted by primary key, so re-running is safe. Customer
 * data (offers, leads, invoices) is never touched — the snapshot does not
 * contain any.
 *
 * Run: npm run catalog:import            (uses data/catalog-backup.json)
 *      npm run catalog:import -- <path>  (or an explicit file)
 */
import { getDb, migrate, databasePath } from "../src/db/migrate.js";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

// A fresh volume has no schema yet, and importing into a schemaless database
// silently matches zero columns and writes nothing. Build the tables first.
migrate();

const argPath = process.argv[2];
const file = argPath
  ? path.resolve(argPath)
  : path.resolve(import.meta.dirname, "../data/catalog-backup.json");

if (!existsSync(file)) {
  console.error(`No snapshot at ${file}`);
  console.error("Generate one on a healthy machine with: npm run catalog:export");
  process.exit(1);
}

interface Snapshot {
  exported_at?: string;
  tables: Record<string, Array<Record<string, unknown>>>;
}

const snap = JSON.parse(readFileSync(file, "utf8")) as Snapshot;
if (!snap?.tables) {
  console.error("Snapshot has no `tables` key — is this a catalog-backup.json?");
  process.exit(1);
}

// Parents before children: devices reference brands/categories, prices
// reference devices. Restoring out of order trips the foreign keys.
const ORDER = ["brands", "categories", "conditions", "condition_multipliers", "devices", "prices"];

const db = getDb();
const before = Object.fromEntries(
  ORDER.map((t) => {
    try {
      return [t, (db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c];
    } catch {
      return [t, -1];
    }
  }),
);

let written = 0;
const skipped: string[] = [];

const restore = db.transaction(() => {
  for (const table of ORDER) {
    const rows = snap.tables[table];
    if (!rows?.length) continue;

    // Only write columns this database actually has, so a snapshot taken from a
    // slightly older or newer schema still restores instead of throwing.
    const live = new Set(
      (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name),
    );
    const cols = Object.keys(rows[0]).filter((c) => live.has(c));
    if (!cols.length) {
      skipped.push(table);
      continue;
    }

    const stmt = db.prepare(
      `INSERT OR REPLACE INTO ${table} (${cols.join(", ")})
       VALUES (${cols.map(() => "?").join(", ")})`,
    );
    for (const row of rows) {
      stmt.run(cols.map((c) => row[c] as never));
      written++;
    }
  }
});

// Restoring parent and child tables in one pass trips foreign keys even when
// the finished result is sound — a device can land before the brand row that
// the snapshot also carries. Defer enforcement for the load, then verify the
// result properly with foreign_key_check rather than just trusting it.
// (PRAGMA foreign_keys cannot change inside a transaction, so it goes here.)
db.pragma("foreign_keys = OFF");
try {
  restore();
} finally {
  db.pragma("foreign_keys = ON");
}

const violations = db.pragma("foreign_key_check") as Array<{ table: string }>;
if (violations.length) {
  const byTable: Record<string, number> = {};
  for (const v of violations) byTable[v.table] = (byTable[v.table] ?? 0) + 1;
  console.error("Import left dangling references — the snapshot is incomplete:");
  for (const [t, n] of Object.entries(byTable)) console.error(`  ${t}: ${n} orphaned rows`);
  console.error("Nothing was rolled back; inspect before serving traffic.");
  process.exit(1);
}

console.log(`Restored from ${file}`);
if (snap.exported_at) console.log(`  snapshot taken : ${snap.exported_at}`);
console.log(`  database       : ${databasePath()}`);
console.log(`  rows written   : ${written}`);
if (skipped.length) console.log(`  skipped tables : ${skipped.join(", ")} (no matching columns)`);
console.log("");
for (const t of ORDER) {
  const after = (() => {
    try {
      return (db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c;
    } catch {
      return -1;
    }
  })();
  if (after < 0) continue;
  const delta = after - (before[t] as number);
  console.log(`  ${t.padEnd(24)} ${String(after).padStart(6)}  (${delta >= 0 ? "+" : ""}${delta})`);
}
db.close();
