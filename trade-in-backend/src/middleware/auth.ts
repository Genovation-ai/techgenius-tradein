import type { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";
import { getDb } from "../db/migrate.js";
import { type Capability, roleHasCapability } from "./roles.js";
import { DEFAULT_ORG_ID, findOrgApiKey } from "../services/tenancy.js";

const MASTER_KEY = process.env.TG_API_KEY || "tg-dev-key-2026";

export interface TgAuthContext {
  type: "master" | "session" | "api_key" | "org_key";
  userId?: string;
  email?: string;
  name?: string;
  role: string;
  /** Paying shop / SaaS tenant — required for ops isolation */
  orgId: string;
}

declare global {
  namespace Express {
    interface Request {
      tgAuth?: TgAuthContext;
    }
  }
}

function constantTimeEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) {
    timingSafeEqual(ba, ba);
    return false;
  }
  return timingSafeEqual(ba, bb);
}

function extractToken(req: Request): string | null {
  const headerKey = req.headers["x-api-key"];
  if (typeof headerKey === "string" && headerKey) return headerKey;
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return null;
}

export function resolveRequestOrgId(req: Request): string | null {
  if (req.tgAuth?.orgId) return req.tgAuth.orgId;
  const header = req.headers["x-org-id"] || req.headers["x-org-slug"];
  if (typeof header === "string" && header.trim()) return header.trim();
  const q = req.query.org_id || req.query.org;
  if (typeof q === "string" && q.trim()) return q.trim();
  return null;
}

export function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  const key = extractToken(req);
  if (!key) {
    return res.status(401).json({ error: "Not authenticated. Sign in at /admin/login." });
  }

  if (constantTimeEquals(key, MASTER_KEY)) {
    req.tgAuth = {
      type: "master",
      role: "master",
      name: "Master API Key",
      orgId: DEFAULT_ORG_ID,
    };
    return next();
  }

  const db = getDb();

  // Per-tenant integration keys (tg_live_…)
  if (key.startsWith("tg_live_")) {
    const hit = findOrgApiKey(db, key);
    if (hit) {
      req.tgAuth = {
        type: "org_key",
        role: hit.role === "admin" ? "admin" : "manager",
        name: hit.name,
        orgId: hit.org_id,
      };
      db.close();
      return next();
    }
  }

  if (key.startsWith("tg_sess_")) {
    const row = db
      .prepare(
        `SELECT s.token, s.expires_at, u.id, u.email, u.name, u.role, u.enabled, u.org_id
         FROM admin_sessions s
         JOIN admin_users u ON u.id = s.user_id
         WHERE s.token = ?`,
      )
      .get(key) as
      | {
          token: string;
          expires_at: string;
          id: string;
          email: string;
          name: string;
          role: string;
          enabled: number;
          org_id: string | null;
        }
      | undefined;

    if (row && row.enabled && new Date(row.expires_at).getTime() >= Date.now()) {
      req.tgAuth = {
        type: "session",
        userId: row.id,
        email: row.email,
        name: row.name,
        role: row.role || "admin",
        orgId: row.org_id || DEFAULT_ORG_ID,
      };
      db.close();
      return next();
    }
    if (row) db.prepare("DELETE FROM admin_sessions WHERE token = ?").run(key);
    db.close();
    return res.status(401).json({ error: "Session expired. Please sign in again." });
  }

  const row = db.prepare("SELECT value FROM settings WHERE key = 'api_keys'").get() as
    | { value: string }
    | undefined;

  if (row) {
    try {
      const keys: string[] = JSON.parse(row.value);
      if (keys.includes(key)) {
        req.tgAuth = {
          type: "api_key",
          role: "master",
          name: "Legacy API Key",
          orgId: DEFAULT_ORG_ID,
        };
        db.close();
        return next();
      }
    } catch {
      /* invalid JSON */
    }
  }

  db.close();
  return res.status(403).json({ error: "Invalid credentials." });
}

export function requireCapability(...caps: Capability[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const role = req.tgAuth?.role;
    if (!role) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    for (const cap of caps) {
      if (!roleHasCapability(role, cap)) {
        return res.status(403).json({
          error: `Forbidden: role '${role}' lacks capability '${cap}'`,
          role,
          capability: cap,
        });
      }
    }
    return next();
  };
}

/** Require an authenticated tenant context for SaaS ops routes. */
export function requireOrg(req: Request, res: Response, next: NextFunction) {
  if (!req.tgAuth?.orgId) {
    return res.status(401).json({ error: "Organization context missing" });
  }
  return next();
}
