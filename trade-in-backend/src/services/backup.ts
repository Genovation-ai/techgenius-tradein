import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { getDb } from "../db/migrate.js";

/**
 * Backups you can restore from, rather than backups you have configured.
 *
 * Everything lives in one SQLite file on one Railway volume. That is fine for
 * one tenant and wrong the moment someone is paying: a corrupted page or a
 * mistaken delete has no answer, and "the volume is persistent" is not a
 * backup — it is one copy.
 *
 * Postgres is the eventual answer. It is also 267 synchronous query sites
 * across 46 files, because better-sqlite3 is synchronous and every Postgres
 * driver is not, so it is a staged migration rather than an afternoon. This
 * closes the actual hole in the meantime, which is that losing the file loses
 * the business.
 *
 * Two things make this a backup rather than a copied file:
 *
 *   - SQLite's online backup API, so the snapshot is consistent even while
 *     the service is writing. `cp` on a live database can capture a torn
 *     page and produce a file that only fails when you need it.
 *   - Every snapshot is opened and checked before it is kept. A backup that
 *     has never been read is a guess.
 */

export interface Snapshot {
  file: string;
  bytes: number;
  created_at: string;
  verified: boolean;
  tables?: Record<string, number>;
  error?: string;
}

/** Tables whose emptiness would mean the snapshot is not worth keeping. */
const MUST_HAVE = ["orgs", "devices", "offers", "customers"] as const;

function backupDir(): string {
  const dbPath = process.env.TG_DB_PATH || path.resolve(process.cwd(), "data/tradein.db");
  const dir = path.join(path.dirname(dbPath), "backups");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Take a snapshot, then read it back.
 *
 * The verification is the point. It opens the file as a database, runs
 * SQLite's own integrity check, and counts the tables the product cannot work
 * without — so a snapshot that is present but unreadable is deleted rather
 * than left to be discovered during an incident.
 */
export async function takeSnapshot(): Promise<Snapshot> {
  const dir = backupDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `tradein-${stamp}.db`);

  const live = getDb();
  try {
    await live.backup(file);
  } finally {
    live.close();
  }

  const snap: Snapshot = {
    file: path.basename(file),
    bytes: fs.existsSync(file) ? fs.statSync(file).size : 0,
    created_at: new Date().toISOString(),
    verified: false,
  };

  try {
    const copy = new Database(file, { readonly: true });
    try {
      const integrity = copy.pragma("integrity_check", { simple: true });
      if (integrity !== "ok") throw new Error(`integrity_check said ${String(integrity)}`);

      const tables: Record<string, number> = {};
      for (const t of MUST_HAVE) {
        const row = copy.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number };
        tables[t] = row.c;
      }
      if (tables.orgs < 1) throw new Error("no organizations in the snapshot");
      if (tables.devices < 1) throw new Error("no devices in the snapshot");

      snap.tables = tables;
      snap.verified = true;
    } finally {
      copy.close();
    }
  } catch (e) {
    snap.error = e instanceof Error ? e.message : String(e);
    // An unverifiable snapshot is worse than none: it is a false sense of a
    // position to fall back to.
    try {
      fs.unlinkSync(file);
    } catch {
      /* leave it; the error above is what matters */
    }
  }

  return snap;
}

/** Newest first. */
export function listSnapshots(): Snapshot[] {
  const dir = backupDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".db"))
    .map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return {
        file: f,
        bytes: st.size,
        created_at: st.mtime.toISOString(),
        verified: true,
      };
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/**
 * Keep a fortnight.
 *
 * Long enough that a problem noticed on a Monday can be answered from before
 * the weekend, short enough that the volume does not fill — and a full volume
 * stops the service, which is the failure a backup is supposed to prevent.
 */
export function pruneSnapshots(keep = 14): number {
  const dir = backupDir();
  const all = listSnapshots();
  let removed = 0;
  for (const s of all.slice(keep)) {
    try {
      fs.unlinkSync(path.join(dir, s.file));
      removed++;
    } catch {
      /* nothing to do about a file we cannot remove */
    }
  }
  return removed;
}

/** Daily, and once at boot so a fresh container always has one. */
export function startBackupSchedule(): void {
  const DAY = 24 * 60 * 60 * 1000;
  const run = async () => {
    try {
      const snap = await takeSnapshot();
      const pruned = pruneSnapshots();
      if (snap.verified) {
        console.log(
          `[backup] ${snap.file} ${(snap.bytes / 1024 / 1024).toFixed(1)}MB verified` +
            (pruned ? `, ${pruned} old removed` : ""),
        );
      } else {
        console.error(`[backup] FAILED verification and was discarded: ${snap.error}`);
      }
    } catch (e) {
      console.error("[backup] could not run:", e instanceof Error ? e.message : e);
    }
  };
  void run();
  const timer = setInterval(() => void run(), DAY);
  timer.unref?.();
}
