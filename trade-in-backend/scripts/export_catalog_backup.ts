/**
 * Export the catalog + pricing tables to a compact, diffable JSON snapshot.
 *
 * The SQLite file itself is gitignored: it is a 12 MB binary that changes on
 * every scrape, and it holds customer records (offers, leads, invoices). This
 * exports only the catalog side — devices, prices, brands, categories,
 * conditions — so the part that is expensive to rebuild is versioned in git
 * without committing customer data or a binary blob.
 *
 * Run: npm run catalog:export
 */
import { getDb } from "../src/db/migrate.js";
import { writeFileSync } from "node:fs";
import path from "node:path";

const TABLES = ["brands", "categories", "conditions", "condition_multipliers", "devices", "prices"];
const db = getDb();

const out: Record<string, unknown[]> = {};
for (const t of TABLES) {
  try {
    out[t] = db.prepare(`select * from ${t}`).all() as unknown[];
  } catch {
    out[t] = [];
  }
}

const dest = path.resolve(import.meta.dirname, "../data/catalog-backup.json");
const payload = { exported_at: new Date().toISOString(), tables: out };
writeFileSync(dest, JSON.stringify(payload, null, 1));

console.log(`catalog snapshot -> ${dest}`);
for (const t of TABLES) console.log(`  ${t.padEnd(24)} ${String(out[t].length).padStart(6)} rows`);
