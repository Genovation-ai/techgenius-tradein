/**
 * End-to-end MCP check with a real client, over HTTP (/mcp) and stdio.
 *
 *   MCP_URL=http://localhost:4199 MCP_KEY=<admin key> MCP_OPERATOR_KEY=<operator session> npx tsx scripts/test_mcp.ts
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const URL_BASE = process.env.MCP_URL || "http://localhost:4100";
const KEY = process.env.MCP_KEY || "";
const OP = process.env.MCP_OPERATOR_KEY || "";
let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}  ${detail}`);
};

type ToolResult = { isError?: boolean; content: Array<{ type: string; text?: string }> };
const text = (r: ToolResult) => r.content.map((c) => c.text ?? "").join("");

async function httpClient(key: string) {
  const c = new Client({ name: "mcp-e2e", version: "1.0.0" });
  await c.connect(
    new StreamableHTTPClientTransport(new URL(`${URL_BASE}/mcp`), { requestInit: { headers: { "x-api-key": key } } }),
  );
  return c;
}

async function main() {
  console.log("== HTTP transport ==");
  const c = await httpClient(KEY);
  const { tools } = await c.listTools();
  ok("lists tools", tools.length >= 45, `${tools.length} tools`);
  ok("tools carry read/write hints", tools.every((t) => t.annotations && "readOnlyHint" in t.annotations));

  const dev = (await c.callTool({ name: "search_devices", arguments: { q: "iphone 15", limit: 3 } })) as ToolResult;
  const devices = JSON.parse(text(dev)) as Array<{ id: string; storages: string[] }>;
  ok("search_devices", !dev.isError && devices.length > 0, devices.map((d) => d.id).join(","));
  const d0 = devices[0];

  const q = (await c.callTool({
    name: "get_quote",
    arguments: { device_id: d0.id, storage: d0.storages[0], condition_grade: "good" },
  })) as ToolResult;
  const quote = JSON.parse(text(q));
  ok("get_quote", !q.isError && quote.quoted_price > 0, `${quote.quoted_price} vs ${quote.competitor_price}`);

  const m = (await c.callTool({
    name: "compare_competitors",
    arguments: { product_id: d0.id, variant: d0.storages[0] },
  })) as ToolResult;
  ok("compare_competitors", !m.isError && text(m).includes("matrix"));

  for (const name of [
    "list_categories",
    "dashboard",
    "list_offers",
    "list_payouts",
    "list_invoices",
    "list_inventory",
    "list_customers",
    "list_leads",
    "list_repairs",
    "get_pricing_rule",
    "pricing_health",
    "list_price_adjustments",
    "reports_summary",
    "notifications",
    "system_status",
  ]) {
    const r = (await c.callTool({ name, arguments: {} })) as ToolResult;
    ok(name, !r.isError, r.isError ? text(r).slice(0, 120) : "");
  }
  const s = (await c.callTool({ name: "search_everything", arguments: { q: "iphone" } })) as ToolResult;
  ok("search_everything", !s.isError);

  const bad = (await c.callTool({ name: "get_offer", arguments: { offer_id: "does-not-exist" } })) as ToolResult;
  ok("unknown offer comes back as a readable tool error", !!bad.isError && text(bad).includes("404"));

  const badArgs = (await c.callTool({ name: "get_quote", arguments: { device_id: "x" } })) as ToolResult;
  ok("schema rejects missing arguments", !!badArgs.isError);

  console.log("== fixing prices when a scraper fails ==");
  const gaps = (await c.callTool({ name: "find_pricing_gaps", arguments: { stale_days: 1, limit: 5 } })) as ToolResult;
  const g = JSON.parse(text(gaps));
  ok("find_pricing_gaps", !gaps.isError && typeof g.gap_count === "number", `${g.gap_count} gaps of ${g.total_pairs}`);
  const prices = (await c.callTool({ name: "get_device_prices", arguments: { device_id: d0.id } })) as ToolResult;
  ok("get_device_prices", !prices.isError);

  const rule = JSON.parse(text((await c.callTool({ name: "get_pricing_rule", arguments: {} })) as ToolResult));
  const set = (await c.callTool({
    name: "set_competitor_price",
    arguments: {
      competitor: rule.source === "best" || rule.source === "manual" ? "gorecell" : rule.source,
      product_id: d0.id,
      variant: d0.storages[0],
      prices: { flawless: 900 + (Date.now() % 90), good: 800 },
      note: "e2e test",
    },
  })) as ToolResult;
  const sr = set.isError ? {} : JSON.parse(text(set));
  ok(
    "set_competitor_price moves the live quote to the entered price",
    !set.isError &&
      sr.customer_quote_after?.flawless <= sr.entered?.flawless &&
      sr.customer_quote_after?.flawless >= Math.floor(sr.entered?.flawless * 0.9),
    `flawless ${sr.customer_quote_before?.flawless} -> ${sr.customer_quote_after?.flawless}`,
  );
  const q2 = JSON.parse(
    text((await c.callTool({
      name: "get_quote",
      arguments: { device_id: d0.id, storage: d0.storages[0], condition_grade: "flawless", payout_method: "store-credit" },
    })) as ToolResult),
  );
  ok("quote still capped at the entered competitor price", q2.quoted_price <= sr.entered?.flawless, `${q2.quoted_price} <= ${sr.entered?.flawless}`);
  const inverted = (await c.callTool({
    name: "set_competitor_price",
    arguments: { competitor: "gorecell", product_id: d0.id, variant: d0.storages[0], prices: { flawless: 100, good: 300 }, note: "x" },
  })) as ToolResult;
  ok("a ladder where good > flawless is refused", !!inverted.isError && text(inverted).includes("400"));
  const badVariant = (await c.callTool({
    name: "set_competitor_price",
    arguments: { competitor: "gorecell", product_id: d0.id, variant: "9TB", prices: { flawless: 100 }, note: "x" },
  })) as ToolResult;
  ok("an unknown storage is refused", !!badVariant.isError && text(badVariant).includes("variant must be one of"));
  const hist = (await c.callTool({ name: "search_everything", arguments: { q: d0.id } })) as ToolResult;
  ok("search still works after writes", !hist.isError);
  const prompts = await c.listPrompts();
  ok("fix_stale_prices prompt is offered", prompts.prompts.some((p) => p.name === "fix_stale_prices"));
  const pr = await c.getPrompt({ name: "fix_stale_prices", arguments: { competitor: "gorecell" } });
  ok("prompt renders", JSON.stringify(pr.messages).includes("find_pricing_gaps"));
  await c.close();

  console.log("== auth ==");
  const noKey = await fetch(`${URL_BASE}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  ok("no key is refused", noKey.status === 401, String(noKey.status));
  const get = await fetch(`${URL_BASE}/mcp`, { headers: { "x-api-key": KEY } });
  ok("GET /mcp is 405 (stateless)", get.status === 405, String(get.status));

  if (OP) {
    const o = await httpClient(OP);
    const r = (await o.callTool({ name: "set_pricing_rule", arguments: { mode: "match" } })) as ToolResult;
    ok("operator key cannot change pricing through MCP", !!r.isError && text(r).includes("403"), text(r).slice(0, 80));
    const r2 = (await o.callTool({
      name: "set_competitor_price",
      arguments: { competitor: "gorecell", product_id: "iphone-15", variant: "128GB", prices: { flawless: 5000 }, note: "x" },
    })) as ToolResult;
    ok("operator key cannot enter competitor prices", !!r2.isError && text(r2).includes("403"));
    await o.close();
  }

  console.log("== stdio transport ==");
  const sc = new Client({ name: "mcp-e2e-stdio", version: "1.0.0" });
  await sc.connect(
    new StdioClientTransport({
      command: "npx",
      args: ["tsx", "src/mcp/stdio.ts"],
      env: { ...process.env, GADGETSWAP_URL: URL_BASE, GADGETSWAP_API_KEY: KEY } as Record<string, string>,
    }),
  );
  const st = await sc.listTools();
  ok("stdio lists tools", st.tools.length >= 45, `${st.tools.length}`);
  const sq = (await sc.callTool({ name: "get_pricing_rule", arguments: {} })) as ToolResult;
  ok("stdio tool call", !sq.isError, text(sq).slice(0, 80));
  await sc.close();

  console.log(`\nPASS ${pass}  FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
