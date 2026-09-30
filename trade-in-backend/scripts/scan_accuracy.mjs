#!/usr/bin/env node
/**
 * How often the scan was right, and which way it was wrong.
 *
 * Every completed trade-in already produces the pair that would train or test
 * a grader: photographs, the grade the scan suggested from them, the grade the
 * customer claimed, and — once the device is in hand and inspected — the grade
 * it actually was. All four are already stored. Nothing has ever joined them,
 * so the scan's accuracy has never been a number, and "make the scanner
 * better" has never had a way to know whether it worked.
 *
 * Direction matters more than the raw rate. Grading a device below what it
 * turns out to be costs the shop a customer who felt lowballed; grading it
 * above costs the shop the difference, every time, and an argument at the
 * counter. Those are different failures and a single accuracy percentage hides
 * which one is happening.
 *
 *   node scripts/scan_accuracy.mjs [--db path] [--export out.jsonl]
 *
 * --export writes one line per inspected device: the photographs, what was
 * predicted and what was true. That file is the training set, and it does not
 * exist until real devices have been through real hands. It is the only honest
 * road to a model; there is no shortcut that does not involve the shop
 * grading devices for a few months first.
 */

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const argOf = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
};

const DB_PATH =
  argOf("--db") ||
  process.env.TG_DB_PATH ||
  path.resolve(import.meta.dirname, "../data/tradein.db");

if (!fs.existsSync(DB_PATH)) {
  console.error(`No database at ${DB_PATH}`);
  process.exit(1);
}

const db = new Database(DB_PATH, { readonly: true });

// Grades in the order the price list uses them, so "one grade optimistic" is
// a meaningful distance rather than a string comparison.
const ORDER = ["flawless", "good", "fair", "poor", "defective"];
const rank = (g) => {
  const i = ORDER.indexOf(String(g || "").toLowerCase());
  return i < 0 ? null : i;
};

const rows = db
  .prepare(
    `SELECT
       o.id              AS offer_id,
       o.ai_scan_json    AS scan_json,
       oi.id             AS item_id,
       oi.device_name    AS device,
       oi.condition_grade AS claimed,
       inv.condition_grade AS verified,
       o.created_at      AS created_at
     FROM offers o
     JOIN offer_items oi ON oi.offer_id = o.id
     JOIN inventory inv  ON inv.offer_item_id = oi.id
     WHERE inv.condition_grade IS NOT NULL`,
  )
  .all();

if (rows.length === 0) {
  console.log(`
  No inspected devices yet.

  This report needs trade-ins that have been received and graded by hand —
  an offer, its items, and an inventory row carrying the grade the device
  turned out to be. Until devices come in and get inspected there is nothing
  to check the scan against, and no training data either.

  That is the whole answer to "train it on ten thousand images": the ten
  thousand have to be real devices this shop has actually held. Roughly a
  thousand makes the accuracy figure below trustworthy. Nothing else is
  needed; the photographs and predictions are already being kept.
`);
  process.exit(0);
}

const exportPath = argOf("--export");
const lines = [];
const photos = db.prepare(
  "SELECT storage_path, angle FROM uploads WHERE offer_id = ?",
);

let withScan = 0;
let exact = 0;
let optimistic = 0; // scan said better than it was — the expensive direction
let pessimistic = 0;
const confusion = new Map();

for (const r of rows) {
  let suggested = null;
  if (r.scan_json) {
    try {
      suggested = JSON.parse(r.scan_json)?.suggestedGrade ?? null;
    } catch {
      // A scan we cannot read is a scan we do not count.
    }
  }

  const v = rank(r.verified);
  const s = rank(suggested);

  if (s !== null && v !== null) {
    withScan++;
    if (s === v) exact++;
    else if (s < v) optimistic++;
    else pessimistic++;
    const key = `${suggested} -> ${r.verified}`;
    confusion.set(key, (confusion.get(key) ?? 0) + 1);
  }

  if (exportPath) {
    lines.push(
      JSON.stringify({
        offer_id: r.offer_id,
        device: r.device,
        photos: photos.all(r.offer_id).map((p) => ({
          path: p.storage_path,
          angle: p.angle ?? null,
        })),
        predicted: suggested,
        claimed: r.claimed,
        verified: r.verified,
        created_at: r.created_at,
      }),
    );
  }
}

const pct = (n) => (withScan ? `${((n / withScan) * 100).toFixed(1)}%` : "n/a");

console.log(`
  Inspected devices:        ${rows.length}
  With a readable scan:     ${withScan}
`);

if (withScan > 0) {
  console.log(`  Scan agreed with inspection:  ${exact} (${pct(exact)})`);
  console.log(`  Scan too optimistic:          ${optimistic} (${pct(optimistic)})   <- costs the shop`);
  console.log(`  Scan too harsh:               ${pessimistic} (${pct(pessimistic)})   <- costs the customer`);
  console.log(`\n  Predicted -> actual`);
  for (const [k, n] of [...confusion].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`    ${k.padEnd(28)} ${n}`);
  }
  if (withScan < 200) {
    console.log(
      `\n  ${withScan} graded devices is too few to trust these figures.\n  They settle somewhere past a thousand.`,
    );
  }
}

if (exportPath) {
  fs.writeFileSync(exportPath, lines.join("\n") + "\n");
  console.log(`\n  Wrote ${lines.length} labelled examples to ${exportPath}`);
}
console.log("");
