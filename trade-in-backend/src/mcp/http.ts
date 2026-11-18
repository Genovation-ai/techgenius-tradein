import type { Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { getDb } from "../db/migrate.js";
import { createGadgetSwapMcp, type ToolCallEvent } from "./tools.js";

/**
 * POST /mcp — Streamable HTTP MCP endpoint, stateless.
 *
 * Runs after apiKeyAuth, so the token is already known to be valid. A fresh
 * server per request keeps callers fully separate: each one's tools call the
 * REST API back on loopback with that caller's own token, so the MCP layer can
 * never see or do more than the key could through the admin console.
 */
export async function handleMcpRequest(req: Request, res: Response, port: number): Promise<void> {
  const header = req.headers["x-api-key"];
  const auth = req.headers.authorization;
  const token =
    typeof header === "string" && header
      ? header
      : typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")
        ? auth.slice(7).trim()
        : "";

  const who = req.tgAuth;
  const actor = who?.email || who?.name || who?.userId || who?.type || "unknown";
  const server = createGadgetSwapMcp({
    baseUrl: `http://127.0.0.1:${port}`,
    apiKey: token,
    readOnly: who?.role === "viewer",
    clientTag: "mcp-http",
    onToolCall: (ev) =>
      recordToolCall(ev, { orgId: who?.orgId ?? null, actor, authType: who?.type ?? null, role: who?.role ?? null }),
  });
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
