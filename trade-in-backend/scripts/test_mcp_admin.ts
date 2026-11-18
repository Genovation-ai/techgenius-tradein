/**
 * Exercises the full-access MCP tools (catalogue, pricing, settings, customers,
 * inventory, invoices, repairs, team, stores, maintenance, api_request) against
 * a LOCAL instance on a copy of the database.
 *
 *   MCP_URL=http://localhost:4199 MCP_KEY=<admin key> MCP_OPERATOR_KEY=<operator session> npx tsx scripts/test_mcp_admin.ts
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const URL_BASE = process.env.MCP_URL || "http://localhost:4100";
let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean, detail = "") => {
  cond ? pass++ : fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}  ${detail}`);
};
type R = { isError?: boolean; content: Array<{ text?: string }> };
const txt = (r: R) => r.content.map((c) => c.text ?? "").join("");
const json = (r: R) => {
  try {
    return JSON.parse(txt(r));
  } catch {
    return {};
  }
};

async function connect(key: string) {
  const c = new Client({ name: "mcp-admin-e2e", version: "1" });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${URL_BASE}/mcp`), { requestInit: { headers: { "x-api-key": key } } }));
  return c;
}

async function main() {
  const c = await connect(process.env.MCP_KEY!);
  const call = async (name: string, args: Record<string, unknown> = {}) => (await c.callTool({ name, arguments: args })) as R;
  const { tools } = await c.listTools();
  ok("tool count", tools.length >= 85, String(tools.length));
  const stamp = Date.now().toString(36);

  console.log("== catalogue ==");
  const add = await call("add_device", { name: `Zeta Phone ${stamp}`, category_id: "smartphone", seed_prices: true });
  const dev = json(add).device ?? json(add);
  ok("add_device", !add.isError && !!dev.id, `${dev.id} storages=${JSON.stringify(dev.storages)}`);
  const id = dev.id as string;
  const upd = await call("update_device", { device_id: id, name: `Zeta Phone ${stamp} Pro`, enabled: false });
  ok("update_device (rename + hide, boolean enabled)", !upd.isError, txt(upd).slice(0, 80));
  const hidden = json(await call("search_devices", { q: stamp }));
  ok("hidden device no longer listed to customers", Array.isArray(hidden) && hidden.length === 0, `n=${hidden.length}`);
  ok("update_device (show again)", !(await call("update_device", { device_id: id, enabled: true })).isError);
  ok("list_conditions", !(await call("list_conditions")).isError);

  console.log("== pricing ==");
  const storage = (dev.storages?.[0] as string) || "128GB";
  const bulk = await call("set_device_prices_bulk", {
    prices: [
      { device_id: id, storage, condition_grade: "flawless", base_price: 300 },
      { device_id: id, storage, condition_grade: "good", base_price: 250 },
    ],
  });
  ok("set_device_prices_bulk", !bulk.isError, txt(bulk).slice(0, 60));
  const rows = json(await call("get_device_prices", { device_id: id }));
  ok("bulk prices stored", Array.isArray(rows) && rows.some((r: { base_price: number }) => r.base_price === 300));
  const badAdj = await call("add_price_adjustment", { adjust_amount: 431 });
  ok("add_price_adjustment refuses +$431 global", !!badAdj.isError);

  console.log("== settings / promos / workflow / widget ==");
  const before = json(await call("get_settings"));
  ok("get_settings", typeof before === "object" && "company_name" in before, String(before.company_name));
  const us = await call("update_settings", { settings: { company_phone: "905-555-0199" } });
  const after = json(await call("get_settings"));
  ok("update_settings", !us.isError && after.company_phone === "905-555-0199");
  await call("update_settings", { settings: { company_phone: before.company_phone ?? "" } });
  const code = `MCP${stamp}`.toUpperCase().slice(0, 20);
  ok("create_promo", !(await call("create_promo", { code, discount_percent: 3 })).isError);
  ok("update_promo (deactivate)", !(await call("update_promo", { code, active: false })).isError);
  ok("get_workflow", !(await call("get_workflow")).isError);
  ok("get_widget_template", !(await call("get_widget_template")).isError);

  console.log("== customers / inventory / invoices ==");
  const cu = await call("create_customer", { first_name: "Mcp", last_name: stamp, email: `mcp-${stamp}@example.invalid` });
  const cid = json(cu).id;
  ok("create_customer", !cu.isError && !!cid, cid);
  ok("update_customer", !(await call("update_customer", { customer_id: cid, notes: "from MCP" })).isError);
  const inv = await call("add_inventory_item", { device_name: `Zeta ${stamp}`, condition_grade: "good", cost: 120 });
  const iid = json(inv).id;
  ok("add_inventory_item", !inv.isError && !!iid, iid);
  const listed = json(await call("list_inventory", { q: stamp }));
  ok("manual stock shows in this shop's inventory", JSON.stringify(listed).includes(iid));
  ok("update_inventory_item", !(await call("update_inventory_item", { inventory_id: iid, status: "listed", sell_price: 199 })).isError);
  ok("bulk_update_inventory", !(await call("bulk_update_inventory", { ids: [iid], status: "available" })).isError);
  ok("sell_inventory_item", !(await call("sell_inventory_item", { inventory_id: iid, sell_price: 199 })).isError);

  console.log("== repairs ==");
  ok("get_repair_pricing", !(await call("get_repair_pricing")).isError);
  const rp = json(await call("get_repair_pricing"));
  const s0 = rp.settings ?? {};
  ok("set_repair_settings", !(await call("set_repair_settings", { labour_fee: Number(s0.labour_fee ?? s0.labourFee ?? 40) })).isError);

  console.log("== team / org / stores ==");
  ok("list_team", !(await call("list_team")).isError);
  const tm = await call("add_team_member", { email: `mcp-${stamp}@example.invalid`, name: "MCP Test", password: "Temp-Passw0rd-1", role: "operator" });
  const uid = json(tm).id;
  ok("add_team_member", !tm.isError && !!uid, uid);
  ok("update_team_member (disable)", !(await call("update_team_member", { user_id: uid, enabled: false })).isError);
  ok("get_organization", !(await call("get_organization")).isError);
  const st = await call("add_store", { name: `MCP Store ${stamp}` });
  const sid = json(st).id ?? json(st).store?.id;
  if (st.isError && txt(st).includes("402")) {
    ok("add_store (plan store limit reached, refused with upgrade notice)", true);
  } else {
    ok("add_store", !st.isError && !!sid, sid);
    ok("update_store (disable)", !(await call("update_store", { store_id: sid, enabled: false })).isError);
  }

  console.log("== maintenance / generic ==");
  ok("take_backup", !(await call("take_backup")).isError);
  ok("list_backups", !(await call("list_backups")).isError);
  ok("email_outbox", !(await call("email_outbox")).isError);
  const ar = await call("api_request", { method: "GET", path: "/api/reports/summary" });
  ok("api_request GET", !ar.isError);
  const esc = await call("api_request", { method: "GET", path: "/etc/passwd" });
  ok("api_request refuses paths outside /api/", !!esc.isError);
  const dots = await call("api_request", { method: "GET", path: "/api/../admin" });
  ok("api_request refuses ..", !!dots.isError);
  await c.close();

  if (process.env.MCP_OPERATOR_KEY) {
    console.log("== operator key limits ==");
    const o = await connect(process.env.MCP_OPERATOR_KEY);
    const oc = async (name: string, args: Record<string, unknown>) => (await o.callTool({ name, arguments: args })) as R;
    ok("operator cannot edit a device", !!(await oc("update_device", { device_id: id, name: "x" })).isError);
    ok("operator cannot add team members", !!(await oc("add_team_member", { email: "x@example.invalid", name: "x", password: "xxxxxxxx1", role: "admin" })).isError);
    ok("operator cannot bulk-set prices", !!(await oc("set_device_prices_bulk", { prices: [{ device_id: id, storage, condition_grade: "good", base_price: 1 }] })).isError);
    ok("operator cannot use api_request to reach pricing writes", !!(await oc("api_request", { method: "PUT", path: "/api/pricing/frontend-source", body: { mode: "match" } })).isError);
    await o.close();
  }

  console.log(`\nPASS ${pass}  FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
