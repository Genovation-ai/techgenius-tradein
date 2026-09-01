/**
 * Unit tests for shared device matcher.
 * Run: npx tsx scripts/test_device_match.ts
 */
import {
  capacitiesMatch,
  capacityToGb,
  matchDeviceTitle,
  modifiersMatch,
  normalizeCapacity,
  normalizeStorageLabel,
  pickBestTitleMatch,
  storageLookupKeys,
} from "../src/pricing-engine/deviceMatch.js";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed += 1;
    console.error("FAIL:", msg);
  } else {
    console.log("  ok:", msg);
  }
}

console.log("\n=== deviceMatch unit tests ===\n");

assert(normalizeCapacity("128 GB") === "128gb", "normalize 128 GB");
assert(capacitiesMatch("128GB", "128 GB"), "capacity 128GB ~ 128 GB");
assert(!capacitiesMatch("128GB", "256GB"), "capacity 128 != 256");
assert(capacitiesMatch("1TB", "1024GB"), "1TB ~ 1024GB");
assert(capacitiesMatch("iPhone 15 128GB", "128GB"), "glued title still matches 128GB");
assert(capacityToGb("218gb") === 218, "218gb is 218 not 8");
assert(capacityToGb("iphone15128gb") === 128, "glued iphone15128gb → 128");
assert(normalizeStorageLabel("1024GB") === "1TB", "normalize 1024GB → 1TB");
assert(storageLookupKeys("1024GB").includes("1TB"), "lookup keys include 1TB");

assert(modifiersMatch("iPhone 15", "iPhone 15 128GB"), "base vs base");
assert(!modifiersMatch("iPhone 15", "iPhone 15 Pro 128GB"), "base vs Pro");
assert(!modifiersMatch("iPhone 15 Pro", "iPhone 15 Pro Max 256GB"), "Pro vs Pro Max");
assert(modifiersMatch("iPhone 15 Pro Max", "iPhone 15 Pro Max 256GB"), "Pro Max vs Pro Max");
assert(!modifiersMatch("Galaxy S24", "Galaxy S24 Ultra 256GB"), "S24 vs Ultra");
assert(modifiersMatch("Galaxy S24 Ultra", "Galaxy S24 Ultra 256GB"), "Ultra vs Ultra");
assert(!modifiersMatch("Pixel 9 Pro", "Pixel 9 Pro XL 128GB"), "Pro vs Pro XL");
assert(!modifiersMatch("iPhone 13", "iPhone 13 mini 128GB"), "13 vs mini");
assert(!modifiersMatch("iPhone 15", "iPhone 15 Plus 128GB"), "base vs Plus");

assert(
  matchDeviceTitle({ title: "iPhone 15 128GB", model: "iPhone 15", variant: "128GB" }),
  "exact iPhone 15 128",
);
assert(
  !matchDeviceTitle({ title: "iPhone 15 Pro 128GB", model: "iPhone 15", variant: "128GB" }),
  "reject Pro for base",
);
assert(
  !matchDeviceTitle({ title: "iPhone 15 256GB", model: "iPhone 15", variant: "128GB" }),
  "reject wrong storage",
);
assert(
  !matchDeviceTitle({ title: "Galaxy S24 Ultra 256GB", model: "Galaxy S24", variant: "256GB" }),
  "reject Ultra for base S24",
);
assert(
  matchDeviceTitle({ title: "Galaxy S24 Ultra 256GB", model: "Galaxy S24 Ultra", variant: "256GB" }),
  "accept Ultra",
);

const catalog = [
  { product_title: "iPhone 15 Plus 128GB", product_code: "PLUS" },
  { product_title: "iPhone 15 Pro 128GB", product_code: "PRO" },
  { product_title: "iPhone 15 128GB", product_code: "BASE" },
  { product_title: "iPhone 15 Pro Max 256GB", product_code: "MAX" },
];
const hit = pickBestTitleMatch(catalog, {
  getTitle: (p) => p.product_title,
  model: "iPhone 15",
  variant: "128GB",
});
assert(hit?.product_code === "BASE", `pick base not Plus/Pro (got ${hit?.product_code})`);

const ultra = pickBestTitleMatch(
  [
    { product_title: "Galaxy S24 256GB", product_code: "S24" },
    { product_title: "Galaxy S24 Ultra 256GB", product_code: "ULTRA" },
  ],
  { getTitle: (p) => p.product_title, model: "Galaxy S24 Ultra", variant: "256GB" },
);
assert(ultra?.product_code === "ULTRA", "pick Ultra");

const telusHit = pickBestTitleMatch(
  [
    {
      title: "PIXEL 9 PRO 128GB",
      storageCd: "128 GB",
    },
    {
      title: "PIXEL 9 128GB",
      storageCd: "128 GB",
    },
    {
      title: "PIXEL 9 PRO XL 128GB",
      storageCd: "128 GB",
    },
  ],
  {
    getTitle: (p) => p.title,
    getStorage: (p) => p.storageCd,
    model: "Pixel 9",
    variant: "128GB",
  },
);
assert(telusHit?.title === "PIXEL 9 128GB", `TELUS base Pixel 9 (got ${telusHit?.title})`);

if (failed) {
  console.error(`\n${failed} deviceMatch test(s) failed\n`);
  process.exit(1);
}
console.log("\nPASS — deviceMatch\n");
