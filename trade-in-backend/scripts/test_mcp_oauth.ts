/**
 * OAuth sign-in for MCP, driven the way claude.ai drives it: discover from the
 * 401, register dynamically, authorize with PKCE, sign in on the consent page,
 * exchange the code, call tools, refresh. Plus the abuse cases.
 *
 * Run against a LOCAL instance started with TG_APP_URL=http://localhost:4199:
 *   MCP_URL=http://localhost:4199 MCP_KEY=<master> ADMIN_EMAIL=… ADMIN_PASSWORD=… OP_EMAIL=… OP_PASSWORD=… \
 *     npx tsx scripts/test_mcp_oauth.ts
 */
import { createHash, randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const BASE = process.env.MCP_URL || "http://localhost:4100";
const MASTER = process.env.MCP_KEY!;
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";
let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean, detail = "") => {
  cond ? pass++ : fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}  ${detail}`);
};
const b64url = (b: Buffer) => b.toString("base64url");

async function register(redirect = CALLBACK) {
  const r = await fetch(`${BASE}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Claude",
      redirect_uris: [redirect],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, string> };
}

async function startAuthorize(clientId: string, scope = "mcp:manage") {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(8));
  const u = new URL(`${BASE}/authorize`);
  u.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: CALLBACK,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    scope,
    resource: `${BASE}/mcp`,
  }).toString();
  const r = await fetch(u, { redirect: "manual" });
  const html = await r.text();
  const pending = html.match(/name="pending" value="([^"]+)"/)?.[1] ?? "";
  return { status: r.status, html, pending, verifier, state, csp: r.headers.get("content-security-policy") ?? "" };
}

async function consent(pending: string, email: string, password: string, level: string) {
  const r = await fetch(`${BASE}/oauth/consent`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ pending, email, password, level }).toString(),
  });
  const loc = r.headers.get("location") ?? "";
  return { status: r.status, location: loc, text: r.status === 302 ? "" : await r.text() };
}

async function token(params: Record<string, string>) {
  const r = await fetch(`${BASE}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, string | number> };
}

async function fullLogin(clientId: string, email: string, password: string, level: string) {
  const a = await startAuthorize(clientId, `mcp:${level === "viewer" ? "read" : level === "operator" ? "operate" : level === "manager" ? "manage" : "admin"}`);
  const c = await consent(a.pending, email, password, level);
  const code = new URL(c.location || "https://x.invalid").searchParams.get("code") ?? "";
  const t = await token({ grant_type: "authorization_code", code, code_verifier: a.verifier, client_id: clientId, redirect_uri: CALLBACK });
  return { a, c, code, t };
}

async function mcpWith(tok: string) {
  const cl = new Client({ name: "claude-sim", version: "1" });
  await cl.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { requestInit: { headers: { authorization: `Bearer ${tok}` } } }));
  return cl;
}

async function main() {
  console.log("== discovery (what claude.ai does first) ==");
  const first = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
  });
  const www = first.headers.get("www-authenticate") ?? "";
  const prmUrl = www.match(/resource_metadata="([^"]+)"/)?.[1] ?? "";
  ok("401 from /mcp points to resource metadata", first.status === 401 && !!prmUrl, prmUrl);
  const prm = (await (await fetch(prmUrl)).json()) as { resource: string; authorization_servers: string[]; scopes_supported?: string[] };
  ok("protected resource metadata", prm.resource === `${BASE}/mcp` && prm.authorization_servers?.length === 1, JSON.stringify(prm.authorization_servers));
  const asm = (await (await fetch(`${BASE}/.well-known/oauth-authorization-server`)).json()) as Record<string, unknown>;
  ok("authorization server metadata", !!asm.authorization_endpoint && !!asm.token_endpoint && !!asm.registration_endpoint);
  ok("PKCE S256 advertised", JSON.stringify(asm.code_challenge_methods_supported).includes("S256"));

  console.log("== registration ==");
  const reg = await register();
  const clientId = reg.body.client_id;
  ok("dynamic client registration", reg.status === 201 && !!clientId, clientId);
  const bad = await register("javascript:alert(1)");
  ok("javascript: redirect refused", bad.status >= 400, String(bad.status));
  const plain = await register("http://evil.example.com/cb");
  ok("plain-http (non-loopback) redirect refused", plain.status >= 400, String(plain.status));

  console.log("== authorize + consent ==");
  const a1 = await startAuthorize(clientId);
  ok("consent page renders", a1.status === 200 && a1.html.includes("Sign in and allow") && !!a1.pending);
  ok("consent page allows only the callback origin for form redirects", a1.csp.includes("form-action 'self' https://claude.ai") && a1.csp.includes("frame-ancestors 'none'"));
  ok("client name is escaped", !a1.html.includes("<script"));
  const wrong = await consent(a1.pending, process.env.ADMIN_EMAIL!, "not-the-password", "manager");
  ok("wrong password re-renders with an error", wrong.status === 400 && wrong.text.includes("Wrong email or password"));
  const opTooHigh = await consent(a1.pending, process.env.OP_EMAIL!, process.env.OP_PASSWORD!, "admin");
  ok("operator cannot grant admin", opTooHigh.status === 400 && opTooHigh.text.includes("choose that level or lower"));
  const good = await consent(a1.pending, process.env.ADMIN_EMAIL!, process.env.ADMIN_PASSWORD!, "manager");
  const cb = new URL(good.location || "https://x.invalid");
  ok("approval redirects to the callback with code + state", good.status === 302 && cb.origin === "https://claude.ai" && cb.searchParams.get("state") === a1.state && !!cb.searchParams.get("code"));
  const reuse = await consent(a1.pending, process.env.ADMIN_EMAIL!, process.env.ADMIN_PASSWORD!, "manager");
  ok("a consent form cannot be submitted twice", reuse.status === 400);

  console.log("== token exchange ==");
  const code = cb.searchParams.get("code")!;
  const badPkce = await token({ grant_type: "authorization_code", code, code_verifier: b64url(randomBytes(32)), client_id: clientId, redirect_uri: CALLBACK });
  ok("wrong PKCE verifier refused", badPkce.status === 400, String(badPkce.body.error));
  const t1 = await token({ grant_type: "authorization_code", code, code_verifier: a1.verifier, client_id: clientId, redirect_uri: CALLBACK });
  const access = String(t1.body.access_token ?? "");
  const refresh = String(t1.body.refresh_token ?? "");
  ok("code exchanged for access + refresh tokens", t1.status === 200 && access.startsWith("tg_oat_") && refresh.startsWith("tg_ort_"), `expires_in=${t1.body.expires_in} scope=${t1.body.scope}`);

  console.log("== MCP with the token ==");
  const m = await mcpWith(access);
  const tools = (await m.listTools()).tools;
  ok("signed-in assistant gets the tool list", tools.length > 80, String(tools.length));
  const rule = (await m.callTool({ name: "get_pricing_rule", arguments: {} })) as { isError?: boolean };
  ok("read call works", !rule.isError);
  const team = (await m.callTool({ name: "add_team_member", arguments: { email: "x@example.invalid", name: "x", password: "xxxxxxxx1", role: "admin" } })) as { isError?: boolean; content: Array<{ text?: string }> };
  ok("manager-level grant cannot add staff (team:write)", !!team.isError && (team.content[0]?.text ?? "").includes("403"));
  await m.close();
  const act = (await (await fetch(`${BASE}/api/integrations/mcp-activity?limit=5`, { headers: { "x-api-key": MASTER } })).json()) as Array<{ auth_type: string; actor: string }>;
  ok("audit log shows the signed-in staff member", act.some((r) => r.auth_type === "oauth" && r.actor === process.env.ADMIN_EMAIL), act[0]?.actor);

  console.log("== refresh rotation ==");
  const r1 = await token({ grant_type: "refresh_token", refresh_token: refresh, client_id: clientId });
  ok("refresh issues a new pair", r1.status === 200 && r1.body.refresh_token !== refresh);
  const stolen = await token({ grant_type: "refresh_token", refresh_token: refresh, client_id: clientId });
  ok("replayed refresh token refused", stolen.status === 400);
  const afterReuse = await fetch(`${BASE}/api/pricing/frontend-source`, { headers: { authorization: `Bearer ${r1.body.access_token}` } });
  ok("refresh reuse revokes the whole grant", afterReuse.status === 401, String(afterReuse.status));

  console.log("== code replay ==");
  const g2 = await fullLogin(clientId, process.env.ADMIN_EMAIL!, process.env.ADMIN_PASSWORD!, "viewer");
  ok("second sign-in (read-only)", g2.t.status === 200 && g2.t.body.scope === "mcp:read", String(g2.t.body.scope));
  const vm = await mcpWith(String(g2.t.body.access_token));
  const vt = (await vm.listTools()).tools;
  ok("read-only grant sees only read-only tools", vt.every((t) => t.annotations?.readOnlyHint === true), String(vt.length));
  await vm.close();
  const replay = await token({ grant_type: "authorization_code", code: g2.code, code_verifier: g2.a.verifier, client_id: clientId, redirect_uri: CALLBACK });
  ok("authorization code cannot be used twice", replay.status === 400);
  const afterReplay = await fetch(`${BASE}/api/dashboard`, { headers: { authorization: `Bearer ${g2.t.body.access_token}` } });
  ok("code replay revokes tokens from that code's grant", afterReplay.status === 401, String(afterReplay.status));

  console.log("== revocation & disabled staff ==");
  const g3 = await fullLogin(clientId, process.env.ADMIN_EMAIL!, process.env.ADMIN_PASSWORD!, "manager");
  const conns = (await (await fetch(`${BASE}/api/integrations/ai-connections`, { headers: { "x-api-key": MASTER } })).json()) as Array<{ client_id: string; user_id: string; client_name: string }>;
  const mine = conns.find((c) => c.client_id === clientId);
  ok("admin can see the connected assistant", !!mine && mine.client_name === "Claude");
  const del = await fetch(`${BASE}/api/integrations/ai-connections/${clientId}/${mine?.user_id}`, { method: "DELETE", headers: { "x-api-key": MASTER } });
  ok("admin can disconnect it", del.status === 200);
  const dead = await fetch(`${BASE}/api/dashboard`, { headers: { authorization: `Bearer ${g3.t.body.access_token}` } });
  ok("disconnected assistant is refused", dead.status === 401);

  const stamp = Date.now().toString(36);
  const temp = (await (await fetch(`${BASE}/api/team`, {
    method: "POST",
    headers: { "x-api-key": MASTER, "content-type": "application/json" },
    body: JSON.stringify({ email: `oauth-${stamp}@example.invalid`, name: "OAuth Temp", password: "Temp-Passw0rd-7", role: "manager" }),
  })).json()) as { id: string };
  const g4 = await fullLogin(clientId, `oauth-${stamp}@example.invalid`, "Temp-Passw0rd-7", "manager");
  ok("another staff member can connect", g4.t.status === 200);
  await fetch(`${BASE}/api/team/${temp.id}`, { method: "PATCH", headers: { "x-api-key": MASTER, "content-type": "application/json" }, body: JSON.stringify({ enabled: false }) });
  const disabled = await fetch(`${BASE}/api/dashboard`, { headers: { authorization: `Bearer ${g4.t.body.access_token}` } });
  ok("disabling the staff login cuts the assistant off", disabled.status === 401, String(disabled.status));
  const rv = await fetch(`${BASE}/revoke`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: String(g4.t.body.refresh_token), client_id: clientId }).toString() });
  ok("standard /revoke endpoint answers", rv.status === 200, String(rv.status));

  console.log("== API keys still work ==");
  const k = await fetch(`${BASE}/api/dashboard`, { headers: { "x-api-key": MASTER } });
  ok("pasted keys unaffected", k.status === 200);

  console.log(`\nPASS ${pass}  FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
