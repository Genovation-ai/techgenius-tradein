import { createHash } from "node:crypto";
import { getDb } from "../db/migrate.js";

/**
 * OAuth access-token lookup, kept free of route imports so the auth
 * middleware can use it without an import cycle.
 */

export const ACCESS_LEVELS = ["viewer", "operator", "manager", "admin"] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

export const sha = (v: string) => createHash("sha256").update(v).digest("hex");
export const nowS = () => Math.floor(Date.now() / 1000);

export function rank(level: string): number {
  return (ACCESS_LEVELS as readonly string[]).indexOf(level);
}

/** A staff role's ceiling. Unknown roles get read-only, never admin. */
export function ceilingFor(role: string): AccessLevel {
  return rank(role) >= 0 ? (role as AccessLevel) : "viewer";
}

/** The level a token may act at right now: the grant, capped by the user's current role. */
export function effectiveLevel(granted: string, userRole: string): AccessLevel {
  const cap = ceilingFor(userRole);
  return rank(granted) >= 0 && rank(granted) <= rank(cap) ? (granted as AccessLevel) : cap;
}

export interface OAuthIdentity {
  userId: string;
  email: string;
  name: string;
  orgId: string;
  role: AccessLevel;
  clientId: string;
  expiresAt: number;
}

/** Resolve a tg_oat_ access token. Null if unknown, expired, revoked, or the staff login is disabled. */
export function resolveOAuthAccessToken(token: string): OAuthIdentity | null {
  const db = getDb();
  try {
    const row = db
      .prepare(
        `SELECT t.client_id, t.user_id, t.level, t.expires_at, u.email, u.name, u.role, u.enabled, u.org_id
           FROM oauth_tokens t JOIN admin_users u ON u.id = t.user_id
          WHERE t.token_hash = ? AND t.kind = 'access' AND t.revoked = 0`,
      )
      .get(sha(token)) as
      | {
          client_id: string;
          user_id: string;
          level: string;
          expires_at: number;
          email: string;
          name: string;
          role: string;
          enabled: number;
          org_id: string | null;
        }
      | undefined;
    if (!row || !row.enabled || row.expires_at < nowS()) return null;
    db.prepare("UPDATE oauth_tokens SET last_used_at = datetime('now') WHERE token_hash = ?").run(sha(token));
    return {
      userId: row.user_id,
      email: row.email,
      name: row.name,
      orgId: row.org_id || "org-tech-genius",
      role: effectiveLevel(row.level, row.role),
      clientId: row.client_id,
      expiresAt: row.expires_at,
    };
  } catch {
    // Table missing on a database that has not migrated yet: treat as unknown.
    return null;
  } finally {
    db.close();
  }
}

export function ensureOAuthSchema(db: { exec(sql: string): unknown }): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS oauth_clients (
      client_id TEXT PRIMARY KEY,
      info_json TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS oauth_pending (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      code_challenge TEXT NOT NULL,
      state TEXT,
      scopes TEXT,
      resource TEXT,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS oauth_codes (
      code_hash TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      level TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      code_challenge TEXT NOT NULL,
      resource TEXT,
      expires_at INTEGER NOT NULL,
      used INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS oauth_tokens (
      token_hash TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      client_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      level TEXT NOT NULL,
      resource TEXT,
      expires_at INTEGER NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      last_used_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_oauth_tokens_user ON oauth_tokens(user_id, kind);
  `);
}
