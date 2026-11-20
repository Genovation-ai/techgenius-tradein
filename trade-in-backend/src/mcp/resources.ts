import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { RunFn } from "./tools.js";

/**
 * Reference material an assistant can read without calling a tool, plus the
 * guided routines (prompts) for recurring jobs.
 */

type Api = (method: string, path: string) => Promise<{ ok: boolean; status: number; data: unknown }>;

const GUIDE = `# Gadget Swap — how the platform works

## Condition grades (best to worst)
flawless · good · average · fair (cracked or has issues) · defective.
GoRecell tiers map: Like New = flawless, Good = good, Fair = average, Cracked = fair, Defective = defective.

## How a quote is made
1. The pricing rule picks a source (GoRecell, UniverCell, Bell, TELUS, "best", or the shop's own manual table)
   and a mode: match, or beat by a percent.
2. The competitor's latest price for that device, storage and grade is the reference; beat % comes off it.
3. A worse grade is never quoted above a better one, and a smaller storage never above a bigger one.
4. Adjustments, Unlocked (+4%), store credit (+5%), battery health and promo codes apply next.
5. The final quote is capped at the competitor's own price for that grade.

## Offer lifecycle
active_lead → in_transit → delivered → being_inspected → completed (issues an invoice, adds stock)
Also: cancelled, returned. Payouts: pending → ready → processing → paid (marks the invoice paid) or failed.

## When a scraper fails
find_pricing_gaps → rescrape_device if mapped → otherwise set_competitor_price with numbers from the
competitor's own site, after the user approves. The next good scrape replaces manual entries.

## Rules for assistants
- Prices are CAD.
- Ask before anything that changes prices, payouts, staff or settings.
- Never invent a competitor price.
- The shop's own name and branding in settings belong to the shop; do not change them unless asked.
`;

function json(uri: string, data: unknown) {
  return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }] };
}

export function registerResourcesAndPrompts(server: McpServer, api: Api, _run: RunFn): void {
  const live = (name: string, uri: string, title: string, description: string, path: string) =>
    server.registerResource(name, uri, { title, description, mimeType: "application/json" }, async () => {
      const r = await api("GET", path);
      return json(uri, r.ok ? r.data : { error: `HTTP ${r.status}`, detail: r.data });
    });

  server.registerResource(
    "platform-guide",
    "gadgetswap://guide",
    { title: "How Gadget Swap works", description: "Grades, quote pipeline, offer lifecycle and rules for assistants.", mimeType: "text/markdown" },
    async () => ({ contents: [{ uri: "gadgetswap://guide", mimeType: "text/markdown", text: GUIDE }] }),
  );
  live("pricing-rule", "gadgetswap://pricing/rule", "Pricing rule", "Source followed and match/beat percent.", "/api/pricing/frontend-source");
  live("pricing-health", "gadgetswap://pricing/health", "Pricing freshness", "Stale competitor sources and catalogue coverage.", "/api/pricing/freshness");
  live("price-adjustments", "gadgetswap://pricing/adjustments", "Price adjustments", "Adjustments applied to every quote.", "/api/pricing/adjustments");
  live("catalog-categories", "gadgetswap://catalog/categories", "Device categories", "Categories in the catalogue.", "/api/catalog/categories");
  live("offer-workflow", "gadgetswap://offers/workflow", "Offer workflow", "Offer stages and which email the customer.", "/api/settings/workflow");
  live("dashboard", "gadgetswap://dashboard", "Dashboard", "Today's pipeline counts and values.", "/api/dashboard");

  server.registerPrompt(
    "daily_briefing",
    { title: "Daily briefing", description: "What needs attention today: pipeline, payouts, stale prices, leads." },
    () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              "Give me today's Gadget Swap briefing.",
              "1. dashboard for the pipeline numbers.",
              "2. list_offers with status being_inspected and delivered — what is waiting on us.",
              "3. list_payouts with status ready — who is owed money.",
              "4. list_leads (open) — quotes worth following up.",
              "5. pricing_health and find_pricing_gaps (limit 10) — any stale prices.",
              "Keep it short: a few bullets per section, and end with the three most important actions. Read only; change nothing.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "competitor_review",
    {
      title: "Competitor review for a device",
      description: "Compare what we pay with every competitor, grade by grade, and suggest whether to move.",
      argsSchema: { device: z.string().describe("Device name or id, e.g. 'iPhone 15'") },
    },
    ({ device }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `Review our pricing for ${device}.`,
              "1. search_devices to find it, then for each storage: compare_competitors and get_quote for every grade.",
              "2. Show a table: grade, our quote, GoRecell, UniverCell, Bell (max), gap to the best competitor.",
              "3. Flag any grade where we are above a competitor or more than 10% below the best.",
              "4. Suggest a change (pricing rule or a specific competitor-price correction) but do not apply it until I say yes.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "triage_offers",
    { title: "Triage incoming offers", description: "Work through delivered offers: inspect, regrade, complete." },
    () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              "Help me work through incoming trade-ins.",
              "1. list_offers status=delivered and status=being_inspected.",
              "2. For each, get_offer and summarise devices, quoted price and customer.",
              "3. Ask me for the inspected condition of each device, then regrade_offer_item and show the new price.",
              "4. When I confirm, update_offer_status to completed (this issues the invoice and adds stock).",
              "One offer at a time; never complete or change a payout without my yes.",
            ].join("\n"),
          },
        },
      ],
    }),
  );
}
