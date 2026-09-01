/**
 * Smoke checks for pricing-engine (run: npx tsx scripts/smoke_pricing_engine.ts)
 */
import { weightedMedian, recencyDecay, effectiveWeight } from "../src/pricing-engine/training/weights.js";
import { sanitizeScrapedPrice, isValidScrapedPrice } from "../src/pricing-engine/validate.js";
import { compareEngineResults } from "../src/pricing-engine/dualMode.js";
import type { ScraperResult, ScrapedPrice } from "../src/pricing-engine/types.js";
import { PricingTraining } from "../src/pricing-engine/training/train.js";
import { migrate } from "../src/db/migrate.js";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

migrate();

assert(
  weightedMedian([
    { value: 10, weight: 1 },
    { value: 20, weight: 1 },
    { value: 100, weight: 0.1 },
  ]) === 20,
  "median resists outlier",
);
assert(recencyDecay(new Date().toISOString()) === 1, "fresh = 1");
assert(effectiveWeight("competitor_scrape", new Date().toISOString()) === 0.6, "competitor weight");

const good = sanitizeScrapedPrice({
  competitor_name: "gorecell",
  make: "Apple",
  model: "iPhone 15",
  product_id: "iphone-15",
  variant: "128GB",
  condition: "flawless",
  trade_in_price: 620,
  sell_price: null,
  currency: "CAD",
  raw: { source: "https://example.com" },
  scraped_at: new Date().toISOString(),
});
assert(good && isValidScrapedPrice(good) && good.condition === "excellent", "sanitize maps flawless→excellent");
assert(
  sanitizeScrapedPrice({ competitor_name: "x", make: "a", model: "b", condition: "good" }) === null,
  "reject no price",
);

const baseRow: ScrapedPrice = good!;
const left: ScraperResult = {
  provider: "a",
  engine: "scrapling",
  rows: [{ ...baseRow, trade_in_price: 100 }],
  errors: [],
  durationMs: 1,
  targeted: 1,
  discovered: 1,
};
const right: ScraperResult = {
  provider: "b",
  engine: "cheerio",
  rows: [{ ...baseRow, trade_in_price: 200 }],
  errors: [],
  durationMs: 1,
  targeted: 1,
  discovered: 1,
};
const diff = compareEngineResults(left, right, { priceDeltaAlertPct: 0.15 });
assert(diff.alert === true, "dual mode should alert on large delta");

const metrics = PricingTraining.train();
assert(metrics.baselinesUpserted > 0, "training should upsert baselines from catalog prices");
console.log("pricing-engine smoke OK", {
  baselinesUpserted: metrics.baselinesUpserted,
  sources: metrics.dataSourcesUsed,
});
