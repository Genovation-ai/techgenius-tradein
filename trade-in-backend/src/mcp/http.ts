import type { Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDb } from "../db/migrate.js";
import { createGadgetSwapMcp, type ToolCallEvent } from "./tools.js";
import { renderConnectPage } from "./clients.js";

/**
 * MCP over HTTP, in the two shapes clients use.
 *
 *  - POST /mcp — Streamable HTTP (current spec), stateless: a fresh server per
 *    request, so callers are fully separate.
 *  - GET /sse + POST /messages — the older HTTP+SSE transport, for clients
 *    that have not moved on (older n8n, some IDE plugins).
 *
 * Both run after apiKeyAuth. Each server's tools call the REST API back on
 * loopback with the caller's own token, so the MCP layer can never see or do
 * more than that key or sign-in could through the admin console.
 */

function tokenOf(req: Request): string {
  const header = req.headers["x-api-key"];
  const auth = req.headers.authorization;
  if (typeof header === "string" && header) return header;
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return "";
}

function serverFor(req: Request, port: number, clientTag: string): McpServer {
  const who = req.tgAuth;
  const actor = who?.email || who?.name || who?.userId || who?.type || "unknown";
  return createGadgetSwapMcp({
    baseUrl: `http://127.0.0.1:${port}`,
    apiKey: tokenOf(req),
    readOnly: who?.role === "viewer",
    clientTag,
    onToolCall: (ev) =>
      recordToolCall(ev, { orgId: who?.orgId ?? null, actor, authType: who?.type ?? null, role: who?.role ?? null }),
  });
}

/**
 * The spec asks clients to accept both JSON and an event stream, and the SDK
 * answers 406 to any that do not. Plenty of real clients send only
 * application/json (or nothing). We always reply with plain JSON, so widen the
 * header rather than turn those clients away.
 */
function tolerateAccept(req: Request): void {
  const accept = String(req.headers.accept || "");
  if (!accept.includes("application/json") || !accept.includes("text/event-stream")) {
    req.headers.accept = "application/json, text/event-stream";
  }
}

export async function handleMcpRequest(req: Request, res: Response, port: number): Promise<void> {
  tolerateAccept(req);
  const server = serverFor(req, port, "mcp-http");
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.warn("[mcp] request failed:", e instanceof Error ? e.message : e);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
    }
  }
}

// ---------- legacy HTTP+SSE ----------

interface SseSession {
  transport: SSEServerTransport;
  server: McpServer;
  token: string;
  ping: ReturnType<typeof setInterval>;
}
const sseSessions = new Map<string, SseSession>();
const MAX_SSE_SESSIONS = 200;

export async function handleSseConnect(req: Request, res: Response, port: number): Promise<void> {
  if (sseSessions.size >= MAX_SSE_SESSIONS) {
    res.status(503).json({ error: "Too many open SSE connections; use Streamable HTTP at /mcp" });
    return;
  }
  const server = serverFor(req, port, "mcp-sse");
  const transport = new SSEServerTransport("/messages", res);
  // Proxies close streams that go quiet; a comment line every 25 s keeps it open.
  const ping = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch {
      /* closed */
    }
  }, 25_000);
  const session: SseSession = { transport, server, token: tokenOf(req), ping };
  sseSessions.set(transport.sessionId, session);
  res.on("close", () => {
    clearInterval(ping);
    sseSessions.delete(transport.sessionId);
    void server.close();
  });
  try {
    await server.connect(transport);
  } catch (e) {
    console.warn("[mcp] sse connect failed:", e instanceof Error ? e.message : e);
    clearInterval(ping);
    sseSessions.delete(transport.sessionId);
    if (!res.headersSent) res.status(500).json({ error: "Could not open the SSE stream" });
  }
}

export async function handleSseMessage(req: Request, res: Response): Promise<void> {
  const sessionId = String(req.query.sessionId || "");
  const session = sseSessions.get(sessionId);
  if (!session) {
    res.status(404).json({ error: "Unknown or expired SSE session; reconnect to /sse" });
    return;
  }
  // The session belongs to whoever opened it. Knowing the id is not enough.
  if (tokenOf(req) !== session.token) {
    res.status(403).json({ error: "This SSE session belongs to a different key" });
    return;
  }
  try {
    await session.transport.handlePostMessage(req, res, req.body);
  } catch (e) {
    console.warn("[mcp] sse message failed:", e instanceof Error ? e.message : e);
    if (!res.headersSent) res.status(500).json({ error: "Message failed" });
  }
}

// ---------- browser page ----------

/**
 * GET /mcp: a person opening the URL gets the setup page; an MCP client asking
 * for a server-initiated stream gets 405, as the stateless transport offers none.
 */
export function handleMcpGet(publicBase: URL) {
  return (req: Request, res: Response): void => {
    const accept = String(req.headers.accept || "");
    if (accept.includes("text/html")) {
      res.setHeader("Cache-Control", "no-store");
      res
        .type("html")
        .send(
          renderConnectPage(new URL("/mcp", publicBase).href, new URL("/sse", publicBase).href, new URL("/admin/settings", publicBase).href),
        );
      return;
    }
    mcpMethodNotAllowed(req, res);
  };
}

/** Audit row per tool call. Never allowed to break the call itself. */
function recordToolCall(
  ev: ToolCallEvent,
  who: { orgId: string | null; actor: string; authType: string | null; role: string | null },
): void {
  try {
    const db = getDb();
    try {
      db.prepare(
        `INSERT INTO mcp_audit (org_id, actor, auth_type, role, tool, args_json, ok, error, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        who.orgId,
        who.actor.slice(0, 200),
        who.authType,
        who.role,
        ev.tool,
        JSON.stringify(ev.args ?? null).slice(0, 4000),
        ev.ok ? 1 : 0,
        ev.error,
        ev.durationMs,
      );
    } finally {
      db.close();
    }
  } catch (e) {
    console.warn("[mcp] audit write failed:", e instanceof Error ? e.message : e);
  }
}

/** Stateless mode has no server-initiated stream or session to delete. */
export function mcpMethodNotAllowed(_req: Request, res: Response): void {
  res
    .status(405)
    .set("Allow", "POST")
    .json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed. POST JSON-RPC to /mcp." }, id: null });
}
