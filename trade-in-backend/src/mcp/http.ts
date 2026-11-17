import type { Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createGadgetSwapMcp } from "./tools.js";

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

  const server = createGadgetSwapMcp({ baseUrl: `http://127.0.0.1:${port}`, apiKey: token });
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

/** Stateless mode has no server-initiated stream or session to delete. */
export function mcpMethodNotAllowed(_req: Request, res: Response): void {
  res
    .status(405)
    .set("Allow", "POST")
    .json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed. POST JSON-RPC to /mcp." }, id: null });
}
