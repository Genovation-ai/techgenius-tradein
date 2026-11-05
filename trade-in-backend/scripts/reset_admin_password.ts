/**
 * Reset an admin's password directly on the running database. Meant to be
 * run with `railway run` so it opens the same volume (/data/tradein.db) the
 * API uses — nothing else can rewrite that file.
 *
 *   railway run npx tsx scripts/reset_admin_password.ts \
 *     --email devicelifecycle@gmail.com --password '<new-password>'
 *
 * Without --email it falls back to $TG_ADMIN_EMAIL; without --password to
 * $TG_ADMIN_PASSWORD. The script creates the admin row when it does not yet
 * exist, so it also covers "we set the env vars after first boot" — the case
 * that leaves the login stuck on the original seed value.
 */
import Database from "better-sqlite3";
import path from "node:path";
import { nanoid } from "nanoid";
import { makePasswordRecord } from "../src/services/tenancy.js";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return undefined;
}

const email = (arg("--email") || process.env.TG_ADMIN_EMAIL || "").trim().toLowerCase();
const password = arg("--password") || process.env.TG_ADMIN_PASSWORD || "";
const name = arg("--name") || process.env.TG_ADMIN_NAME || "Admin";

if (!email || !password) {
  console.error("Usage: reset_admin_password --email <addr> --password <value> [--name <display>]");
  console.error("Or set TG_ADMIN_EMAIL + TG_ADMIN_PASSWORD in env.");
  process.exit(2);
}

const dbPath = process.env.TG_DB_PATH
  ? path.resolve(process.env.TG_DB_PATH)
  : path.resolve(import.meta.dirname, "../data/tradein.db");

console.log(`[reset-admin] opening ${dbPath}`);
const db = new Database(dbPath);

const row = db
  .prepare("SELECT id FROM admin_users WHERE email = ?")
  .get(email) as { id: string } | undefined;

if (row) {
  db.prepare("UPDATE admin_users SET password_hash = ?, enabled = 1 WHERE id = ?").run(
    makePasswordRecord(password),
    row.id,
  );
  console.log(`[reset-admin] updated ${email} (id ${row.id})`);
} else {
  const id = nanoid(12);
  db.prepare(
    "INSERT INTO admin_users (id, email, password_hash, name, role, org_id) VALUES (?, ?, ?, ?, 'admin', 'org-tech-genius')",
  ).run(id, email, makePasswordRecord(password), name);
  console.log(`[reset-admin] created ${email} (id ${id})`);
}

db.close();
console.log("[reset-admin] done — login should now work.");
