import { z } from "zod";
import type { ScrapedPrice } from "./types.js";
import { normalizeCondition } from "./types.js";

const ScrapedPriceSchema = z.object({
  competitor_name: z.string().min(1),
  make: z.string().min(1),
  model: z.string().min(1),
  product_id: z.string().nullable(),
  variant: z.string().min(1),
  condition: z.enum(["excellent", "good", "fair", "cracked", "broken"]),
  trade_in_price: z.number().positive().nullable(),
  sell_price: z.number().positive().nullable(),
  currency: z.string().min(1).default("CAD"),
  raw: z.object({
    source: z.string().min(1),
    payload: z.unknown().optional(),
    engine: z.string().optional(),
  }),
  scraped_at: z.string().min(1),
});

export function isValidScrapedPrice(row: unknown): row is ScrapedPrice {
  const parsed = ScrapedPriceSchema.safeParse(row);
  if (!parsed.success) return false;
  const r = parsed.data;
  // Must have at least one price
  if (r.trade_in_price == null && r.sell_price == null) return false;
  return true;
}

export function sanitizeScrapedPrice(input: Partial<ScrapedPrice> | Record<string, unknown>): ScrapedPrice | null {
  const row = input as Record<string, unknown>;
  const condition = normalizeCondition(String(row.condition ?? ""));
  if (!condition) return null;

  const trade =
    typeof row.trade_in_price === "number" && row.trade_in_price > 0
      ? row.trade_in_price
      : null;
  const sell =
    typeof row.sell_price === "number" && row.sell_price > 0 ? row.sell_price : null;

  const candidate = {
    competitor_name: String(row.competitor_name ?? "").trim(),
    make: String(row.make ?? "").trim(),
    model: String(row.model ?? "").trim(),
    product_id: row.product_id == null ? null : String(row.product_id),
    variant: String(row.variant ?? "default").trim(),
    condition,
    trade_in_price: trade,
    sell_price: sell,
    currency: String(row.currency ?? "CAD"),
    raw: {
      source: String((row.raw as { source?: string } | undefined)?.source ?? row.source_url ?? ""),
      payload: (row.raw as { payload?: unknown } | undefined)?.payload,
      engine: (row.raw as { engine?: string } | undefined)?.engine,
    },
    scraped_at: String(row.scraped_at ?? new Date().toISOString()),
  };

  return isValidScrapedPrice(candidate) ? candidate : null;
}

export function parsePriceText(text: string): number | null {
  if (!text) return null;
  const m = text.replace(/\xa0/g, " ").match(/\$?\s*(\d[\d,]*(?:\.\d{1,2})?)/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}
