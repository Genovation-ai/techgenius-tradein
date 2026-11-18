/**
 * Enterprise MCP controls against a LOCAL instance: scoped keys, the read-only
 * tool surface, the audit trail (with secrets redacted) and revocation.
 *
 *   MCP_URL=http://localhost:4199 MCP_KEY=<master key> npx tsx scripts/test_mcp_enterprise.ts
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const BASE = process.env.MCP_URL || "http://localhost:4100";
const MASTER = process.env.MCP_KEY!;
let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean, detail = "") => {
  cond ? pass++ : fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}  ${detail}`);
};
type R = { isError?: boolean; content: Array<{ text?: string }> };
const txt = (r: R) => r.content.map((c) => c.text ?? "").join("");

async function rest(method: string, path: string, key: string, body?: unknown) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "x-api-key": key, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data: data as Record<string, unknown> };
}

async function mcp(key: string) {
  const c = new Client({ name: "mcp-enterprise-e2e", version: "1" });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { requestInit: { headers: { "x-api-key": key } } }));
  return c;
}

async function main() {
  const stamp = Date.now().toString(36);
  const mk = async (role: string) => rest("POST", "/api/saas/org/api-keys", MASTER, { name: `e2e ${role} ${stamp}`, role });

  console.log("== scoped keys ==");
  const v = await mk("viewer");
  const o = await mk("operator");
  const m = await mk("manager");
  ok("create read-only key", v.status === 201 && v.data.role === "viewer");
  ok("create operator key", o.status === 201 && o.data.role === "operator");
  ok("create manager key", m.status === 201 && m.data.role === "manager");
  ok("unknown role refused", (await mk("superuser")).status === 400);
  const viaManager = await rest("POST", "/api/saas/org/api-keys", m.data.api_key as string, { name: "x", role: "admin" });
  ok("a manager key cannot mint an admin key", viaManager.status === 403, String(viaManager.status));

  console.log("== read-only key over MCP ==");
  const vc = await mcp(v.data.api_key as string);
  const vt = (await vc.listTools()).tools;
  const allRead = vt.every((t) => t.annotations?.readOnlyHint === true);
  ok("only read-only tools are offered", allRead && vt.length > 30, `${vt.length} tools`);
  ok("no write tool is even visible", !vt.some((t) => ["set_pricing_rule", "update_device", "api_request", "update_payout"].includes(t.name)));
  const q = (await vc.callTool({ name: "get_quote", arguments: { device_id: "iphone-15", storage: "128GB", condition_grade: "good" } })) as R;
  ok("read-only key can quote", !q.isError, txt(q).slice(0, 40));
  const dash = (await vc.callTool({ name: "dashboard", arguments: {} })) as R;
  ok("read-only key can read the dashboard", !dash.isError);
  await vc.close();
  const directWrite = await rest("PUT", "/api/pricing/frontend-source", v.data.api_key as string, { mode: "match" });
  ok("read-only key is refused on direct REST writes too", directWrite.status === 403, String(directWrite.status));

  console.log("== operator key over MCP ==");
  const oc = await mcp(o.data.api_key as string);
  const ot = (await oc.listTools()).tools.length;
  ok("operator sees the full tool list (writes are permission-checked)", ot > 80, String(ot));
  const opPrice = (await oc.callTool({ name: "set_pricing_rule", arguments: { mode: "match" } })) as R;
  ok("operator refused on pricing", !!opPrice.isError && txt(opPrice).includes("403"));
  await oc.close();

  console.log("== audit trail ==");
  const mc = await mcp(m.data.api_key as string);
  await mc.callTool({ name: "list_offers", arguments: { limit: 1 } });
  await mc.callTool({
    name: "add_team_member",
    arguments: { email: `audit-${stamp}@example.invalid`, name: "Audit Probe", password: "Secret-Passw0rd-99", role: "operator" },
  });
  await mc.callTool({ name: "get_offer", arguments: { offer_id: "does-not-exist" } });
  const act = (await mc.callTool({ name: "ai_activity", arguments: { limit: 50 } })) as R;
  const rows = JSON.parse(txt(act)) as Array<{ tool: string; ok: boolean; args: unknown; role: string; actor: string }>;
  const mine = rows.filter((r) => r.actor.includes(stamp) || r.role);
  ok("tool calls are recorded", rows.some((r) => r.tool === "list_offers"), `${rows.length} rows`);
  const teamRow = rows.find((r) => r.tool === "add_team_member");
  ok("passwords are redacted in the audit log", !!teamRow && !JSON.stringify(teamRow.args).includes("Secret-Passw0rd-99"), JSON.stringify(teamRow?.args).slice(0, 90));
  ok("failed calls are recorded as failed", rows.some((r) => r.tool === "get_offer" && r.ok === false));
  ok("audit rows carry the key's role", mine.some((r) => r.role === "manager"));
  await mc.close();
  const viaRest = await rest("GET", "/api/integrations/mcp-activity?limit=5", MASTER);
  ok("audit log readable in admin", viaRest.status === 200 && Array.isArray(viaRest.data));

  console.log("== revocation ==");
  const del = await rest("DELETE", `/api/saas/org/api-keys/${m.data.id}`, MASTER);
  ok("revoke key", del.status === 200);
  const after = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: { "x-api-key": m.data.api_key as string, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  ok("revoked key is refused by MCP", after.status === 401, String(after.status));
  for (const k of [v, o]) await rest("DELETE", `/api/saas/org/api-keys/${k.data.id}`, MASTER);

  console.log(`\nPASS ${pass}  FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
