import { randomBytes } from "node:crypto";
import express, { type Request, type Response, type Router } from "express";
import type { OAuthServerProvider, AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { OAuthClientInformationFull, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { InvalidClientMetadataError, InvalidGrantError, InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { getDb } from "../db/migrate.js";
import { checkStaffCredentials } from "../routes/auth.js";
import {
  ACCESS_LEVELS,
  type AccessLevel,
  ceilingFor,
  effectiveLevel,
  nowS,
  rank,
  resolveOAuthAccessToken,
  sha,
} from "./tokens.js";

export { resolveOAuthAccessToken };
export { ensureOAuthSchema } from "./tokens.js";

/**
 * OAuth 2.1 authorization server for MCP clients that sign in rather than take
 * a pasted key — claude.ai custom connectors, ChatGPT connectors, MCP Inspector.
 *
 * The SDK router handles the protocol (discovery documents, dynamic client
 * registration, PKCE verification, the token endpoint). This file is the
 * storage and the human step: a staff member signs in with their normal admin
 * login and chooses how much the assistant may do, capped at their own role.
 *
 * Tokens resolve to that staff member, so everything the assistant does goes
 * through the same permission and tenant checks as their admin session, and
 * disabling the staff login cuts the assistant off at the next call.
 */

const LEVEL_SCOPE: Record<AccessLevel, string> = {
  viewer: "mcp:read",
  operator: "mcp:operate",
  manager: "mcp:manage",
  admin: "mcp:admin",
};
export const SUPPORTED_SCOPES = Object.values(LEVEL_SCOPE);
const LEVEL_LABEL: Record<AccessLevel, string> = {
  viewer: "Read-only — look at everything, change nothing",
  operator: "Operator — offers, labels, payouts, stock",
  manager: "Manager — everything except staff logins",
  admin: "Admin — full control, including pricing and staff",
};

const ACCESS_TTL_S = 60 * 60; // 1 hour
const REFRESH_TTL_S = 30 * 24 * 60 * 60; // 30 days
const CODE_TTL_MS = 5 * 60 * 1000;
const PENDING_TTL_MS = 10 * 60 * 1000;

const rand = (n = 32) => randomBytes(n).toString("base64url");

function withDb<T>(fn: (db: ReturnType<typeof getDb>) => T): T {
  const db = getDb();
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function sweep(db: ReturnType<typeof getDb>) {
  const now = Date.now();
  db.prepare("DELETE FROM oauth_pending WHERE expires_at < ?").run(now);
  db.prepare("DELETE FROM oauth_codes WHERE expires_at < ?").run(now - CODE_TTL_MS);
  db.prepare("DELETE FROM oauth_tokens WHERE expires_at < ? AND kind = 'access'").run(nowS() - 86400);
}

const clientsStore: OAuthRegisteredClientsStore = {
  getClient(clientId: string) {
    return withDb((db) => {
      const row = db.prepare("SELECT info_json FROM oauth_clients WHERE client_id = ?").get(clientId) as
        | { info_json: string }
        | undefined;
      return row ? (JSON.parse(row.info_json) as OAuthClientInformationFull) : undefined;
    });
  },
  registerClient(client) {
    // Callbacks must be HTTPS, or loopback for desktop tools. Anything else
    // would let a registration point codes at a plain-HTTP host.
    // Desktop apps may use their own scheme (cursor://…); script-capable or
    // local-file schemes never.
    const BLOCKED = new Set(["javascript:", "data:", "file:", "vbscript:", "blob:", "about:"]);
    for (const uri of client.redirect_uris) {
      let u: URL;
      try {
        u = new URL(String(uri));
      } catch {
        throw new InvalidClientMetadataError(`redirect_uri is not a valid URL: ${uri}`);
      }
      const loopback = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
      const allowed =
        u.protocol === "https:" ||
        (u.protocol === "http:" && loopback) ||
        (u.protocol !== "http:" && !BLOCKED.has(u.protocol));
      if (!allowed) throw new InvalidClientMetadataError(`redirect_uri must be https, loopback, or an app scheme: ${uri}`);
    }
    const full = {
      ...client,
      client_id: `gsc_${rand(18)}`,
      client_id_issued_at: nowS(),
    } as OAuthClientInformationFull;
    withDb((db) =>
      db.prepare("INSERT INTO oauth_clients (client_id, info_json) VALUES (?, ?)").run(full.client_id, JSON.stringify(full)),
    );
    return full;
  },
};

function escapeHtml(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderConsent(
  res: Response,
  opts: { pendingId: string; clientName: string; redirectUri: string; requested: AccessLevel; error?: string; email?: string },
) {
  const callbackOrigin = (() => {
    try {
      return new URL(opts.redirectUri).origin;
    } catch {
      return "";
    }
  })();
  // The form posts here and is then redirected to the client's callback;
  // browsers apply form-action to that redirect, so allow exactly that origin.
  res.setHeader(
    "Content-Security-Policy",
    `default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; form-action 'self' ${callbackOrigin}; frame-ancestors 'none'; base-uri 'none'`,
  );
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cache-Control", "no-store");
  const options = ACCESS_LEVELS.map(
    (l) => `<option value="${l}"${l === opts.requested ? " selected" : ""}>${escapeHtml(LEVEL_LABEL[l])}</option>`,
  ).join("");
  res.status(opts.error ? 400 : 200).type("html").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Connect ${escapeHtml(opts.clientName)} to Gadget Swap</title>
<style>
  :root{--fg:#111827;--muted:#6b7280;--line:#e5e7eb;--brand:#0B3D2E;--bg:#f9fafb;--err:#b3453c}
  @media (prefers-color-scheme: dark){:root{--fg:#f3f4f6;--muted:#9ca3af;--line:#374151;--brand:#34d399;--bg:#111827;--err:#f87171}}
  *{box-sizing:border-box} body{margin:0;font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--fg);background:var(--bg);display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px}
  .card{width:100%;max-width:420px;border:1px solid var(--line);border-radius:14px;padding:24px;background:color-mix(in srgb,var(--bg) 92%,#fff 8%)}
  h1{font-size:1.15rem;margin:0 0 4px} p{margin:0 0 14px;color:var(--muted)} label{display:block;font-size:.85rem;margin:12px 0 4px}
  input,select{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:10px;font:inherit;background:transparent;color:inherit}
  button{margin-top:18px;width:100%;padding:11px;border:0;border-radius:10px;font:600 15px system-ui;background:var(--brand);color:#fff;cursor:pointer}
  .err{color:var(--err);font-size:.9rem;margin:10px 0 0} .fine{font-size:.78rem;margin-top:14px} code{word-break:break-all}
</style></head><body><main class="card">
<h1>Connect ${escapeHtml(opts.clientName)}</h1>
<p>Sign in with your Gadget Swap staff login to let this assistant work in your shop. You can revoke it any time in Settings.</p>
<form method="post" action="/oauth/consent" autocomplete="on">
  <input type="hidden" name="pending" value="${escapeHtml(opts.pendingId)}"/>
  <label for="email">Email</label><input id="email" name="email" type="email" required value="${escapeHtml(opts.email ?? "")}" autocomplete="username"/>
  <label for="password">Password</label><input id="password" name="password" type="password" required autocomplete="current-password"/>
  <label for="level">What may it do?</label><select id="level" name="level">${options}</select>
  ${opts.error ? `<p class="err" role="alert">${escapeHtml(opts.error)}</p>` : ""}
  <button type="submit">Sign in and allow</button>
</form>
<p class="fine">Access cannot exceed your own role. After approving you will return to <code>${escapeHtml(callbackOrigin)}</code>.</p>
</main></body></html>`);
}

function levelFromScopes(scopes: string[] | undefined): AccessLevel {
  const s = scopes ?? [];
  let best: AccessLevel = "viewer";
  for (const l of ACCESS_LEVELS) if (s.includes(LEVEL_SCOPE[l])) best = l;
  return best;
}

function issueTokens(
  db: ReturnType<typeof getDb>,
  clientId: string,
  userId: string,
  level: AccessLevel,
  resource: string | null,
): OAuthTokens {
  const access = `tg_oat_${rand(32)}`;
  const refresh = `tg_ort_${rand(32)}`;
  const ins = db.prepare(
    "INSERT INTO oauth_tokens (token_hash, kind, client_id, user_id, level, resource, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  ins.run(sha(access), "access", clientId, userId, level, resource, nowS() + ACCESS_TTL_S);
  ins.run(sha(refresh), "refresh", clientId, userId, level, resource, nowS() + REFRESH_TTL_S);
  return { access_token: access, token_type: "bearer", expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: LEVEL_SCOPE[level] };
}

export const gadgetSwapOAuthProvider: OAuthServerProvider = {
  get clientsStore() {
    return clientsStore;
  },

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response) {
    const pendingId = rand(24);
    withDb((db) => {
      sweep(db);
      db.prepare(
        `INSERT INTO oauth_pending (id, client_id, redirect_uri, code_challenge, state, scopes, resource, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        pendingId,
        client.client_id,
        params.redirectUri,
        params.codeChallenge,
        params.state ?? null,
        JSON.stringify(params.scopes ?? []),
        params.resource?.href ?? null,
        Date.now() + PENDING_TTL_MS,
      );
    });
    renderConsent(res, {
      pendingId,
      clientName: client.client_name || "An AI assistant",
      redirectUri: params.redirectUri,
      requested: levelFromScopes(params.scopes),
    });
  },

  async challengeForAuthorizationCode(_client, authorizationCode) {
    const row = withDb((db) =>
      db.prepare("SELECT code_challenge FROM oauth_codes WHERE code_hash = ?").get(sha(authorizationCode)),
    ) as { code_challenge: string } | undefined;
    if (!row) throw new InvalidGrantError("Unknown authorization code");
    return row.code_challenge;
  },

  async exchangeAuthorizationCode(client, authorizationCode, _codeVerifier, redirectUri, resource) {
    return withDb((db) => {
      const row = db
        .prepare("SELECT * FROM oauth_codes WHERE code_hash = ?")
        .get(sha(authorizationCode)) as
        | { client_id: string; user_id: string; level: AccessLevel; redirect_uri: string; resource: string | null; expires_at: number; used: number }
        | undefined;
      if (!row || row.client_id !== client.client_id) throw new InvalidGrantError("Invalid authorization code");
      if (row.used) {
        // A replayed code means it leaked: revoke everything it produced.
        db.prepare("UPDATE oauth_tokens SET revoked = 1 WHERE client_id = ? AND user_id = ?").run(row.client_id, row.user_id);
        throw new InvalidGrantError("Authorization code already used");
      }
      if (row.expires_at < Date.now()) throw new InvalidGrantError("Authorization code expired");
      if (redirectUri && redirectUri !== row.redirect_uri) throw new InvalidGrantError("redirect_uri does not match");
      if (resource && row.resource && resource.href !== row.resource) throw new InvalidGrantError("resource does not match");
      db.prepare("UPDATE oauth_codes SET used = 1 WHERE code_hash = ?").run(sha(authorizationCode));
      return issueTokens(db, client.client_id, row.user_id, row.level, row.resource);
    });
  },

  async exchangeRefreshToken(client, refreshToken, _scopes, resource) {
    return withDb((db) => {
      const row = db
        .prepare(
          `SELECT t.client_id, t.user_id, t.level, t.resource, t.expires_at, t.revoked, u.role, u.enabled
             FROM oauth_tokens t JOIN admin_users u ON u.id = t.user_id
            WHERE t.token_hash = ? AND t.kind = 'refresh'`,
        )
        .get(sha(refreshToken)) as
        | { client_id: string; user_id: string; level: string; resource: string | null; expires_at: number; revoked: number; role: string; enabled: number }
        | undefined;
      if (!row || row.client_id !== client.client_id || row.expires_at < nowS() || !row.enabled) {
        throw new InvalidGrantError("Invalid refresh token");
      }
      if (row.revoked) {
        // Rotation means a revoked refresh token is only ever presented by
        // someone who copied it. Shut the whole grant down.
        db.prepare("UPDATE oauth_tokens SET revoked = 1 WHERE client_id = ? AND user_id = ?").run(row.client_id, row.user_id);
        throw new InvalidGrantError("Refresh token reuse detected; access revoked");
      }
      if (resource && row.resource && resource.href !== row.resource) throw new InvalidGrantError("resource does not match");
      db.prepare("UPDATE oauth_tokens SET revoked = 1 WHERE token_hash = ?").run(sha(refreshToken));
      return issueTokens(db, client.client_id, row.user_id, effectiveLevel(row.level, row.role), row.resource);
    });
  },

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const id = resolveOAuthAccessToken(token);
    if (!id) throw new InvalidTokenError("Invalid or expired token");
    return {
      token,
      clientId: id.clientId,
      scopes: [LEVEL_SCOPE[id.role]],
      expiresAt: id.expiresAt,
      extra: { userId: id.userId, orgId: id.orgId, role: id.role },
    };
  },

  async revokeToken(client, request) {
    withDb((db) =>
      db.prepare("UPDATE oauth_tokens SET revoked = 1 WHERE token_hash = ? AND client_id = ?").run(sha(request.token), client.client_id),
    );
  },
};

/** POST /oauth/consent — the human step: sign in, choose a level, get sent back with a code. */
export function consentRouter(): Router {
  const r = express.Router();
  r.use(express.urlencoded({ extended: false, limit: "8kb" }));
  r.post("/", (req: Request, res: Response) => {
    const pendingId = String(req.body?.pending || "");
    const email = String(req.body?.email || "");
    const password = String(req.body?.password || "");
    const levelIn = String(req.body?.level || "viewer");

    const pending = withDb((db) =>
      db.prepare("SELECT * FROM oauth_pending WHERE id = ?").get(pendingId),
    ) as
      | { id: string; client_id: string; redirect_uri: string; code_challenge: string; state: string | null; resource: string | null; expires_at: number }
      | undefined;
    if (!pending || pending.expires_at < Date.now()) {
      return res.status(400).type("text").send("This sign-in link has expired. Go back to the assistant and connect again.");
    }
    const client = clientsStore.getClient(pending.client_id) as OAuthClientInformationFull | undefined;
    const clientName = client?.client_name || "An AI assistant";
    const requested = (rank(levelIn) >= 0 ? levelIn : "viewer") as AccessLevel;
    const again = (error: string) =>
      renderConsent(res, { pendingId, clientName, redirectUri: pending.redirect_uri, requested, error, email });

    const check = checkStaffCredentials(email, password);
    if (!check.ok) {
      return again(check.locked ? "Too many failed attempts. Try again in 15 minutes." : "Wrong email or password.");
    }
    const cap = ceilingFor(check.user.role);
    if (rank(requested) > rank(cap)) {
      return again(`Your login is ${cap}; choose that level or lower.`);
    }

    const code = rand(32);
    withDb((db) => {
      db.prepare("DELETE FROM oauth_pending WHERE id = ?").run(pendingId);
      db.prepare(
        `INSERT INTO oauth_codes (code_hash, client_id, user_id, level, redirect_uri, code_challenge, resource, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(sha(code), pending.client_id, check.user.id, requested, pending.redirect_uri, pending.code_challenge, pending.resource, Date.now() + CODE_TTL_MS);
    });
    const target = new URL(pending.redirect_uri);
    target.searchParams.set("code", code);
    if (pending.state) target.searchParams.set("state", pending.state);
    res.redirect(302, target.href);
  });
  return r;
}

/** Staff-facing: list and revoke a user's connected assistants. */
export function listOAuthGrants(orgId: string | null) {
  return withDb((db) =>
    db
      .prepare(
        `SELECT t.client_id, t.user_id, u.email, u.name, t.level,
                MIN(t.created_at) AS connected_at, MAX(t.last_used_at) AS last_used_at,
                (SELECT info_json FROM oauth_clients c WHERE c.client_id = t.client_id) AS client_json
           FROM oauth_tokens t JOIN admin_users u ON u.id = t.user_id
          WHERE t.revoked = 0 AND t.expires_at > ? ${orgId ? "AND u.org_id = ?" : ""}
          GROUP BY t.client_id, t.user_id`,
      )
      .all(...([nowS(), ...(orgId ? [orgId] : [])] as unknown[])) as Array<Record<string, unknown>>,
  ).map((r) => {
    let name = "AI assistant";
    try {
      name = (JSON.parse(String(r.client_json || "{}")) as { client_name?: string }).client_name || name;
    } catch {
      /* keep default */
    }
    return { ...r, client_json: undefined, client_name: name };
  });
}

export function revokeOAuthGrant(clientId: string, userId: string, orgId: string | null): number {
  return withDb(
    (db) =>
      db
        .prepare(
          `UPDATE oauth_tokens SET revoked = 1 WHERE client_id = ? AND user_id = ?
             ${orgId ? "AND user_id IN (SELECT id FROM admin_users WHERE org_id = ?)" : ""}`,
        )
        .run(...([clientId, userId, ...(orgId ? [orgId] : [])] as unknown[])).changes,
  );
}
