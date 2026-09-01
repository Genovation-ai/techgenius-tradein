/**
 * Audit the prices customers are ACTUALLY quoted.
 *
 * Auditing the `prices` table is not enough. With `frontend_price_source` set to
 * a competitor, resolveFrontendBasePrice reads live `scraped_prices` first and
 * only falls back to the `prices` table on a miss — so a clean table can still
 * sit behind an inverted quote. This walks every enabled device/storage/grade
 * through the real resolution path and reports contradictions in the output.
 *
 * Run: npx tsx scripts/audit_effective_quotes.ts
 */
import { getDb } from "../src/db/migrate.js";
import { computeServerQuote } from "../src/services/quoteEngine.js";

const GRADES = ["defective", "fair", "average", "good", "flawless"] as const; // worst -> best

function storageGb(storage: string): number {
  const s = storage.trim().toLowerCase().replace(/\s/g, "");
  const m = s.match(/^([\d.]+)(tb|gb)$/);
  if (!m) return -1;
  return parseFloat(m[1]) * (m[2] === "tb" ? 1024 : 1);
}

/**
 * Drive capacity or memory config? On laptops the importer mixed both into one
 * list, and comparing 16GB of RAM against 1TB of SSD as a single ladder is
 * meaningless — it manufactured most of the storage warnings in this audit.
 * No machine in this catalog ships a drive at or below 64GB.
 */
function specKind(value: string, category: string): "storage" | "memory" | "other" {
  const gb = storageGb(value);
  if (gb < 0) return "other";
  if ((category === "laptop" || category === "computer") && gb <= 64) return "memory";
  return "storage";
}

const db = getDb();
// Mirror what /api/catalog/devices actually serves a customer: enabled AND
// carrying at least one price. Devices with no price are hidden from the
// catalog, so they cannot produce a bad quote — they are reported separately
// as a pricing to-do rather than counted as a customer-facing failure.
const devices = db
  .prepare(
    `SELECT id, name, storages, category_id FROM devices
      WHERE enabled = 1
        AND EXISTS (SELECT 1 FROM prices p WHERE p.device_id = devices.id AND p.base_price > 0)`,
  )
  .all() as Array<{ id: string; name: string; storages: string; category_id: string }>;

const hidden = db
  .prepare(
    `SELECT name FROM devices
      WHERE enabled = 1
        AND NOT EXISTS (SELECT 1 FROM prices p WHERE p.device_id = devices.id AND p.base_price > 0)`,
  )
  .all() as Array<{ name: string }>;
db.close();

let checked = 0;
const gradeInversions: string[] = [];
const storageInversions: string[] = [];
const unquotable: string[] = [];
const sourceCount = new Map<string, number>();

for (const device of devices) {
  let storages: string[] = [];
  try {
    storages = JSON.parse(device.storages || "[]");
  } catch {
    storages = [];
  }
  if (!storages.length) storages = ["default"];

  const priceByStorageGrade = new Map<string, number>();

  for (const storage of storages) {
    const prices: Array<{ grade: string; price: number }> = [];
    for (const grade of GRADES) {
      const r = computeServerQuote({
        deviceId: device.id,
        storage,
        conditionGrade: grade,
      });
      checked += 1;
      sourceCount.set(r?.priceSource ?? "(no price)", (sourceCount.get(r?.priceSource ?? "(no price)") ?? 0) + 1);
      if (r && r.quotedPrice > 0) {
        prices.push({ grade, price: r.quotedPrice });
        priceByStorageGrade.set(`${storage}|${grade}`, r.quotedPrice);
      }
    }
    if (!prices.length) {
      unquotable.push(`${device.name} [${storage}]`);
      continue;
    }
    // Ladder: price must not rise as condition worsens.
    for (let i = 0; i < prices.length - 1; i++) {
      const worse = prices[i];
      const better = prices[i + 1];
      if (better.price < worse.price - 0.5) {
        gradeInversions.push(
          `${device.name} [${storage}] ${better.grade}=$${better.price} BELOW ${worse.grade}=$${worse.price}`,
        );
      }
    }
  }

  // Ladder across capacities, per grade.
  for (const grade of GRADES) {
    // Compare within one spec axis at a time.
    for (const axis of ["storage", "memory"] as const) {
      const ranked = storages
        .map((s) => ({ s, gb: storageGb(s), p: priceByStorageGrade.get(`${s}|${grade}`) }))
        .filter((r) => r.gb > 0 && r.p !== undefined && specKind(r.s, device.category_id) === axis)
        .sort((a, b) => a.gb - b.gb);
      for (let i = 0; i < ranked.length - 1; i++) {
        if (ranked[i + 1].p! < ranked[i].p! - 0.5) {
          storageInversions.push(
            `${device.name} ${grade} (${axis}): ${ranked[i + 1].s}=$${ranked[i + 1].p} BELOW ${ranked[i].s}=$${ranked[i].p}`,
          );
        }
      }
    }
  }
}

function show(title: string, rows: string[], limit = 10) {
  console.log("\n" + "-".repeat(78));
  console.log(`${title}: ${rows.length}`);
  console.log("-".repeat(78));
  for (const r of rows.slice(0, limit)) console.log("  " + r);
  if (rows.length > limit) console.log(`  … and ${rows.length - limit} more`);
}

console.log("=".repeat(78));
console.log("EFFECTIVE QUOTE AUDIT — what the customer is actually offered");
console.log("=".repeat(78));
console.log(`Devices          : ${devices.length}`);
console.log(`Quotes evaluated : ${checked}`);
console.log("\nResolved via:");
for (const [source, count] of [...sourceCount].sort((a, b) => b[1] - a[1])) {
  console.log(`   ${source.padEnd(28)} ${count}`);
}

show("BLOCKING — better condition quoted BELOW worse condition", gradeInversions);
show("BLOCKING — bigger storage quoted BELOW smaller", storageInversions);
show("Device/storage combos that cannot be quoted at all", unquotable);
show("Hidden from the customer catalog until priced (not a customer-facing fault)",
     hidden.map((h) => h.name));

const blocking = gradeInversions.length + storageInversions.length;
console.log("\n" + "=".repeat(78));
console.log(`BLOCKING: ${blocking}   unquotable combos: ${unquotable.length}`);
console.log("=".repeat(78));
process.exit(blocking ? 1 : 0);
