import type { Database } from "better-sqlite3";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

/**
 * Hydrate a brand-new database from the committed catalog snapshot.
 *
 * A fresh deploy runs migrate() + seedCatalog() and ends up with roughly 63
 * devices at seed prices, where the real catalog is ~416 with GoRecell-derived
 * pricing. Health still answers "ok", so nothing looks wrong — a shopper simply
 * cannot find their phone, and nobody finds out until they give up.
 *
 * Rather than leave that to a manual post-deploy step somebody will eventually
 * forget, an empty database hydrates itself from data/catalog-backup.json.
 *
 * Deliberately conservative — it only runs when the database is genuinely new:
 *   - no offers have ever been taken, and
 *   - the snapshot holds more devices than the database does.
 * So it can never overwrite a live shop's catalog or a hand-tuned price, and it
 * quietly does nothing on every boot after the first.
 *
 * Set TG_SKIP_CATALOG_HYDRATE=1 to disable.
 */
export function hydrateCatalogIfFresh(db: Database): void {
  if (process.env.TG_SKIP_CATALOG_HYDRATE === "1" || process.env.TG_SKIP_CATALOG_HYDRATE === "true") {
    return;
  }

  const file = path.resolve(import.meta.dirname, "../../data/catalog-backup.json");
  if (!existsSync(file)) return;

  let offers = 0;
  let devices = 0;
  try {
    offers = (db.prepare("SELECT COUNT(*) AS c FROM offers").get() as { c: number }).c;
    devices = (db.prepare("SELECT COUNT(*) AS c FROM devices").get() as { c: number }).c;
  } catch {
    return; // Schema not ready; migrate() runs before this in practice.
  }

  // A shop that has taken even one offer is live. Never touch its catalog.
  if (offers > 0) return;

  let snap: { tables?: Record<string, Array<Record<string, unknown>>> };
  try {
    snap = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    console.warn("[catalog] snapshot present but unreadable — skipping hydrate");
    return;
  }
  const snapshotDevices = snap.tables?.devices?.length ?? 0;
  if (snapshotDevices <= devices) return;

  // Parents before children, or the foreign keys reject the load.
  const ORDER = ["brands", "categories", "conditions", "condition_multipliers", "devices", "prices"];
  let written = 0;

  const load = db.transaction(() => {
    for (const table of ORDER) {
      const rows = snap.tables?.[table];
      if (!rows?.length) continue;
      const live = new Set(
        (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name),
      );
      const cols = Object.keys(rows[0]).filter((c) => live.has(c));
      if (!cols.length) continue;
      const stmt = db.prepare(
        `INSERT OR REPLACE INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
      );
      for (const row of rows) {
        stmt.run(cols.map((c) => row[c] as never));
        written++;
      }
    }
  });

  // Same reasoning as scripts/import_catalog_backup.ts: a single-pass restore
  // trips foreign keys even when the finished state is sound, so defer during
  // the load and verify afterwards instead of assuming.
  db.pragma("foreign_keys = OFF");
  try {
    load();
  } catch (err) {
    console.error("[catalog] hydrate failed, database left as seeded:", err);
    return;
  } finally {
    db.pragma("foreign_keys = ON");
  }

  const dangling = (db.pragma("foreign_key_check") as unknown[]).length;
  const now = (db.prepare("SELECT COUNT(*) AS c FROM devices WHERE enabled = 1").get() as { c: number }).c;
  console.log(
    `[catalog] fresh database hydrated from snapshot: ${written} rows, ${now} devices quotable` +
      (dangling ? ` — WARNING: ${dangling} dangling references` : ""),
  );
}
