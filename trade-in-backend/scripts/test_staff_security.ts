/**
 * Staff-login isolation and the read-only staff role, plus the MCP resources
 * and guided routines. LOCAL instance on a copy of the database.
 *
 *   MCP_URL=http://localhost:4199 MCP_KEY=<master> npx tsx scripts/test_staff_security.ts
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

async function rest(method: string, path: string, key: string | null, body?: unknown) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(key ? { "x-api-key": key } : {}), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data: data as Record<string, unknown> & { users?: Array<{ email: string; id: string; role: string }> } };
}

async function main() {
  const stamp = Date.now().toString(36);

  console.log("== staff lists are per shop ==");
  const home = await rest("GET", "/api/team", MASTER);
  const homeUsers = home.data.users ?? [];
  ok("home shop sees its staff", home.status === 200 && homeUsers.length > 0, `${homeUsers.length} users`);
  ok("viewer is offered as a role", JSON.stringify(home.data.roles).includes("viewer"));

  const signup = await rest("POST", "/api/saas/signup", null, {
    company_name: "Other Shop",
    slug: `other${stamp}`,
    admin_name: "Other",
    email: `other-${stamp}@example.invalid`,
    password: "Other-Shop-Passw0rd!",
  });
  const tenant = String(signup.data.token ?? "");
  ok("another shop can sign up", signup.status === 201 && !!tenant);
  const theirs = await rest("GET", "/api/team", tenant);
  const leaked = (theirs.data.users ?? []).filter((u) => homeUsers.some((h) => h.email === u.email));
  ok("another shop does not see our staff", theirs.status === 200 && leaked.length === 0, `${(theirs.data.users ?? []).length} visible`);

  const homeAdmin = homeUsers.find((u) => u.role === "admin")!;
  const takeover = await rest("PATCH", `/api/team/${homeAdmin.id}`, tenant, { password: "Hijacked-Passw0rd-1" });
  ok("another shop cannot reset our admin's password", takeover.status === 404, String(takeover.status));
  const demote = await rest("PATCH", `/api/team/${homeAdmin.id}`, tenant, { enabled: false });
  ok("another shop cannot disable our admin", demote.status === 404, String(demote.status));

  console.log("== roles are parsed strictly ==");
  const bogus = await rest("POST", "/api/team", MASTER, { email: `bogus-${stamp}@example.invalid`, name: "x", password: "Passw0rd-Strong", role: "superuser" });
  ok("unknown role refused (used to become admin)", bogus.status === 400, String(bogus.status));
  const shortPw = await rest("PATCH", `/api/team/${homeAdmin.id}`, MASTER, { password: "short" });
  ok("short password refused on change (used to be ignored silently)", shortPw.status === 400, String(shortPw.status));

  console.log("== read-only staff login ==");
  const vEmail = `viewer-${stamp}@example.invalid`;
  const made = await rest("POST", "/api/team", MASTER, { email: vEmail, name: "Read Only", password: "Viewer-Passw0rd-1", role: "viewer" });
  ok("create a read-only staff login", made.status === 201 && made.data.role === "viewer");
  const login = await rest("POST", "/api/auth/login", null, { email: vEmail, password: "Viewer-Passw0rd-1" });
  const vt = String(login.data.token ?? "");
  ok("read-only login signs in", login.status === 200 && !!vt);
  ok("can read offers", (await rest("GET", "/api/offers?limit=1", vt)).status === 200);
  ok("can read pricing", (await rest("GET", "/api/pricing/frontend-source", vt)).status === 200);
  ok("cannot change pricing", (await rest("PUT", "/api/pricing/frontend-source", vt, { mode: "match" })).status === 403);
  ok("cannot change an offer", (await rest("PATCH", "/api/offers/x/status", vt, { status: "completed" })).status === 403);
  ok("cannot add staff", (await rest("POST", "/api/team", vt, { email: "z@example.invalid", name: "z", password: "zzzzzzzz1", role: "admin" })).status === 403);
  const caps = await rest("GET", "/api/team/me/capabilities", vt);
  ok("capabilities say viewer", caps.data.role === "viewer", String(caps.data.role));

  console.log("== MCP resources and routines ==");
  const c = new Client({ name: "res-check", version: "1" });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { requestInit: { headers: { "x-api-key": vt } } }));
  const { resources } = await c.listResources();
  ok("resources are offered", resources.length >= 7, resources.map((r) => r.uri).join(" "));
  const guide = await c.readResource({ uri: "gadgetswap://guide" });
  ok("platform guide reads", JSON.stringify(guide).includes("Offer lifecycle"));
  const rule = await c.readResource({ uri: "gadgetswap://pricing/rule" });
  ok("live pricing rule reads", JSON.stringify(rule).includes("beatPercent"));
  const { prompts } = await c.listPrompts();
  const names = prompts.map((p) => p.name);
  ok("guided routines offered", ["fix_stale_prices", "daily_briefing", "competitor_review", "triage_offers"].every((n) => names.includes(n)), names.join(","));
  const cr = await c.getPrompt({ name: "competitor_review", arguments: { device: "iPhone 15" } });
  ok("competitor_review renders", JSON.stringify(cr).includes("compare_competitors"));
  const tools = (await c.listTools()).tools.map((t) => t.name);
  ok("read-only staff gets no write tools over MCP", !tools.includes("book_repair") && !tools.includes("set_pricing_rule"), `${tools.length} tools`);
  await c.close();

  console.log(`\nPASS ${pass}  FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
