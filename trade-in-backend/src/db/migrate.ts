import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import path from "node:path";
import { SCHEMA } from "./schema.js";
import { applySchemaPatches } from "./patches.js";

const DB_PATH = path.resolve(import.meta.dirname, "../../data/tradein.db");

export function getDb(): DatabaseType {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  return db;
}

export function migrate() {
  const db = getDb();
  db.exec(SCHEMA);
  applySchemaPatches(db);
  console.log(`Database migrated at ${DB_PATH}`);
  db.close();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate();
}
