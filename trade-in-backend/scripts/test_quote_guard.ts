/**
 * Regression: a retired (enabled = 0) device must not be priceable.
 *
 * `/api/quote` and `/api/widget/submit` are public and take a device_id, so
 * hiding a tile from the catalog is not enough on its own — anyone holding a
 * retired id could still be quoted from it. This bit when the duplicate catalog
 * rows were retired: the surviving iPhone 12 quotes ~$245, while a retired
 * duplicate carried a TechAPI retail price of ~$758.
 *
 * Run: npx tsx scripts/test_quote_guard.ts
 */
import { getDb } from "../src/db/migrate.js";
import { computeServerQuote } from "../src/services/quoteEngine.js";

const failures: string[] = [];

function check(label: string, condition: boolean): void {
  if (!condition) failures.push(label);
}

const db = getDb();

// Pick a real enabled device that actually has a flawless price.
const enabled = db
  .prepare(
    `SELECT d.id, d.name, p.storage
       FROM devices d
       JOIN prices p ON p.device_id = d.id
      WHERE d.enabled = 1 AND p.condition_grade = 'flawless' AND p.base_price > 0
      LIMIT 1`,
  )
  .get() as { id: string; name: string; storage: string } | undefined;

// And a retired one that still carries prices — exactly the risky shape.
const retired = db
  .prepare(
    `SELECT d.id, d.name, p.storage, p.base_price
       FROM devices d
       JOIN prices p ON p.device_id = d.id
      WHERE d.enabled = 0 AND p.condition_grade = 'flawless' AND p.base_price > 0
      LIMIT 1`,
  )
  .get() as { id: string; name: string; storage: string; base_price: number } | undefined;

db.close();
const db2 = getDb();

if (!enabled) {
  console.error("No enabled device with a flawless price — cannot run this check.");
  process.exit(1);
}

const good = computeServerQuote({
  deviceId: enabled.id,
  storage: enabled.storage,
  conditionGrade: "flawless",
});
check(
  `enabled device ${enabled.id} should still quote (got ${good ? good.quotedPrice : "null"})`,
  good !== null && good.quotedPrice > 0,
);

if (retired) {
  const bad = computeServerQuote({
    deviceId: retired.id,
    storage: retired.storage,
    conditionGrade: "flawless",
  });
  check(
    `retired device ${retired.id} must NOT quote (its price table still says $${retired.base_price}, got ${
      bad ? bad.quotedPrice : "null"
    })`,
    bad === null,
  );
} else {
  console.log("note: no retired device with prices in this DB — skipped that half.");
}

check(
  "unknown device id must not quote",
  computeServerQuote({ deviceId: "no-such-device-xyz", storage: "128GB", conditionGrade: "flawless" }) === null,
);

// --- Two-axis devices (laptops: drive size AND memory config) ---------------
const twoAxis = db2
  .prepare(
    `SELECT id, name, storages, category_id FROM devices
      WHERE enabled = 1 AND category_id IN ('laptop','computer')
        AND storages LIKE '%TB%' AND storages LIKE '%GB%' LIMIT 1`,
  )
  .get() as { id: string; name: string; storages: string; category_id: string } | undefined;

if (twoAxis) {
  const tiers: string[] = JSON.parse(twoAxis.storages);
  const gb = (v: string) => {
    const m = v.toLowerCase().match(/^([\d.]+)(tb|gb)$/);
    return m ? parseFloat(m[1]) * (m[2] === "tb" ? 1024 : 1) : -1;
  };
  const drives = tiers.filter((v) => gb(v) > 64).sort((a, b) => gb(a) - gb(b));
  const memories = tiers.filter((v) => gb(v) > 0 && gb(v) <= 64).sort((a, b) => gb(a) - gb(b));

  if (drives.length > 1 && memories.length > 1) {
    const priceAt = (d: string, m: string) =>
      computeServerQuote({ deviceId: twoAxis.id, storage: d, memory: m, conditionGrade: "flawless" })
        ?.quotedPrice ?? 0;

    // Raising either spec must never lower the offer.
    let monotonic = true;
    for (const d of drives) {
      for (let i = 0; i < memories.length - 1; i++) {
        if (priceAt(d, memories[i + 1]) < priceAt(d, memories[i])) monotonic = false;
      }
    }
    for (const m of memories) {
      for (let i = 0; i < drives.length - 1; i++) {
        if (priceAt(drives[i + 1], m) < priceAt(drives[i], m)) monotonic = false;
      }
    }
    check(`${twoAxis.name}: price must not fall when a spec is raised`, monotonic);

    // We hold no combination price, so a combination must never be quoted above
    // the best single tier we actually have — otherwise we invented money.
    const best = Math.max(
      ...tiers.map(
        (v) =>
          computeServerQuote({ deviceId: twoAxis.id, storage: v, conditionGrade: "flawless" })
            ?.quotedPrice ?? 0,
      ),
    );
    const top = priceAt(drives[drives.length - 1], memories[memories.length - 1]);
    check(
      `${twoAxis.name}: top configuration ($${top}) must not exceed the best real tier ($${best})`,
      top <= best + 0.5,
    );

    // The cheaper spec decides the price.
    const mixed = computeServerQuote({
      deviceId: twoAxis.id,
      storage: drives[drives.length - 1],
      memory: memories[0],
      conditionGrade: "flawless",
    });
    check(
      `${twoAxis.name}: a low memory tier must limit a high drive tier`,
      mixed?.limitingSpec === memories[0],
    );
  }
} else {
  console.log("note: no two-axis device in this DB — skipped that section.");
}

// --- Storage ladder: a smaller capacity must never out-quote a larger one ---
// Competitors do not publish every grade for every capacity, so the gaps are
// derived per-capacity and can overshoot a real price on a bigger tier.
{
  const db3 = getDb();
  const rows = db3
    .prepare(
      `SELECT id, name, storages FROM devices
        WHERE enabled = 1 AND storages LIKE '%GB%' AND category_id = 'smartphone' LIMIT 25`,
    )
    .all() as Array<{ id: string; name: string; storages: string }>;
  db3.close();

  const gb = (v: string) => {
    const m = v.toLowerCase().match(/^([\d.]+)(tb|gb)$/);
    return m ? parseFloat(m[1]) * (m[2] === "tb" ? 1024 : 1) : -1;
  };

  let inversions = 0;
  let example = "";
  for (const d of rows) {
    let caps: string[] = [];
    try {
      caps = (JSON.parse(d.storages) as string[]).filter((s) => gb(s) > 0).sort((a, b) => gb(a) - gb(b));
    } catch {
      continue;
    }
    for (const grade of ["flawless", "good", "average", "fair", "defective"]) {
      const priced = caps
        .map((s) => ({ s, p: computeServerQuote({ deviceId: d.id, storage: s, conditionGrade: grade })?.quotedPrice ?? 0 }))
        .filter((x) => x.p > 0);
      for (let i = 0; i < priced.length - 1; i++) {
        if (priced[i + 1].p < priced[i].p - 0.5) {
          inversions += 1;
          if (!example) {
            example = `${d.name} ${grade}: ${priced[i + 1].s}=$${priced[i + 1].p} below ${priced[i].s}=$${priced[i].p}`;
          }
        }
      }
    }
  }
  check(`no smaller capacity out-quotes a larger one (${inversions} found${example ? ` — e.g. ${example}` : ""})`, inversions === 0);
}

if (failures.length) {
  console.error(`FAILED — ${failures.length} check(s):`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log("quote guard: all checks passed");
