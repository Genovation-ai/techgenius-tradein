/**
 * Connection compatibility: the ways real AI tools reach an MCP server.
 * Streamable HTTP with odd headers, Bearer auth, the legacy SSE transport,
 * raw JSON-RPC, discovery aliases, the browser setup page and the generated
 * configs. LOCAL instance (TG_APP_URL=http://localhost:4199).
 *
 *   MCP_URL=http://localhost:4199 MCP_KEY=<master> npx tsx scripts/test_mcp_connect.ts
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const BASE = process.env.MCP_URL || "http://localhost:4100";
const KEY = process.env.MCP_KEY!;
let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean, detail = "") => {
  cond ? pass++ : fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}  ${detail}`);
};

const INIT = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "raw", version: "1" } },
};

async function rpc(headers: Record<string, string>, body: unknown) {
  const r = await fetch(`${BASE}/mcp`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const text = await r.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: r.status, json };
}

async function main() {
  console.log("== people opening the URL ==");
  const page = await fetch(`${BASE}/mcp`, { headers: { accept: "text/html,application/xhtml+xml" } });
  const html = await page.text();
  ok("browser on /mcp gets the setup page", page.status === 200 && html.includes("Connect an AI assistant"));
  ok("setup page lists the tools", ["Claude", "ChatGPT", "Cursor", "VS Code", "Windsurf", "Gemini CLI", "Codex", "n8n"].every((n) => html.includes(n)));
  ok("setup page never contains a real key", !html.includes(KEY));
  const stream = await fetch(`${BASE}/mcp`, { headers: { accept: "text/event-stream", "x-api-key": KEY } });
  ok("an MCP client's GET still gets 405 (stateless)", stream.status === 405, String(stream.status));
  ok("/connect page", (await fetch(`${BASE}/connect`)).status === 200);
  const cj = (await (await fetch(`${BASE}/connect.json`)).json()) as { clients: Array<{ id: string; config?: { language: string; body: string } }>; mcp_url: string };
  ok("/connect.json guide data", cj.clients.length >= 10 && cj.mcp_url === `${BASE}/mcp`, `${cj.clients.length} tools`);
  const fill = (s: string) => s.replace(/\{\{URL\}\}/g, `${BASE}/mcp`).replace(/\{\{SSE\}\}/g, `${BASE}/sse`).replace(/\{\{KEY\}\}/g, "tg_live_example");
  const badJson = cj.clients.filter((c) => c.config?.language === "json").filter((c) => {
    try {
      JSON.parse(fill(c.config!.body));
      return false;
    } catch {
      return true;
    }
  });
  ok("every generated JSON config is valid JSON", badJson.length === 0, badJson.map((c) => c.id).join(","));

  console.log("== Streamable HTTP, as different clients send it ==");
  for (const [label, headers] of [
    ["spec-compliant Accept", { accept: "application/json, text/event-stream", "x-api-key": KEY }],
    ["Accept: application/json only", { accept: "application/json", "x-api-key": KEY }],
    ["no Accept header", { "x-api-key": KEY }],
    ["Authorization: Bearer", { accept: "application/json, text/event-stream", authorization: `Bearer ${KEY}` }],
  ] as Array<[string, Record<string, string>]>) {
    const r = await rpc(headers, INIT);
    const result = r.json.result as { serverInfo?: { name: string } } | undefined;
    ok(`initialize with ${label}`, r.status === 200 && result?.serverInfo?.name === "gadget-swap", String(r.status));
  }
  const list = await rpc({ "x-api-key": KEY }, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  const tools = ((list.json.result as { tools?: unknown[] })?.tools ?? []).length;
  ok("raw tools/list without a session (stateless)", list.status === 200 && tools > 80, `${tools} tools`);
  const call = await rpc({ "x-api-key": KEY }, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_pricing_rule", arguments: {} } });
  ok("raw tools/call", call.status === 200 && JSON.stringify(call.json).includes("beatPercent"));
  const batch = await rpc({ "x-api-key": KEY }, [
    { jsonrpc: "2.0", id: 4, method: "tools/list", params: {} },
    { jsonrpc: "2.0", id: 5, method: "resources/list", params: {} },
  ]);
  ok("JSON-RPC batch", batch.status === 200, String(batch.status));
  const noKey = await rpc({}, INIT);
  ok("no key: 401", noKey.status === 401);

  console.log("== SDK client, Streamable HTTP with Bearer ==");
  const h = new Client({ name: "bearer", version: "1" });
  await h.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { requestInit: { headers: { authorization: `Bearer ${KEY}` } } }));
  ok("connect + list tools", (await h.listTools()).tools.length > 80);
  await h.close();

  console.log("== legacy SSE transport ==");
  const withKey = (init?: RequestInit) => ({ ...init, headers: { ...(init?.headers as Record<string, string>), "x-api-key": KEY } });
  const s = new Client({ name: "sse-client", version: "1" });
  await s.connect(
    new SSEClientTransport(new URL(`${BASE}/sse`), {
      eventSourceInit: { fetch: (u, init) => fetch(u, withKey(init)) },
      requestInit: { headers: { "x-api-key": KEY } },
    }),
  );
  const st = await s.listTools();
  ok("SSE: connect + list tools", st.tools.length > 80, `${st.tools.length}`);
  const sr = (await s.callTool({ name: "get_quote", arguments: { device_id: "iphone-15", storage: "128GB", condition_grade: "good" } })) as { isError?: boolean };
  ok("SSE: call a tool", !sr.isError);
  ok("SSE: read a resource", JSON.stringify(await s.readResource({ uri: "gadgetswap://guide" })).includes("Offer lifecycle"));
  await s.close();
  const sseNoKey = await fetch(`${BASE}/sse`, { headers: { accept: "text/event-stream" } });
  ok("SSE without a key: 401 with sign-in pointer", sseNoKey.status === 401 && (sseNoKey.headers.get("www-authenticate") ?? "").includes("resource_metadata"));
  const hijack = await fetch(`${BASE}/messages?sessionId=does-not-exist`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": KEY }, body: JSON.stringify(INIT) });
  ok("SSE: unknown session refused", hijack.status === 404);

  console.log("== sign-in discovery aliases ==");
  const prmRoot = (await (await fetch(`${BASE}/.well-known/oauth-protected-resource`)).json()) as { resource: string; authorization_servers: string[] };
  ok("bare /.well-known/oauth-protected-resource", prmRoot.resource === `${BASE}/mcp` && prmRoot.authorization_servers.length === 1);
  const oidc = (await (await fetch(`${BASE}/.well-known/openid-configuration`)).json()) as { token_endpoint: string; registration_endpoint: string };
  ok("/.well-known/openid-configuration", !!oidc.token_endpoint && !!oidc.registration_endpoint);
  const pre = await fetch(`${BASE}/mcp`, { method: "OPTIONS", headers: { origin: "https://example-ai-tool.app", "access-control-request-method": "POST", "access-control-request-headers": "content-type,x-api-key,authorization" } });
  ok("browser-based tools: CORS preflight allowed", pre.status === 204 && !!pre.headers.get("access-control-allow-origin"), String(pre.status));

  console.log(`\nPASS ${pass}  FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
