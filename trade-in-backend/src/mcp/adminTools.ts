import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * Everything else an admin can do in the console: catalogue, bulk pricing,
 * settings, promos, customers, inventory, invoices, repair pricing, team,
 * stores and maintenance — plus api_request for anything not listed.
 *
 * Same contract as tools.ts: each call goes through the REST API with the
 * caller's key, so an operator key is refused where the console refuses it.
 */

type Run = (
  method: string,
  path: string,
  opts?: { query?: Record<string, string | number | boolean | undefined | null>; body?: unknown },
) => Promise<{ isError?: boolean; content: Array<{ type: "text"; text: string }> }>;

const LOOKUP = { readOnlyHint: true, openWorldHint: false } as const;
const CHANGE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const ADD = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
const MONEY = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } as const;
const GRADE = z.enum(["flawless", "good", "average", "fair", "defective"]);
const enc = encodeURIComponent;

export function registerAdminTools(server: McpServer, run: Run): void {
  // ---------- Catalogue ----------
  server.registerTool(
    "add_device",
    {
      title: "Add a device",
      description:
        "Add a device to the catalogue from its name (e.g. 'Galaxy S26 Ultra'). Finds or builds its image, picks storage " +
        "tiers and seeds starter prices so it can be quoted immediately. Returns the existing device if it is already listed.",
      inputSchema: {
        name: z.string().min(2),
        category_id: z.string().optional().describe("smartphone, tablet, laptop, smartwatch, …"),
        brand_id: z.string().optional(),
        seed_prices: z.boolean().optional().describe("Default true"),
      },
      annotations: ADD,
    },
    async (a) => run("POST", "/api/catalog/devices/from-name", { body: a }),
  );

  server.registerTool(
    "create_device",
    {
      title: "Create a device (manual)",
      description: "Create a device with explicit ids and storage tiers, without image lookup or seeded prices.",
      inputSchema: {
        name: z.string().min(2),
        category_id: z.string(),
        brand_id: z.string(),
        storages: z.array(z.string()).min(1).describe('e.g. ["128GB","256GB"]'),
        image_url: z.string().url().optional(),
      },
      annotations: ADD,
    },
    async (a) => run("POST", "/api/catalog/devices", { body: a }),
  );

  server.registerTool(
    "update_device",
    {
      title: "Edit a device",
      description: "Rename a device, change its storage tiers or image, or hide/show it (enabled=false hides it from customers).",
      inputSchema: {
        device_id: z.string(),
        name: z.string().optional(),
        storages: z.array(z.string()).optional(),
        image_url: z.string().optional(),
        enabled: z.boolean().optional(),
      },
      annotations: CHANGE,
    },
    async ({ device_id, ...body }) => run("PUT", `/api/catalog/devices/${enc(device_id)}`, { body }),
  );

  server.registerTool(
    "add_category",
    {
      title: "Add category",
      description: "Add a device category.",
      inputSchema: { name: z.string(), icon: z.string().optional() },
      annotations: ADD,
    },
    async (a) => run("POST", "/api/catalog/categories", { body: a }),
  );

  server.registerTool(
    "add_brand",
    {
      title: "Add brand",
      description: "Add a brand within a category.",
      inputSchema: { name: z.string(), category_id: z.string() },
      annotations: ADD,
    },
    async (a) => run("POST", "/api/catalog/brands", { body: a }),
  );

  server.registerTool(
    "list_conditions",
    { title: "Condition definitions", description: "Condition groups and grade wording shown to customers.", annotations: LOOKUP },
    async () => run("GET", "/api/catalog/conditions"),
  );

  server.registerTool(
    "add_condition",
    {
      title: "Add condition wording",
      description: "Add a grade description to a condition group.",
      inputSchema: {
        group_id: z.string(),
        grade: GRADE,
        label: z.string(),
        description: z.string().optional(),
        sort_order: z.number().int().optional(),
      },
      annotations: ADD,
    },
    async (a) => run("POST", "/api/catalog/conditions", { body: a }),
  );

  // ---------- Pricing at scale ----------
  server.registerTool(
    "set_device_prices_bulk",
    {
      title: "Set many shop prices",
      description: "Write many rows of the shop's own price table in one call (up to 10,000). Changes live quotes.",
      inputSchema: {
        prices: z
          .array(
            z.object({
              device_id: z.string(),
              storage: z.string(),
              condition_grade: GRADE,
              base_price: z.number().min(0).max(20000),
            }),
          )
          .min(1)
          .max(10000),
      },
      annotations: MONEY,
    },
    async (a) => run("POST", "/api/pricing/bulk", { body: { prices: a.prices.map((p) => ({ ...p, source: "manual" })) } }),
  );

  server.registerTool(
    "apply_competitor_to_catalog",
    {
      title: "Copy competitor prices into the catalogue",
      description:
        "Copy one competitor's latest prices into the shop's price table and make it the live source. Changes live quotes.",
      inputSchema: { competitor: z.enum(["gorecell", "univercell", "bell", "telus"]) },
      annotations: MONEY,
    },
    async (a) => run("POST", "/api/pricing/apply-source", { body: a }),
  );

  server.registerTool(
    "sync_all_gorecell_prices",
    {
      title: "Full GoRecell catalogue sync",
      description:
        "Re-scrape every mapped device from GoRecell (10–20 minutes). Does not change the pricing rule. Use rescrape_device for one.",
      inputSchema: { limit: z.number().int().min(1).optional().describe("Only the first N devices") },
      annotations: { ...CHANGE, openWorldHint: true },
    },
    async (a) => run("POST", "/api/scraper/sync-catalog", { body: { ...a, setFrontend: false } }),
  );

  // ---------- Settings, promos, workflow, widget ----------
  server.registerTool(
    "get_settings",
    { title: "Shop settings", description: "Company name, address, phone, email and other shop settings.", annotations: LOOKUP },
    async () => run("GET", "/api/settings"),
  );

  server.registerTool(
    "update_settings",
    {
      title: "Update shop settings",
      description: "Set one or more shop settings by key, e.g. {company_address: '…', company_phone: '…'}.",
      inputSchema: { settings: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])) },
      annotations: CHANGE,
    },
    async (a) => run("PUT", "/api/settings", { body: a.settings }),
  );

  server.registerTool(
    "list_promos",
    { title: "Promo codes", description: "Promo codes and their boosts.", annotations: LOOKUP },
    async () => run("GET", "/api/settings/promos"),
  );

  server.registerTool(
    "create_promo",
    {
      title: "Create promo code",
      description: "Create a promo code. discount_percent/amount BOOST the customer's offer.",
      inputSchema: {
        code: z.string().min(3).max(30),
        discount_percent: z.number().min(0).max(25).optional(),
        discount_amount: z.number().min(0).max(100).optional(),
        max_uses: z.number().int().min(1).optional(),
        expires_at: z.string().optional().describe("YYYY-MM-DD"),
      },
      annotations: { ...MONEY, idempotentHint: false },
    },
    async (a) => run("POST", "/api/settings/promos", { body: a }),
  );

  server.registerTool(
    "update_promo",
    {
      title: "Edit promo code",
      description: "Turn a promo on/off or change its boost.",
      inputSchema: {
        code: z.string(),
        active: z.boolean().optional(),
        discount_percent: z.number().min(0).max(25).optional(),
        discount_amount: z.number().min(0).max(100).optional(),
      },
      annotations: MONEY,
    },
    async ({ code, active, ...rest }) =>
      run("PATCH", `/api/settings/promos/${enc(code)}`, { body: { ...rest, ...(active == null ? {} : { active: active ? 1 : 0 }) } }),
  );

  server.registerTool(
    "get_workflow",
    { title: "Offer workflow", description: "Offer stages and which send customer emails.", annotations: LOOKUP },
    async () => run("GET", "/api/settings/workflow"),
  );

  server.registerTool(
    "update_workflow_step",
    {
      title: "Edit workflow step",
      description: "Change a stage's label, whether it emails the customer, or the email text.",
      inputSchema: {
        step_id: z.string(),
        label: z.string().optional(),
        send_email: z.boolean().optional(),
        email_template: z.string().optional(),
      },
      annotations: CHANGE,
    },
    async ({ step_id, send_email, ...rest }) =>
      run("PATCH", `/api/settings/workflow/${enc(step_id)}`, {
        body: { ...rest, ...(send_email == null ? {} : { send_email: send_email ? 1 : 0 }) },
      }),
  );

  server.registerTool(
    "get_widget_template",
    { title: "Widget template", description: "The trade-in widget's look and wording.", annotations: LOOKUP },
    async () => run("GET", "/api/settings/widget-template"),
  );

  server.registerTool(
    "update_widget_template",
    {
      title: "Edit widget template",
      description: "Change the widget's template settings (same JSON shape get_widget_template returns).",
      inputSchema: { template: z.record(z.string(), z.unknown()) },
      annotations: CHANGE,
    },
    async (a) => run("PUT", "/api/settings/widget-template", { body: a.template }),
  );

  // ---------- Customers ----------
  server.registerTool(
    "create_customer",
    {
      title: "Add customer",
      description: "Add a customer record.",
      inputSchema: {
        first_name: z.string(),
        last_name: z.string(),
        email: z.string().optional(),
        phone: z.string().optional(),
        company: z.string().optional(),
        notes: z.string().optional(),
      },
      annotations: ADD,
    },
    async (a) => run("POST", "/api/customers", { body: a }),
  );

  server.registerTool(
    "update_customer",
    {
      title: "Edit customer",
      description: "Edit a customer's details or status.",
      inputSchema: {
        customer_id: z.string(),
        first_name: z.string().optional(),
        last_name: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
        company: z.string().optional(),
        status: z.string().optional(),
        notes: z.string().optional(),
      },
      annotations: CHANGE,
    },
    async ({ customer_id, ...body }) => run("PATCH", `/api/customers/${enc(customer_id)}`, { body }),
  );

  // ---------- Inventory & invoices ----------
  server.registerTool(
    "add_inventory_item",
    {
      title: "Add stock",
      description: "Add a device to inventory by hand (purchases outside an offer).",
      inputSchema: {
        device_name: z.string(),
        imei: z.string().optional(),
        condition_grade: GRADE.optional(),
        cost: z.number().min(0),
        sell_price: z.number().min(0).optional(),
      },
      annotations: ADD,
    },
    async (a) => run("POST", "/api/inventory", { body: a }),
  );

  server.registerTool(
    "update_inventory_item",
    {
      title: "Edit stock item",
      description: "Change a stock item's status or asking price.",
      inputSchema: {
        inventory_id: z.string(),
        status: z.enum(["available", "reserved", "listed", "sold", "refurbishing"]).optional(),
        sell_price: z.number().min(0).optional(),
      },
      annotations: CHANGE,
    },
    async ({ inventory_id, ...body }) => run("PATCH", `/api/inventory/${enc(inventory_id)}`, { body }),
  );

  server.registerTool(
    "bulk_update_inventory",
    {
      title: "Bulk stock status",
      description: "Set the same status on many stock items at once.",
      inputSchema: {
        ids: z.array(z.string()).min(1).max(500),
        status: z.enum(["available", "reserved", "listed", "sold", "refurbishing"]),
      },
      annotations: CHANGE,
    },
    async (a) => run("PATCH", "/api/inventory/bulk", { body: a }),
  );

  server.registerTool(
    "create_invoice",
    {
      title: "Issue invoice",
      description: "Issue an invoice for an offer (normally automatic on completion).",
      inputSchema: { offer_id: z.string(), notes: z.string().optional(), force: z.boolean().optional() },
      annotations: ADD,
    },
    async ({ offer_id, ...body }) => run("POST", `/api/invoices/from-offer/${enc(offer_id)}`, { body }),
  );

  server.registerTool(
    "update_invoice",
    {
      title: "Edit invoice",
      description: "Mark an invoice paid or void, or add notes.",
      inputSchema: { invoice_id: z.string(), status: z.enum(["issued", "paid", "void"]).optional(), notes: z.string().optional() },
      annotations: MONEY,
    },
    async ({ invoice_id, ...body }) => run("PATCH", `/api/invoices/${enc(invoice_id)}`, { body }),
  );

  // ---------- Repairs pricing ----------
  server.registerTool(
    "get_repair_pricing",
    { title: "Repair pricing", description: "Markup, labour fee, part costs and the problem list.", annotations: LOOKUP },
    async () => run("GET", "/api/repairs/pricing"),
  );

  server.registerTool(
    "set_repair_settings",
    {
      title: "Repair markup & labour",
      description: "Set the repair markup percent and labour fee.",
      inputSchema: { markup_percent: z.number().min(0).max(300).optional(), labour_fee: z.number().min(0).max(1000).optional() },
      annotations: MONEY,
    },
    async (a) => run("PUT", "/api/repairs/pricing/settings", { body: a }),
  );

  server.registerTool(
    "set_repair_part",
    {
      title: "Repair part price",
      description: "Set the part cost, or a fixed customer price override, for one device + problem.",
      inputSchema: {
        device_id: z.string(),
        problem: z.string(),
        part_cost: z.number().min(0).nullable().optional(),
        override_price: z.number().min(0).nullable().optional(),
      },
      annotations: MONEY,
    },
    async (a) => run("PUT", "/api/repairs/pricing/parts", { body: a }),
  );

  server.registerTool(
    "update_repair",
    {
      title: "Edit repair job",
      description: "Change a repair job's quoted price or notes.",
      inputSchema: { repair_id: z.string(), quoted_price: z.number().min(0).optional(), notes: z.string().optional() },
      annotations: CHANGE,
    },
    async ({ repair_id, ...body }) => run("PATCH", `/api/repairs/${enc(repair_id)}`, { body }),
  );

  server.registerTool(
    "refresh_repair_market",
    {
      title: "Refresh repair part prices",
      description: "Re-scrape part prices from suppliers.",
      annotations: { ...CHANGE, openWorldHint: true },
    },
    async () => run("POST", "/api/repairs/pricing/market/refresh", { body: {} }),
  );

  // ---------- Team, org, stores ----------
  server.registerTool(
    "list_team",
    { title: "Team", description: "Staff logins and roles.", annotations: LOOKUP },
    async () => run("GET", "/api/team"),
  );

  server.registerTool(
    "add_team_member",
    {
      title: "Add staff login",
      description: "Create a staff login. Roles: admin (everything), manager (no team admin), operator (no pricing/settings).",
      inputSchema: {
        email: z.string().email(),
        name: z.string(),
        password: z.string().min(8),
        role: z.enum(["admin", "manager", "operator"]),
      },
      annotations: ADD,
    },
    async (a) => run("POST", "/api/team", { body: a }),
  );

  server.registerTool(
    "update_team_member",
    {
      title: "Edit staff login",
      description: "Change a staff member's name, role, password, or disable them.",
      inputSchema: {
        user_id: z.string(),
        name: z.string().optional(),
        role: z.enum(["admin", "manager", "operator"]).optional(),
        password: z.string().min(8).optional(),
        enabled: z.boolean().optional(),
      },
      annotations: CHANGE,
    },
    async ({ user_id, ...body }) => run("PATCH", `/api/team/${enc(user_id)}`, { body }),
  );

  server.registerTool(
    "get_organization",
    { title: "Organization", description: "The shop account: plan, status, settings.", annotations: LOOKUP },
    async () => run("GET", "/api/saas/org"),
  );

  server.registerTool(
    "list_stores",
    { title: "Stores", description: "Store locations.", annotations: LOOKUP },
    async () => run("GET", "/api/saas/org/stores"),
  );

  server.registerTool(
    "add_store",
    {
      title: "Add store",
      description: "Add a store location.",
      inputSchema: { name: z.string(), address: z.string().optional(), phone: z.string().optional() },
      annotations: ADD,
    },
    async (a) => run("POST", "/api/saas/org/stores", { body: a }),
  );

  server.registerTool(
    "update_store",
    {
      title: "Edit store",
      description: "Edit or disable a store location.",
      inputSchema: {
        store_id: z.string(),
        name: z.string().optional(),
        address: z.string().optional(),
        phone: z.string().optional(),
        enabled: z.boolean().optional(),
      },
      annotations: CHANGE,
    },
    async ({ store_id, enabled, ...rest }) =>
      run("PATCH", `/api/saas/org/stores/${enc(store_id)}`, { body: { ...rest, ...(enabled == null ? {} : { enabled: enabled ? 1 : 0 }) } }),
  );

  // ---------- Maintenance ----------
  server.registerTool(
    "list_backups",
    { title: "Backups", description: "Database snapshots, newest first.", annotations: LOOKUP },
    async () => run("GET", "/api/integrations/backups"),
  );

  server.registerTool(
    "take_backup",
    { title: "Take backup", description: "Snapshot the database now.", annotations: ADD },
    async () => run("POST", "/api/integrations/backups", { body: {} }),
  );

  server.registerTool(
    "email_outbox",
    { title: "Email outbox", description: "Recent customer emails and whether each was sent, queued or failed.", annotations: LOOKUP },
    async () => run("GET", "/api/integrations/email/outbox"),
  );

  server.registerTool(
    "retry_emails",
    {
      title: "Retry queued emails",
      description: "Send emails that were queued while delivery was not configured.",
      inputSchema: { limit: z.number().int().min(1).max(500).optional() },
      annotations: { ...ADD, openWorldHint: true },
    },
    async (a) => run("POST", "/api/integrations/email/flush", { body: a }),
  );

  // ---------- Anything else ----------
  server.registerTool(
    "api_request",
    {
      title: "Call any platform API",
      description:
        "Call any Gadget Swap REST endpoint under /api/ with the current key, for anything the other tools do not cover. " +
        "Same permissions as the admin console. Prefer a dedicated tool when one exists.",
      inputSchema: {
        method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
        path: z
          .string()
          .regex(/^\/api\/[A-Za-z0-9_\-./%]*$/, "path must start with /api/")
          .refine((p) => !p.includes(".."), "path must not contain ..")
          .describe("e.g. /api/offers/TG-123/history"),
        query: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
        body: z.unknown().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async (a) => run(a.method, a.path, { query: a.query, body: a.method === "GET" ? undefined : a.body }),
  );
}
