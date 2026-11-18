#!/usr/bin/env node
/**
 * Local (stdio) launcher for AI clients that start MCP servers as a process.
 *
 *   GADGETSWAP_API_KEY=tg_live_… GADGETSWAP_URL=https://www.gadgetswap.store \
 *     node dist/mcp/stdio.js
 *
 * Same tools as the hosted /mcp endpoint; calls the REST API over HTTPS.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createGadgetSwapMcp } from "./tools.js";

const apiKey = process.env.GADGETSWAP_API_KEY || "";
const baseUrl = process.env.GADGETSWAP_URL || "https://www.gadgetswap.store";

if (!apiKey) {
  console.error("GADGETSWAP_API_KEY is required (an org API key from Admin → Settings → API keys).");
  process.exit(1);
}

const server = createGadgetSwapMcp({ baseUrl, apiKey, clientTag: "mcp-stdio" });
await server.connect(new StdioServerTransport());
console.error(`[gadget-swap mcp] connected to ${baseUrl}`);
