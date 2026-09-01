/** Pricing-engine shared types (device trade-in product schema). */

/**
 * Competitor scrape enums.
 * GoRecell has 5 tiers: Like New / Good / Fair / Cracked / Defective.
 * We keep Fair and Cracked distinct so store average ≠ fair (Cracked/Issues).
 */
export type CompetitorCondition = "excellent" | "good" | "fair" | "cracked" | "broken";

/** Maps our store grades ↔ scraper enum */
export type StoreCondition =
  | "flawless"
  | "good"
  | "average"
  | "fair"
  | "defective";

export const STORE_TO_COMPETITOR: Record<StoreCondition, CompetitorCondition> = {
  flawless: "excellent",
  good: "good",
  average: "fair",
  fair: "cracked",
  defective: "broken",
};

export const COMPETITOR_TO_STORE: Record<CompetitorCondition, StoreCondition> = {
  excellent: "flawless",
  good: "good",
  fair: "average",
  cracked: "fair",
  broken: "defective",
};

export interface ToScrape {
  productId: string;
  make: string;
  model: string;
  variant: string; // storage e.g. "256GB"
  url?: string;
  selectors?: Partial<Record<CompetitorCondition | StoreCondition, string>>;
  meta?: Record<string, unknown>;
}

export interface ScrapedPrice {
  competitor_name: string;
  make: string;
  model: string;
  product_id: string | null;
  variant: string;
  condition: CompetitorCondition;
  trade_in_price: number | null;
  sell_price: number | null;
  currency: string;
  raw: {
    source: string;
    payload?: unknown;
    engine?: string;
  };
  scraped_at: string;
}

export interface ScraperResult {
  provider: string;
  engine: "cheerio" | "playwright" | "scrapling" | "dual";
  rows: ScrapedPrice[];
  errors: string[];
  durationMs: number;
  targeted: number;
  discovered: number;
}

export interface ProviderAdapter {
  readonly name: string;
  readonly engine: ScraperResult["engine"];
  scrape(devices: ToScrape[], opts?: { timeoutMs?: number }): Promise<ScraperResult>;
}

export type SignalSource =
  | "completed_orders"
  | "per_unit_internal"
  | "confirmed_sales"
  | "market_wholesale"
  | "competitor_scrape"
  | "synthetic"
  | "manual_override";

export interface TrainingSample {
  productId: string;
  variant: string;
  condition: CompetitorCondition;
  price: number;
  source: SignalSource;
  observedAt: string; // ISO
  weight?: number; // optional override
}

export interface PriceBaseline {
  variantKey: string;
  productId: string;
  variant: string;
  condition: CompetitorCondition;
  baselinePrice: number;
  sampleCount: number;
  sourceBreakdown: Record<string, number>;
}

export type PricingModelId = "competitor-beat" | "data-driven" | "simple-margin";

export interface QuoteContext {
  productId: string;
  variant: string;
  condition: CompetitorCondition | StoreCondition;
  msrpOrCost?: number;
  model?: PricingModelId;
  competitorBeatPercent?: number; // default 0.03 = 3% undercut
}

export interface QuoteResult {
  model: PricingModelId;
  quotedPrice: number;
  baseline: number | null;
  competitorBest: number | null;
  floor: number | null;
  meta: Record<string, unknown>;
}

export function variantKey(
  productId: string,
  variant: string,
  condition: CompetitorCondition,
): string {
  return `${productId}|${variant}|${condition}`;
}

/** Normalize competitor / loose labels → CompetitorCondition. Prefer STORE_TO_COMPETITOR for store grades. */
export function normalizeCondition(c: string): CompetitorCondition | null {
  const x = c.toLowerCase().trim();
  if (x === "excellent" || x === "flawless" || x === "like-new" || x === "like_new" || x === "pristine") {
    return "excellent";
  }
  if (x === "good" || x === "great") return "good";
  if (x === "average" || x === "noticeable" || x === "noticeable-wear") return "fair";
  if (x === "cracked" || x === "cracked-issues" || x === "issues") return "cracked";
  if (x === "fair") return "fair"; // competitor Fair (GoRecell Fair), not store fair
  if (x === "broken" || x === "defective" || x === "poor" || x === "as-is" || x === "as_is") {
    return "broken";
  }
  return null;
}
