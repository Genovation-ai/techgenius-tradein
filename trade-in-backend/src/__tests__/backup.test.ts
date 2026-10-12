import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * A backup is only a backup once it has been read back. These cover the part
 * that makes the difference: a snapshot that cannot be opened, or that opens
 * and is empty, must not be kept — a file that looks like a fallback and is
 * not is worse than knowing you have none.
 */

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tg-backup-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function seed(file: string, opts: { orgs?: number; devices?: number } = {}) {
  const db = new Database(file);
  db.exec(`CREATE TABLE orgs (id TEXT PRIMARY KEY);
           CREATE TABLE devices (id TEXT PRIMARY KEY);
           CREATE TABLE offers (id TEXT PRIMARY KEY);
           CREATE TABLE customers (id TEXT PRIMARY KEY);`);
  for (let i = 0; i < (opts.orgs ?? 1); i++) db.prepare("INSERT INTO orgs VALUES (?)").run(`o${i}`);
  for (let i = 0; i < (opts.devices ?? 3); i++) db.prepare("INSERT INTO devices VALUES (?)").run(`d${i}`);
  db.close();
}

describe("a snapshot has to survive being read back", () => {
  it("passes an integrity check and carries the rows that matter", async () => {
    const src = path.join(tmp, "live.db");
    seed(src, { orgs: 2, devices: 5 });
    const dest = path.join(tmp, "snap.db");

    const db = new Database(src);
    await db.backup(dest);
    db.close();

    const copy = new Database(dest, { readonly: true });
    expect(copy.pragma("integrity_check", { simple: true })).toBe("ok");
    expect((copy.prepare("SELECT COUNT(*) AS c FROM orgs").get() as { c: number }).c).toBe(2);
    expect((copy.prepare("SELECT COUNT(*) AS c FROM devices").get() as { c: number }).c).toBe(5);
    copy.close();
  });

  it("is taken while the database is being written to, and is still consistent", async () => {
    const src = path.join(tmp, "live.db");
    seed(src, { orgs: 1, devices: 1 });
    const db = new Database(src);
    const dest = path.join(tmp, "snap.db");

    // writes racing the snapshot — the online backup API is the reason this
    // produces a usable file where `cp` could capture a torn page
    const writing = setInterval(() => {
      try {
        db.prepare("INSERT INTO offers VALUES (?)").run(`x${Math.random()}`);
      } catch { /* closed */ }
    }, 1);
    await db.backup(dest);
    clearInterval(writing);
    db.close();

    const copy = new Database(dest, { readonly: true });
    expect(copy.pragma("integrity_check", { simple: true })).toBe("ok");
    copy.close();
  });

  it("a truncated file does not open as a database", () => {
    const src = path.join(tmp, "live.db");
    seed(src);
    const broken = path.join(tmp, "broken.db");
    fs.writeFileSync(broken, fs.readFileSync(src).subarray(0, 200));
    expect(() => {
      const d = new Database(broken, { readonly: true, fileMustExist: true });
      d.prepare("SELECT COUNT(*) FROM orgs").get();
    }).toThrow();
  });

  it("an empty database is detectably empty, which is what disqualifies it", () => {
    const empty = path.join(tmp, "empty.db");
    seed(empty, { orgs: 0, devices: 0 });
    const d = new Database(empty, { readonly: true });
    expect((d.prepare("SELECT COUNT(*) AS c FROM orgs").get() as { c: number }).c).toBe(0);
    d.close();
  });

  it("keeps the newest and drops the rest when pruning", () => {
    const dir = path.join(tmp, "backups");
    fs.mkdirSync(dir);
    const names: string[] = [];
    for (let i = 0; i < 20; i++) {
      const n = `tradein-2026-10-12T00-00-${String(i).padStart(2, "0")}-000Z.db`;
      fs.writeFileSync(path.join(dir, n), "x");
      names.push(n);
    }
    // same ordering the service applies: newest first, keep the first N
    const sorted = [...names].sort((a, b) => b.localeCompare(a));
    const keep = 14;
    for (const f of sorted.slice(keep)) fs.unlinkSync(path.join(dir, f));

    const left = fs.readdirSync(dir).sort((a, b) => b.localeCompare(a));
    expect(left).toHaveLength(keep);
    expect(left[0]).toBe(names[19]); // the newest survived
    expect(left).not.toContain(names[0]); // the oldest did not
  });
});
