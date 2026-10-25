import { Router } from "express";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { getDb } from "../db/migrate.js";
import { nanoid } from "nanoid";
import { sendTradeInEmail } from "../services/email.js";

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
  // Dead reset tokens accumulate one row per completed or expired reset; clear
  // them on boot the same way, so the table does not grow unbounded.
  db.prepare(
    "DELETE FROM password_resets WHERE used_at IS NOT NULL OR expires_at < datetime('now')",
  ).run();
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

const RESET_TTL_MIN = 60;
// Per-account cap so the form cannot be used to bomb one person's inbox even
// across many IPs (the shared authLimiter is keyed by IP, not by target).
const RESET_WINDOW_MIN = 15;
const RESET_MAX_PER_WINDOW = 3;

/**
 * Start a password reset.
 *
 * Always answers the same way whether or not the email has an account, so the
 * form cannot be used to discover which addresses are staff. When the account
 * is real, a single-use token (only its hash is stored) is emailed as a link
 * that expires in an hour; requesting a new one invalidates any earlier link.
 */
authRouter.post("/forgot-password", (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const generic = {
    ok: true,
    message: "If that email has an account, a reset link is on its way.",
  };
  if (!email || !email.includes("@") || email.length > 254) return res.json(generic);

  const db = getDb();
  try {
    const user = db
      .prepare("SELECT id, email, name, org_id FROM admin_users WHERE email = ? AND enabled = 1")
      .get(email) as { id: string; email: string; name: string; org_id: string | null } | undefined;
    if (user) {
      // Cap how many reset emails one account can receive per window, so the
      // endpoint cannot be used to flood a chosen victim's inbox.
      const recent = db
        .prepare(
          `SELECT COUNT(*) AS c FROM password_resets
            WHERE user_id = ? AND created_at > datetime('now', ?)`,
        )
        .get(user.id, `-${RESET_WINDOW_MIN} minutes`) as { c: number };

      if (recent.c < RESET_MAX_PER_WINDOW) {
        // Do not delete earlier rows here: the throttle counts them, and
        // deleting would keep the count at one and defeat the cap. Earlier
        // links stay valid (single-use, 256-bit) until they expire or until
        // one is used, which invalidates the rest in reset-password.
        const token = randomBytes(32).toString("hex");
        const tokenHash = createHash("sha256").update(token).digest("hex");
        const expires = new Date(Date.now() + RESET_TTL_MIN * 60_000).toISOString();
        db.prepare(
          "INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
        ).run(tokenHash, user.id, expires);

        const base = (process.env.TG_APP_URL || "https://www.gadgetswap.store").replace(/\/$/, "");
        const link = `${base}/admin/reset?token=${token}`;
        const body = [
          `Hi ${user.name || "there"},`,
          "",
          "We received a request to reset the password on your admin account.",
          "",
          `Reset it here (the link expires in ${RESET_TTL_MIN} minutes):`,
          link,
          "",
          "If you did not request this, you can safely ignore this email — your password will not change.",
          "",
          "— The team",
        ].join("\n");

        void sendTradeInEmail({
          orgId: user.org_id,
          recipient: user.email,
          subject: "Reset your admin password",
          body,
        });
      }
    }
  } catch (e) {
    // A real account must never fail in a way an unknown one would not: a 500
    // here where a missing account returns 200 is itself an enumeration oracle.
    // Swallow, log, and return the same generic response either way.
    console.warn("[forgot-password] suppressed error:", e instanceof Error ? e.message : e);
  } finally {
    db.close();
  }
  return res.json(generic);
});

/**
 * Finish a password reset.
 *
 * The token is matched by its hash, must be unused and unexpired, and is burned
 * on use. Every existing session for the account is dropped too, so a reset
 * also logs out anyone who may have been signed in with the old password.
 */
authRouter.post("/reset-password", (req, res) => {
  const token = String(req.body?.token || "").trim();
  const password = String(req.body?.password || "");
  if (!token) return res.status(400).json({ error: "Missing reset token." });
  // Bound both ends, mirroring login: an unbounded password feeds scryptSync a
  // multi-megabyte input that blocks the single event loop.
  if (password.length < 8 || password.length > 256) {
    return res.status(400).json({ error: "Password must be between 8 and 256 characters." });
  }

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const db = getDb();
  try {
    // Join the account so we can also check it is still enabled and clear its
    // login lockout — a token issued before an admin was disabled must not let
    // them set a new credential, and a reset must actually restore access.
    const row = db
      .prepare(
        `SELECT pr.user_id AS user_id, pr.expires_at AS expires_at, pr.used_at AS used_at,
                u.email AS user_email, u.enabled AS enabled
           FROM password_resets pr JOIN admin_users u ON u.id = pr.user_id
          WHERE pr.token_hash = ?`,
      )
      .get(tokenHash) as
      | { user_id: string; expires_at: string; used_at: string | null; user_email: string; enabled: number }
      | undefined;
    if (
      !row ||
      row.used_at ||
      new Date(row.expires_at).getTime() < Date.now() ||
      !row.enabled
    ) {
      return res
        .status(400)
        .json({ error: "This reset link is invalid or has expired. Please request a new one." });
    }
    db.prepare("UPDATE admin_users SET password_hash = ? WHERE id = ?").run(
      makePasswordRecord(password),
      row.user_id,
    );
    db.prepare("UPDATE password_resets SET used_at = datetime('now') WHERE token_hash = ?").run(
      tokenHash,
    );
    // Using one link invalidates every other outstanding link for the account.
    db.prepare(
      "DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL",
    ).run(row.user_id);
    db.prepare("DELETE FROM admin_sessions WHERE user_id = ?").run(row.user_id);
    // Clear any failed-login lockout, so the reset actually lets them back in
    // rather than leaving them stuck on 429 with valid new credentials.
    clearFailures(String(row.user_email).trim().toLowerCase());
    return res.json({ ok: true });
  } finally {
    db.close();
  }
});

/** Fingerprint helper kept for future password-reset tokens */
export function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
