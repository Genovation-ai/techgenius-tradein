/**
 * Append-only record of who changed what.
 *
 * A buyback desk takes custody of other people's property and pays out real
 * money. Statuses tell you where an offer is now and throw away how it got
 * there, which is useless the moment someone disputes a payout, a manager
 * checks an operator's work, or an insurer asks when a device was received.
 *
 * Deliberately fire-and-forget: an audit write must never fail the operation it
 * is describing. Losing one log line is bad; refusing to mark an offer received
 * because logging broke is worse.
 */
import type { Database } from "better-sqlite3";
import { getDb } from "../db/migrate.js";

export interface Actor {
  name?: string | null;
  role?: string | null;
  orgId?: string | null;
}

export interface ActivityEntry {
  entityType: "offer" | "inventory" | "payout" | "invoice" | "price" | "lead";
  entityId: string;
  action: string;
  field?: string | null;
  oldValue?: string | number | null;
  newValue?: string | number | null;
  note?: string | null;
}

function write(db: Database, entry: ActivityEntry, actor: Actor): void {
  db.prepare(
    `INSERT INTO activity_log
       (entity_type, entity_id, action, field, old_value, new_value, actor, actor_role, note, org_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.entityType,
    String(entry.entityId),
    entry.action,
    entry.field ?? null,
    entry.oldValue == null ? null : String(entry.oldValue),
    entry.newValue == null ? null : String(entry.newValue),
    actor.name ?? "system",
    actor.role ?? null,
    entry.note ?? null,
    actor.orgId ?? null,
  );
}

/** Log using a caller-owned connection (inside an existing transaction). */
export function logActivityWith(db: Database, entry: ActivityEntry, actor: Actor): void {
  try {
    write(db, entry, actor);
  } catch {
    /* never break the operation being audited */
  }
}

/** Log on its own connection. */
export function logActivity(entry: ActivityEntry, actor: Actor): void {
  let db: Database | null = null;
  try {
    db = getDb();
    write(db, entry, actor);
  } catch {
    /* never break the operation being audited */
  } finally {
    db?.close();
  }
}

/** Full history for one entity, newest first. */
export function historyFor(entityType: string, entityId: string, limit = 200) {
  const db = getDb();
  try {
    return db
      .prepare(
        `SELECT id, action, field, old_value, new_value, actor, actor_role, note, created_at
           FROM activity_log
          WHERE entity_type = ? AND entity_id = ?
          ORDER BY created_at DESC, id DESC
          LIMIT ?`,
      )
      .all(entityType, entityId, limit);
  } finally {
    db.close();
  }
}
