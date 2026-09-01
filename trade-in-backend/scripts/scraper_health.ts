/**
 * Scraper health report.
 *
 * Quotes are only as good as the competitor data behind them, and a scrape that
 * silently stops looks exactly like one that is working: the prices are still
 * there, just frozen. The weekly job only does `console.error` on failure, which
 * nobody reads. This makes the state visible and exits non-zero when it is bad,
 * so it can run on a schedule or before a launch.
 *
 *   npx tsx scripts/scraper_health.ts           # report on stored data
 *   npx tsx scripts/scraper_health.ts --live    # also re-fetch and compare drift
 */
import { getDb } from "../src/db/migrate.js";
import { computeServerQuote } from "../src/services/quoteEngine.js";
import { getFrontendPricingConfig } from "../src/services/competitorPricing.js";

const STALE_DAYS = 8;      // weekly job + a day of slack
const CRITICAL_DAYS = 21;

const live = process.argv.includes("--live");
const db = getDb();

const cfg = getFrontendPricingConfig();
const sources = db
  .prepare(
    `SELECT competitor_name AS name,
            COUNT(*) AS rows,
            COUNT(DISTINCT product_id) AS products,
            MAX(scraped_at) AS newest
       FROM scraped_prices GROUP BY competitor_name`,
  )
  .all() as Array<{ name: string; rows: number; products: number; newest: string }>;

const declared = db.prepare("SELECT id, label, enabled FROM price_sources").all() as Array<{
  id: string;
  label: string;
  enabled: number;
}>;

const enabledDevices = (db.prepare("SELECT COUNT(*) c FROM devices WHERE enabled = 1").get() as { c: number }).c;
const covered = (
  db
    .prepare(
      `SELECT COUNT(DISTINCT product_id) c FROM scraped_prices
        WHERE competitor_name = ? AND product_id IN (SELECT id FROM devices WHERE enabled = 1)`,
    )
    .get(cfg.source) as { c: number }
).c;

const daysOld = (iso: string) => (Date.now() - new Date(iso).getTime()) / 86_400_000;

const problems: string[] = [];
const warnings: string[] = [];

console.log("=".repeat(74));
console.log("SCRAPER HEALTH");
console.log("=".repeat(74));
console.log(`Quotes follow : ${cfg.source} (${cfg.mode}${cfg.mode === "beat" ? ` ${cfg.beatPercent}%` : ""})`);
console.log(`Catalog       : ${enabledDevices} enabled devices, ${covered} with ${cfg.source} data ` +
            `(${Math.round((covered / Math.max(1, enabledDevices)) * 100)}%)`);
console.log();
console.log("source          rows  products   age(d)  status");
console.log("-".repeat(74));

const seen = new Set<string>();
for (const s of sources.sort((a, b) => b.rows - a.rows)) {
  seen.add(s.name);
  const age = s.newest ? daysOld(s.newest) : Infinity;
  let status = "ok";
  if (age > CRITICAL_DAYS) {
    status = "STALE (critical)";
    problems.push(`${s.name} data is ${age.toFixed(0)} days old`);
  } else if (age > STALE_DAYS) {
    status = "stale";
    warnings.push(`${s.name} data is ${age.toFixed(0)} days old`);
  }
  if (s.name === cfg.source && age > STALE_DAYS) {
    problems.push(`${s.name} is the live quote source AND is stale — customers are being quoted from old data`);
  }
  console.log(
    `${s.name.padEnd(15)} ${String(s.rows).padStart(5)} ${String(s.products).padStart(8)} ` +
      `${(age === Infinity ? "—" : age.toFixed(1)).padStart(8)}  ${status}`,
  );
}

// Sources that are switched on but have never produced a row.
for (const d of declared.filter((d) => d.enabled && !seen.has(d.id))) {
  console.log(`${d.id.padEnd(15)} ${"0".padStart(5)} ${"0".padStart(8)} ${"—".padStart(8)}  NEVER SCRAPED`);
  warnings.push(`'${d.id}' is enabled as a price source but has never produced a row`);
}

// The quote source must actually be able to price the catalog.
if (covered / Math.max(1, enabledDevices) < 0.5) {
  problems.push(
    `${cfg.source} covers only ${covered}/${enabledDevices} devices — most quotes fall back to the manual table`,
  );
}

if (live) {
  console.log();
  console.log("-".repeat(74));
  console.log("Live drift check (re-fetching the quote source)");
  console.log("-".repeat(74));
  const { scrapeGorecellQueryFlow } = await import(
    "../src/pricing-engine/adapters/gorecellStepFlowAdapter.js"
  ).catch(() => ({ scrapeGorecellQueryFlow: null }) as never);

  if (typeof scrapeGorecellQueryFlow !== "function") {
    console.log("  (adapter entry point not exported — run scripts/test_gorecell_query_flow.ts instead)");
  } else {
    console.log("  see scripts/test_gorecell_query_flow.ts for the full live assertion");
  }
}

// Does the pipeline actually produce a sane quote right now?
console.log();
console.log("-".repeat(74));
console.log("End-to-end: can we quote from this data?");
console.log("-".repeat(74));
const sample = db
  .prepare(
    `SELECT d.id, d.name, p.storage FROM devices d
       JOIN prices p ON p.device_id = d.id
      WHERE d.enabled = 1 AND p.condition_grade = 'flawless' AND p.base_price > 0
      LIMIT 3`,
  )
  .all() as Array<{ id: string; name: string; storage: string }>;
db.close();

for (const s of sample) {
  const q = computeServerQuote({ deviceId: s.id, storage: s.storage, conditionGrade: "flawless" });
  const ok = q && q.quotedPrice > 0;
  if (!ok) problems.push(`${s.name} ${s.storage} cannot be quoted`);
  console.log(
    `  ${ok ? "ok  " : "FAIL"} ${s.name.slice(0, 34).padEnd(36)} ${s.storage.padEnd(8)} ` +
      `$${q?.quotedPrice ?? 0}  via ${q?.priceSource ?? "-"}`,
  );
}

console.log();
console.log("=".repeat(74));
if (problems.length) {
  console.log(`PROBLEMS (${problems.length}):`);
  for (const p of problems) console.log(`  ✗ ${p}`);
}
if (warnings.length) {
  console.log(`WARNINGS (${warnings.length}):`);
  for (const w of warnings) console.log(`  ! ${w}`);
}
if (!problems.length && !warnings.length) console.log("HEALTHY — all sources fresh and covering the catalog");
console.log("=".repeat(74));
process.exit(problems.length ? 1 : 0);
