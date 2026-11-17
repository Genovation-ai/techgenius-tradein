import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * Gadget Swap as an MCP server: what an AI assistant can look up and do.
 *
 * Every tool calls the platform's own REST API with the caller's key rather
 * than touching the database. That keeps one source of truth for behaviour
 * and, more importantly, for permissions: an operator key cannot change
 * pricing, a tenant key only sees its own offers, and so on, exactly as in the
 * admin console.
 */

export interface McpApiConfig {
  /** Where the REST API lives, e.g. http://127.0.0.1:4100 or https://www.gadgetswap.store */
  baseUrl: string;
  /** Session token (tg_sess_…), org key (tg_live_…) or master key. */
  apiKey: string;
}

type Query = Record<string, string | number | boolean | undefined | null>;

const LOOKUP = { readOnlyHint: true, openWorldHint: false } as const;
const CHANGE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const MONEY = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } as const;

const GRADE = z
  .enum(["flawless", "good", "average", "fair", "defective"])
  .describe("Store condition grade, best to worst: flawless, good, average, fair (cracked/issues), defective");

export function createGadgetSwapMcp(cfg: McpApiConfig): McpServer {
  const base = cfg.baseUrl.replace(/\/$/, "");

  async function api(method: string, path: string, opts: { query?: Query; body?: unknown } = {}) {
    const url = new URL(base + path);
    for (const [k, v] of Object.entries(opts.query || {})) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
    const res = await fetch(url, {
      method,
      headers: {
        "x-api-key": cfg.apiKey,
        accept: "application/json, text/html",
        ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch {
      /* HTML print pages and the like stay as text */
    }
    return { ok: res.ok, status: res.status, data };
  }

  /** Turn an API response into a tool result; HTTP errors become tool errors the model can read. */
  async function run(method: string, path: string, opts: { query?: Query; body?: unknown } = {}) {
    const r = await api(method, path, opts);
    const payload = typeof r.data === "string" ? r.data : JSON.stringify(r.data, null, 2);
    if (!r.ok) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: `HTTP ${r.status} ${method} ${path}: ${payload.slice(0, 2000)}` }],
      };
    }
    // Large lists are clipped so one call cannot flood the model's context.
    const clipped = payload.length > 60_000 ? `${payload.slice(0, 60_000)}\n…(truncated, narrow the query)` : payload;
    return { content: [{ type: "text" as const, text: clipped }] };
  }

  const enc = encodeURIComponent;
  const server = new McpServer(
    { name: "gadget-swap", version: "1.0.0" },
    {
      instructions:
        "Gadget Swap trade-in and repair platform. Use search_devices to find a device id, then get_quote " +
        "for what the shop pays. Offers move active_lead -> in_transit -> delivered -> being_inspected -> " +
        "completed (completion issues an invoice and adds inventory). Prices are CAD. Tools that change data " +
        "are permission-checked against the API key in use.",
    },
  );

  // ---------- Catalogue & quoting (what a customer sees) ----------
  server.registerTool(
    "search_devices",
    {
      title: "Search devices",
      description: "Find devices in the trade-in catalogue by name or id. Returns ids, names and storage options.",
      inputSchema: {
        q: z.string().optional().describe("Name or id fragment, e.g. 'iphone 15' or 'galaxy s24'"),
        category_id: z.string().optional().describe("smartphone, tablet, laptop, smartwatch, ..."),
        brand_id: z.string().optional(),
        include_prices: z.boolean().optional().describe("Include the price table per device"),
        limit: z.number().int().min(1).max(200).optional(),
      },
      annotations: LOOKUP,
    },
    async (a) => run("GET", "/api/catalog/devices", { query: { ...a, limit: a.limit ?? 25 } }),
  );

  server.registerTool(
    "list_categories",
    { title: "List categories", description: "Device categories in the catalogue.", annotations: LOOKUP },
    async () => run("GET", "/api/catalog/categories"),
  );

  server.registerTool(
    "list_brands",
    {
      title: "List brands",
      description: "Brands, optionally within one category.",
      inputSchema: { category_id: z.string().optional() },
      annotations: LOOKUP,
    },
    async (a) => run("GET", "/api/catalog/brands", { query: a }),
  );

  server.registerTool(
    "get_quote",
    {
      title: "Get trade-in quote",
      description:
        "What the shop pays for one device, exactly as the website quotes it. Includes the competitor price it " +
        "was set against and where the price came from.",
      inputSchema: {
        device_id: z.string().describe("Device id from search_devices"),
        storage: z.string().describe("Storage tier exactly as listed, e.g. 128GB"),
        condition_grade: GRADE,
        carrier: z.string().optional().describe("'Unlocked' adds a small premium"),
        battery_health: z.number().min(0).max(100).optional(),
        payout_method: z.enum(["etransfer", "cash", "store-credit"]).optional(),
        promo_code: z.string().optional(),
      },
      annotations: LOOKUP,
    },
    async (a) => run("POST", "/api/quote", { body: a }),
  );

  server.registerTool(
    "bulk_quote",
    {
      title: "Bulk quote",
      description: "Quote several devices at once by name (business lots).",
      inputSchema: {
        items: z
          .array(
            z.object({
              device_name: z.string(),
              storage: z.string().optional(),
              condition_grade: GRADE,
              quantity: z.number().int().min(1).max(500).optional(),
            }),
          )
          .min(1)
          .max(100),
      },
      annotations: LOOKUP,
    },
    async (a) => run("POST", "/api/bulk/quote", { body: a }),
  );

  // ---------- Competitor pricing ----------
  server.registerTool(
    "compare_competitors",
    {
      title: "Compare with competitors",
      description:
        "Side-by-side competitor prices (GoRecell, UniverCell, Bell, TELUS) for one device and storage, plus what the " +
        "shop would quote under the current pricing rule.",
      inputSchema: {
        product_id: z.string().describe("Device id"),
        variant: z.string().describe("Storage, e.g. 256GB"),
        condition: GRADE.optional(),
      },
      annotations: LOOKUP,
    },
    async (a) => run("GET", "/api/pricing/competitors/matrix", { query: a }),
  );

  server.registerTool(
    "list_competitor_prices",
    {
      title: "Latest competitor prices",
      description: "Latest scraped competitor prices, filtered by device id or a name fragment.",
      inputSchema: { product_id: z.string().optional(), q: z.string().optional() },
      annotations: LOOKUP,
    },
    async (a) => run("GET", "/api/pricing/competitors", { query: a }),
  );

  server.registerTool(
    "pricing_health",
    {
      title: "Pricing data freshness",
      description: "Which competitor sources are stale or empty, and how much of the catalogue has live prices.",
      annotations: LOOKUP,
    },
    async () => run("GET", "/api/pricing/freshness"),
  );

  server.registerTool(
    "get_pricing_rule",
    {
      title: "Get pricing rule",
      description: "Which competitor the shop prices against, and whether it matches or beats them (and by how much).",
      annotations: LOOKUP,
    },
    async () => run("GET", "/api/pricing/frontend-source"),
  );

  server.registerTool(
    "set_pricing_rule",
    {
      title: "Set pricing rule",
      description:
        "Change what every customer is quoted: the source to follow and match/beat with a percent. Affects the live " +
        "site immediately.",
      inputSchema: {
        source: z.enum(["manual", "univercell", "bell", "telus", "gorecell", "best"]).optional(),
        mode: z.enum(["match", "beat"]).optional(),
        beat_percent: z.number().min(0).max(25).optional(),
      },
      annotations: MONEY,
    },
    async (a) => run("PUT", "/api/pricing/frontend-source", { body: a }),
  );

  server.registerTool(
    "list_price_adjustments",
    {
      title: "List price adjustments",
      description: "Active global/condition adjustments that multiply every quote.",
      annotations: LOOKUP,
    },
    async () => run("GET", "/api/pricing/adjustments"),
  );

  // ---------- Offers (buyback pipeline) ----------
  server.registerTool(
    "list_offers",
    {
      title: "List offers",
      description: "Trade-in offers, newest first.",
      inputSchema: {
        status: z
          .enum(["active_lead", "in_transit", "delivered", "being_inspected", "completed", "cancelled", "returned"])
          .optional(),
        offer_type: z.enum(["mail-in", "drop-off", "pickup"]).optional(),
        q: z.string().optional().describe("Customer name, email, phone or offer id"),
        limit: z.number().int().min(1).max(200).optional(),
      },
      annotations: LOOKUP,
    },
    async (a) => run("GET", "/api/offers", { query: { ...a, limit: a.limit ?? 25 } }),
  );

  server.registerTool(
    "get_offer",
    {
      title: "Get offer",
      description: "One offer with its devices, customer, invoice and uploads.",
      inputSchema: { offer_id: z.string() },
      annotations: LOOKUP,
    },
    async (a) => run("GET", `/api/offers/${enc(a.offer_id)}`),
  );

  server.registerTool(
    "get_offer_history",
    {
      title: "Offer history",
      description: "Audit trail for one offer: who changed what, and when.",
      inputSchema: { offer_id: z.string() },
      annotations: LOOKUP,
    },
    async (a) => run("GET", `/api/offers/${enc(a.offer_id)}/history`),
  );

  server.registerTool(
    "update_offer_status",
    {
      title: "Move offer status",
      description:
        "Advance or change an offer's status. 'completed' issues the invoice and adds the devices to inventory.",
      inputSchema: {
        offer_id: z.string(),
        status: z.enum([
          "active_lead",
          "in_transit",
          "delivered",
          "being_inspected",
          "completed",
          "cancelled",
          "returned",
        ]),
      },
      annotations: CHANGE,
    },
    async (a) => run("PATCH", `/api/offers/${enc(a.offer_id)}/status`, { body: { status: a.status } }),
  );

  server.registerTool(
    "update_offer",
    {
      title: "Edit offer details",
      description: "Edit notes, tracking, courier or payout method on an offer.",
      inputSchema: {
        offer_id: z.string(),
        notes: z.string().max(2000).optional(),
        tracking_number: z.string().optional(),
        courier: z.string().optional(),
        payout_method: z.string().optional(),
      },
      annotations: CHANGE,
    },
    async ({ offer_id, ...body }) => run("PATCH", `/api/offers/${enc(offer_id)}`, { body }),
  );

  server.registerTool(
    "regrade_offer_item",
    {
      title: "Regrade a device",
      description:
        "After inspection, change one device's condition. Re-prices it on the live price ladder unless a manual price is given.",
      inputSchema: {
        offer_id: z.string(),
        item_id: z.number().int().describe("items[].id from get_offer"),
        condition_grade: GRADE,
        battery_health: z.number().min(0).max(100).optional(),
        price: z.number().min(0).optional().describe("Manual override in CAD"),
      },
      annotations: MONEY,
    },
    async ({ offer_id, item_id, ...body }) =>
      run("PATCH", `/api/offers/${enc(offer_id)}/items/${item_id}/regrade`, { body }),
  );

  server.registerTool(
    "create_staff_offer",
    {
      title: "Create walk-in offer",
      description: "Staff hand-off: create an offer for a customer at the counter or on the phone.",
      inputSchema: {
        contact: z.object({
          first_name: z.string(),
          last_name: z.string(),
          email: z.string().optional(),
          phone: z.string().optional(),
        }),
        items: z
          .array(
            z.object({
              device_id: z.string().optional(),
              device_name: z.string().optional(),
              storage: z.string(),
              condition_grade: GRADE,
              carrier: z.string().optional(),
              battery_health: z.number().optional(),
              imei: z.string().optional(),
            }),
          )
          .min(1)
          .max(50),
        offer_type: z.enum(["drop-off", "mail-in", "pickup"]).optional(),
        payout_method: z.string().optional(),
        notes: z.string().optional(),
      },
      annotations: { ...CHANGE, idempotentHint: false },
    },
    async (a) => run("POST", "/api/offers/handoff", { body: a }),
  );

  server.registerTool(
    "create_shipping_label",
    {
      title: "Create mail-in label",
      description: "Generate the printable mail-in label for an offer. Returns its URL and reference number.",
      inputSchema: {
        offer_id: z.string(),
        courier: z.string().optional(),
        tracking_number: z.string().optional(),
      },
      annotations: CHANGE,
    },
    async ({ offer_id, ...body }) => run("POST", `/api/offers/${enc(offer_id)}/shipping-label`, { body }),
  );

  server.registerTool(
    "list_leads",
    {
      title: "Abandoned quotes",
      description: "Customers who got a quote but did not submit — for follow-up.",
      inputSchema: { status: z.enum(["open", "contacted", "converted", "dismissed"]).optional() },
      annotations: LOOKUP,
    },
    async (a) => run("GET", "/api/offers/leads", { query: { status: a.status ?? "open" } }),
  );

  server.registerTool(
    "update_lead",
    {
      title: "Update lead",
      description: "Mark an abandoned quote as contacted, converted or dismissed.",
      inputSchema: { lead_id: z.string(), status: z.enum(["open", "contacted", "converted", "dismissed"]) },
      annotations: CHANGE,
    },
    async (a) => run("PATCH", `/api/offers/leads/${enc(a.lead_id)}`, { body: { status: a.status } }),
  );

  // ---------- Payouts & invoices ----------
  server.registerTool(
    "list_payouts",
    {
      title: "List payouts",
      description: "Offers awaiting or past payout, with totals.",
      inputSchema: { status: z.enum(["pending", "ready", "processing", "paid", "failed"]).optional() },
      annotations: LOOKUP,
    },
    async (a) => run("GET", "/api/payouts", { query: a }),
  );

  server.registerTool(
    "update_payout",
    {
      title: "Update payout",
      description: "Record a payout's progress. 'paid' also marks the invoice paid. Moves money: confirm with the user first.",
      inputSchema: {
        offer_id: z.string(),
        payout_status: z.enum(["pending", "ready", "processing", "paid", "failed"]),
        payout_method: z.string().optional(),
      },
      annotations: MONEY,
    },
    async ({ offer_id, ...body }) => run("PATCH", `/api/payouts/${enc(offer_id)}`, { body }),
  );

  server.registerTool(
    "list_invoices",
    { title: "List invoices", description: "Recent trade-in invoices.", annotations: LOOKUP },
    async () => run("GET", "/api/invoices"),
  );

  server.registerTool(
    "get_invoice",
    {
      title: "Get invoice",
      description: "One invoice with line items.",
      inputSchema: { invoice_id: z.string() },
      annotations: LOOKUP,
    },
    async (a) => run("GET", `/api/invoices/${enc(a.invoice_id)}`),
  );

  // ---------- Customers & inventory ----------
  server.registerTool(
    "list_customers",
    {
      title: "Find customers",
      description: "Customers, searchable by name, email or phone.",
      inputSchema: { q: z.string().optional() },
      annotations: LOOKUP,
    },
    async (a) => run("GET", "/api/customers", { query: a }),
  );

  server.registerTool(
    "get_customer",
    {
      title: "Get customer",
      description: "One customer and their offers.",
      inputSchema: { customer_id: z.string() },
      annotations: LOOKUP,
    },
    async (a) => run("GET", `/api/customers/${enc(a.customer_id)}`),
  );

  server.registerTool(
    "list_inventory",
    {
      title: "List inventory",
      description: "Bought-in devices in stock.",
      inputSchema: {
        status: z.enum(["available", "reserved", "listed", "sold", "refurbishing"]).optional(),
        q: z.string().optional(),
      },
      annotations: LOOKUP,
    },
    async (a) => run("GET", "/api/inventory", { query: a }),
  );

  server.registerTool(
    "sell_inventory_item",
    {
      title: "Record a sale",
      description: "Mark an inventory device sold at a price.",
      inputSchema: {
        inventory_id: z.string(),
        sell_price: z.number().positive(),
        note: z.string().max(500).optional(),
      },
      annotations: { ...MONEY, idempotentHint: false },
    },
    async ({ inventory_id, ...body }) => run("POST", `/api/inventory/${enc(inventory_id)}/sell`, { body }),
  );

  // ---------- Repairs ----------
  server.registerTool(
    "repair_problems",
    {
      title: "Repair problems",
      description: "Repairable problems for a device (screen, battery, ...).",
      inputSchema: { device_id: z.string() },
      annotations: LOOKUP,
    },
    async (a) => run("GET", "/api/repair/problems", { query: a }),
  );

  server.registerTool(
    "repair_quote",
    {
      title: "Repair quote",
      description: "Price for fixing one problem on one device.",
      inputSchema: { device_id: z.string(), problem: z.string().describe("Problem id from repair_problems") },
      annotations: LOOKUP,
    },
    async (a) => run("POST", "/api/repair/quote", { body: a }),
  );

  server.registerTool(
    "list_repairs",
    {
      title: "List repair jobs",
      description: "Repair bookings.",
      inputSchema: { status: z.string().optional() },
      annotations: LOOKUP,
    },
    async (a) => run("GET", "/api/repairs", { query: a }),
  );

  server.registerTool(
    "update_repair_status",
    {
      title: "Update repair status",
      description: "Move a repair job along (e.g. in_progress, ready, completed).",
      inputSchema: { repair_id: z.string(), status: z.string() },
      annotations: CHANGE,
    },
    async (a) => run("PATCH", `/api/repairs/${enc(a.repair_id)}/status`, { body: { status: a.status } }),
  );

  // ---------- Overview ----------
  server.registerTool(
    "dashboard",
    { title: "Dashboard", description: "Today's numbers: offers, values, pipeline counts.", annotations: LOOKUP },
    async () => run("GET", "/api/dashboard"),
  );

  server.registerTool(
    "reports_summary",
    { title: "Reports", description: "Business summary report.", annotations: LOOKUP },
    async () => run("GET", "/api/reports/summary"),
  );

  server.registerTool(
    "search_everything",
    {
      title: "Global search",
      description: "Search offers, customers, inventory and devices at once.",
      inputSchema: { q: z.string().min(2) },
      annotations: LOOKUP,
    },
    async (a) => run("GET", "/api/search", { query: a }),
  );

  server.registerTool(
    "notifications",
    {
      title: "Notifications",
      description: "Recent in-app notifications (new offers, payouts, labels).",
      inputSchema: { limit: z.number().int().min(1).max(200).optional() },
      annotations: LOOKUP,
    },
    async (a) => run("GET", "/api/notifications", { query: a }),
  );

  server.registerTool(
    "system_status",
    {
      title: "System status",
      description: "Service health, scraper status, shipping/billing readiness and email delivery status.",
      annotations: LOOKUP,
    },
    async () => {
      const parts = await Promise.all([
        api("GET", "/api/health"),
        api("GET", "/api/scraper/status"),
        api("GET", "/api/offers/shipping/status"),
        api("GET", "/api/integrations/status"),
      ]);
      const [health, scraper, shipping, integrations] = parts.map((p) => (p.ok ? p.data : { error: p.status }));
      return {
        content: [
          { type: "text" as const, text: JSON.stringify({ health, scraper, shipping, integrations }, null, 2) },
        ],
      };
    },
  );

  return server;
}
