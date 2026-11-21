/**
 * Auto-match local devices to GoRecell's step-flow catalogue, so the weekly
 * sync has URLs to walk.
 *
 * The weekly GoRecell sync reads settings rows named gorecell_product_map:<id>
 * — one row per device, pointing at GoRecell's internal product id. Rows are
 * seeded on boot from a bundled JSON for the 400-ish devices we built the
 * mapping by hand, but the catalogue has grown since. Any device added after
 * that file was captured ends up unmapped, and the sync passes over it in
 * silence: the health endpoint still reports success and `devices_mapped_for_sync`
 * is the only number that quietly falls behind.
 *
 * This resolver fetches the step-flow page once, parses the `products` list
 * (an inline `var products = [...]`) and tries a small set of deterministic
 * slug matches against each unmapped enabled device. Anything that resolves
 * is written as a new settings row. Nothing already mapped is touched — a
 * manual override stays — and nothing speculative is written: when a device
 * cannot be matched, the row is left blank and the admin sees the
 * devices_mapped_for_sync number stay low on the Pricing freshness banner,
 * which is the signal that this needs a look.
 */

import { getDb } from "../db/migrate.js";

const STEP_FLOW_URL = "https://gorecell.ca/step-flow/";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

interface StepProduct {
  _id?: number | string;
  _name?: string;
  _url?: string;
  name?: string;
}

async function fetchStepFlowProducts(): Promise<StepProduct[]> {
  const res = await fetch(STEP_FLOW_URL, {
    headers: { "user-agent": UA, "accept-language": "en-CA,en;q=0.9" },
  });
  if (!res.ok) throw new Error(`step-flow HTTP ${res.status}`);
  const html = await res.text();
  const m = html.match(/var\s+products\s*=\s*(\[[\s\S]*?\]);/);
  if (!m) throw new Error("step-flow products[] not found in page");
  return JSON.parse(m[1]) as StepProduct[];
}

/**
 * Slug built the same way slugifyDeviceName would — lowercase, hyphens for
 * anything that is not a letter or digit, "+" expanded to " plus " first.
 */
function slugify(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\+/g, " plus ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Candidate slugs for one device. Two most common shapes are the bare slug
 * ("iphone-15") and the brand-prefixed one ("apple-iphone-15"); try both.
 * Also try dropping a leading brand word that may already be inside the id
 * ("samsung-galaxy-s24" ↔ "galaxy-s24"), to match the orphan-remap pattern.
 */
function candidateSlugs(deviceId: string, brandName: string, name: string): string[] {
  const out = new Set<string>();
  const id = slugify(deviceId);
  const n = slugify(name);
  const brand = slugify(brandName || "");
  out.add(id);
  out.add(n);
  if (brand) {
    out.add(`${brand}-${id}`);
    out.add(`${brand}-${n}`);
    // iphone-15 ↔ apple-iphone-15 (the brand prefix strip)
    if (id.startsWith(`${brand}-`)) out.add(id.slice(brand.length + 1));
    if (n.startsWith(`${brand}-`)) out.add(n.slice(brand.length + 1));
  }
  return [...out].filter(Boolean);
}

/** "6" -> "6th". */
function ordinal(n: string): string {
  const v = Number(n);
  const teen = v % 100 >= 11 && v % 100 <= 13;
  const suffix = teen ? "th" : v % 10 === 1 ? "st" : v % 10 === 2 ? "nd" : v % 10 === 3 ? "rd" : "th";
  return `${n}${suffix}`;
}

/**
 * GoRecell often names a model with its year or generation where we do not:
 * "ipad-pro-13-m4" is their "ipad-pro-13-m4-2024", "ipad-mini-6" their
 * "ipad-mini-6th-gen". Accept those two spellings only, and only when exactly
 * one GoRecell product fits, so an ambiguous model ("ipad-air-m2" is both an
 * 11- and a 13-inch) stays unmapped rather than picking up the wrong price.
 */
export function looseMatch(candidates: string[], slugs: string[]): string | null {
  const found = new Set<string>();
  for (const c of candidates) {
    const gen = c.match(/^(.*-)(\d{1,2})$/);
    const genSlug = gen ? `${gen[1]}${ordinal(gen[2])}-gen` : null;
    for (const s of slugs) {
      const noYear = s.replace(/(-20\d\d){1,2}$/, "");
      if (noYear !== s && noYear === c) found.add(s);
      if (genSlug && (s === genSlug || s.replace(/(-20\d\d){1,2}$/, "") === genSlug)) found.add(s);
    }
  }
  return found.size === 1 ? [...found][0] : null;
}

export interface MapResult {
  ok: boolean;
  totalDevices: number;
  alreadyMapped: number;
  newlyMapped: number;
  stillUnmapped: number;
  unmappedExamples: string[];
  errors: string[];
  catalogueSize: number;
}

/**
 * Resolve as many unmapped devices as we can against GoRecell's catalogue.
 * dryRun: true reports what would be written without touching settings.
 */
export async function resolveGorecellProductMap(opts?: {
  dryRun?: boolean;
}): Promise<MapResult> {
  const errors: string[] = [];
  let products: StepProduct[];
  try {
    products = await fetchStepFlowProducts();
  } catch (err) {
    return {
      ok: false,
      totalDevices: 0,
      alreadyMapped: 0,
      newlyMapped: 0,
      stillUnmapped: 0,
      unmappedExamples: [],
      errors: [err instanceof Error ? err.message : String(err)],
      catalogueSize: 0,
    };
  }

  const bySlug = new Map<string, StepProduct>();
  for (const p of products) {
    const url = String(p._url || "");
    const slug = url.match(/\/product\/([^/]+)/)?.[1];
    if (slug && p._id != null) bySlug.set(slug.toLowerCase(), p);
  }

  const db = getDb();
  try {
    const devices = db
      .prepare(
        `SELECT d.id, d.name, b.name AS brand
           FROM devices d
           LEFT JOIN brands b ON b.id = d.brand_id
          WHERE d.enabled = 1`,
      )
      .all() as Array<{ id: string; name: string; brand: string | null }>;

    const mapped = new Set(
      (
        db
          .prepare(
            `SELECT substr(key, length('gorecell_product_map:') + 1) AS id
               FROM settings
              WHERE key LIKE 'gorecell_product_map:%' AND value IS NOT NULL AND value != ''`,
          )
          .all() as Array<{ id: string }>
      ).map((r) => r.id),
    );

    const insert = db.prepare(
      `INSERT INTO settings (key, value, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    );

    let newlyMapped = 0;
    const unmapped: string[] = [];
    const run = db.transaction((rows: typeof devices) => {
      for (const d of rows) {
        if (mapped.has(d.id)) continue;
        const slugs = candidateSlugs(d.id, d.brand ?? "", d.name);
        let hit: StepProduct | undefined;
        for (const s of slugs) {
          const p = bySlug.get(s);
          if (p?._id != null) {
            hit = p;
            break;
          }
        }
        if (!hit) {
          const loose = looseMatch(slugs, [...bySlug.keys()]);
          if (loose) hit = bySlug.get(loose);
        }
        if (hit) {
          if (!opts?.dryRun) insert.run(`gorecell_product_map:${d.id}`, String(hit._id));
          newlyMapped++;
        } else {
          unmapped.push(d.id);
        }
      }
    });
    run(devices);

    return {
      ok: true,
      totalDevices: devices.length,
      alreadyMapped: mapped.size,
      newlyMapped,
      stillUnmapped: unmapped.length,
      // Cap the example list so a huge gap doesn't dump 300 ids into a cron
      // response that someone reads on their phone from the Railway logs.
      unmappedExamples: unmapped.slice(0, 60),
      errors,
      catalogueSize: bySlug.size,
    };
  } finally {
    db.close();
  }
}
