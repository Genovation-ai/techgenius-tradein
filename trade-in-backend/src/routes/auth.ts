import { Router } from "express";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { getDb } from "../db/migrate.js";
import { nanoid } from "nanoid";

export const authRouter = Router();

const SESSION_DAYS = 14;
const MAX_FAILED = 8;
const LOCK_MS = 15 * 60 * 1000;

interface FailBucket {
  count: number;
  lockedUntil: number;
}
const failures = new Map<string, FailBucket>();

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString("hex");
}

function makePasswordRecord(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${hashPassword(password, salt)}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const next = hashPassword(password, salt);
  try {
    return timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(next, "hex"));
  } catch {
    return false;
  }
}

function makeSessionToken(): string {
  return `tg_sess_${randomBytes(24).toString("hex")}`;
}

function isLocked(email: string): boolean {
  const b = failures.get(email);
  if (!b) return false;
  if (b.lockedUntil && b.lockedUntil > Date.now()) return true;
  if (b.lockedUntil && b.lockedUntil <= Date.now()) {
    failures.delete(email);
    return false;
  }
  return false;
}

function recordFailure(email: string) {
  const b = failures.get(email) || { count: 0, lockedUntil: 0 };
  b.count += 1;
  if (b.count >= MAX_FAILED) {
    b.lockedUntil = Date.now() + LOCK_MS;
    b.count = 0;
  }
  failures.set(email, b);
}

function clearFailures(email: string) {
  failures.delete(email);
}

/** Ensure default admin exists (like first Reusely account) */
export function seedAdminUser() {
  const db = getDb();
  const existing = db.prepare("SELECT id FROM admin_users LIMIT 1").get();
  if (!existing) {
    const email = process.env.TG_ADMIN_EMAIL || "admin@techgenius.ca";
    const password = process.env.TG_ADMIN_PASSWORD || "TechGenius2026!";
    const name = process.env.TG_ADMIN_NAME || "Tech Genius Admin";
    if (process.env.NODE_ENV === "production" && !process.env.TG_ADMIN_PASSWORD) {
      console.warn(
        "SECURITY: seeding admin with built-in password. Set TG_ADMIN_PASSWORD before production exposure.",
      );
    }
    db.prepare(
      "INSERT INTO admin_users (id, email, password_hash, name, role, org_id) VALUES (?, ?, ?, ?, 'admin', 'org-tech-genius')",
    ).run(nanoid(12), email.toLowerCase(), makePasswordRecord(password), name);
    console.log(`Seeded admin login: ${email}`);
  }
  db.prepare("UPDATE admin_users SET org_id = 'org-tech-genius' WHERE org_id IS NULL").run();
  // Purge expired sessions on boot
  db.prepare("DELETE FROM admin_sessions WHERE expires_at < datetime('now')").run();
  db.close();
}

authRouter.post("/login", (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }
  if (email.length > 254 || password.length > 256) {
    return res.status(400).json({ error: "Invalid credentials" });
  }
  if (isLocked(email)) {
    return res.status(429).json({
      error: "Account temporarily locked after too many failed attempts. Try again in 15 minutes.",
    });
  }

  const db = getDb();
  const user = db
    .prepare(
      "SELECT id, email, name, role, password_hash, enabled, org_id FROM admin_users WHERE email = ?",
    )
    .get(email) as
    | {
        id: string;
        email: string;
        name: string;
        role: string;
        password_hash: string;
        enabled: number;
        org_id: string | null;
      }
    | undefined;

  if (!user || !user.enabled || !verifyPassword(password, user.password_hash)) {
    recordFailure(email);
    db.close();
    return res.status(401).json({ error: "Invalid email or password" });
  }

  clearFailures(email);
  // Bound sessions per user (revoke oldest beyond 10)
  const token = makeSessionToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  db.prepare("INSERT INTO admin_sessions (token, user_id, expires_at) VALUES (?, ?, ?)").run(
    token,
    user.id,
    expires,
  );
  const excess = db
    .prepare(
      `SELECT token FROM admin_sessions WHERE user_id = ? ORDER BY expires_at DESC LIMIT -1 OFFSET 10`,
    )
    .all(user.id) as Array<{ token: string }>;
  if (excess.length) {
    const del = db.prepare("DELETE FROM admin_sessions WHERE token = ?");
    for (const row of excess) del.run(row.token);
  }

  const orgId = user.org_id || "org-tech-genius";
  const org = db.prepare("SELECT id, slug, name, plan, status FROM orgs WHERE id = ?").get(orgId) as
    | { id: string; slug: string; name: string; plan: string; status: string }
    | undefined;
  db.close();

  res.json({
    token,
    expires_at: expires,
    user: { id: user.id, email: user.email, name: user.name, role: user.role, org_id: orgId },
    org: org || { id: orgId, slug: "tech-genius", name: "Tech Genius", plan: "growth", status: "active" },
  });
});

authRouter.post("/logout", (req, res) => {
  const token =
    (req.headers["x-api-key"] as string) ||
    (req.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "");
  if (token) {
    const db = getDb();
    db.prepare("DELETE FROM admin_sessions WHERE token = ?").run(token);
    db.close();
  }
  res.json({ ok: true });
});

authRouter.get("/me", (req, res) => {
  const token =
    (req.headers["x-api-key"] as string) ||
    (req.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "");
  if (!token) return res.status(401).json({ error: "Not signed in" });

  const db = getDb();
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.role, s.expires_at
     FROM admin_sessions s
     JOIN admin_users u ON u.id = s.user_id
     WHERE s.token = ? AND u.enabled = 1`,
    )
    .get(token) as
    | { id: string; email: string; name: string; role: string; expires_at: string }
    | undefined;

  if (!row || new Date(row.expires_at).getTime() < Date.now()) {
    if (row) db.prepare("DELETE FROM admin_sessions WHERE token = ?").run(token);
    db.close();
    return res.status(401).json({ error: "Session expired. Please sign in again." });
  }

  db.close();
  res.json({ user: { id: row.id, email: row.email, name: row.name, role: row.role } });
});

/** Fingerprint helper kept for future password-reset tokens */
export function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
