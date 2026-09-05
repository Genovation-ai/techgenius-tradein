import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import path from "node:path";
import { SCHEMA } from "./schema.js";
import { applySchemaPatches } from "./patches.js";

/**
 * Where the database lives. Defaults to the repo's data/ folder for local work.
 *
 * TG_DB_PATH exists for deployment: hosts hand you a mounted volume at a path
 * like /data, and the database has to sit on it. Anywhere else and the file is
 * inside the container image, so every redeploy silently starts from an empty
 * database and takes the shop's offer history with it.
 */
const DB_PATH = process.env.TG_DB_PATH
  ? path.resolve(process.env.TG_DB_PATH)
  : path.resolve(import.meta.dirname, "../../data/tradein.db");

export function databasePath(): string {
  return DB_PATH;
}

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
