/**
 * Unit tests for GoRecell query_data price math.
 * Run: npx tsx scripts/test_gorecell_query_flow.ts
 */
import {
  computeQueryFlowPrice,
  parseQueryData,
} from "../src/pricing-engine/adapters/gorecellStepFlowAdapter.js";
import { createGorecellStepFlowAdapter } from "../src/pricing-engine/adapters/gorecellStepFlowAdapter.js";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed += 1;
    console.error("FAIL:", msg);
  } else console.log("  ok:", msg);
}

const storage = { title: "128GB", price: "400", price_formate: "fixed" };
assert(computeQueryFlowPrice(storage, { title: "Like New", price: "", price_formate: "fixed" }) === 400, "Like New 400");
assert(computeQueryFlowPrice(storage, { title: "Good", price: "-13", price_formate: "percent" }) === 348, "Good 348");
assert(computeQueryFlowPrice(storage, { title: "Fair", price: "-26", price_formate: "percent" }) === 296, "Fair 296");
assert(computeQueryFlowPrice(storage, { title: "Cracked", price: "-60", price_formate: "percent" }) === 160, "Cracked 160");
assert(computeQueryFlowPrice(storage, { title: "Defective", price: "-90", price_formate: "percent" }) === 40, "Defective 40");

const sampleHtml = `var query_data = JSON.parse('{"#1":{"title":"What is the storage capacity of your device?","rules":{"#a":{"title":"128GB","desc":"","price":"400","price_formate":"fixed"}}},"#2":{"title":"What is the condition of your device?","rules":{"#b":{"title":"Like New","desc":"","price":"","price_formate":"fixed"},"#c":{"title":"Good","desc":"","price":"-13","price_formate":"percent"}}}}');`;
const parsed = parseQueryData(sampleHtml);
assert(!!parsed && Object.keys(parsed).length === 2, "parseQueryData keys");

async function live() {
  const adapter = createGorecellStepFlowAdapter();
  const result = await adapter.scrape(
    [
      {
        productId: "iphone-15",
        make: "Apple",
        model: "iPhone 15",
        variant: "128GB",
        url: "https://gorecell.ca/product/iphone-15/",
      },
      {
        productId: "iphone-16-pro",
        make: "Apple",
        model: "iPhone 16 Pro",
        variant: "128GB",
      },
    ],
    { timeoutMs: 60_000 },
  );
  console.log("\nLive gorecell rows:");
  for (const r of result.rows) {
    console.log(`  ${r.model} ${r.variant} ${r.condition}: $${r.trade_in_price}`);
  }
  for (const e of result.errors) console.log(" !", e);
  assert(result.rows.length >= 4, `expected >=4 rows got ${result.rows.length}`);
  const ip15ex = result.rows.find(
    (r) => r.product_id === "iphone-15" && r.condition === "excellent" && r.variant === "128GB",
  );
  assert(!!ip15ex && (ip15ex.trade_in_price || 0) >= 100, `iPhone 15 excellent live $${ip15ex?.trade_in_price}`);
}

await live();

if (failed) {
  console.error(`\n${failed} failed\n`);
  process.exit(1);
}
console.log("\nPASS — gorecell query_flow\n");
