/**
 * SaaS-style device bootstrap: given only a product name, create the catalog
 * entry, build a product image, and seed starter prices (from a similar family
 * device when available).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "../db/migrate.js";

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUILD_SCRIPT = path.resolve(HERE, "../../scripts/build_device_image.py");

const GRADE_MULT: Record<string, number> = {
  flawless: 1,
  good: 0.9,
  average: 0.78,
  fair: 0.4,
  defective: 0.1,
};

export interface ParsedDeviceName {
  displayName: string;
  slug: string;
  brandName: string;
  categoryId: string;
  storages: string[];
}

export interface BootstrapResult {
  created: boolean;
  device: {
    id: string;
    name: string;
    category_id: string;
    brand_id: string;
    storages: string[];
    image_url: string | null;
    enabled: number;
    max_price_flawless?: number;
  };
  image: {
    image_url: string;
    method: string;
  } | null;
  pricesSeeded: number;
  matchedExisting: boolean;
}

export function slugifyDeviceName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\+/g, " plus ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "device";
}

export function parseDeviceName(raw: string, preferredCategory?: string | null): ParsedDeviceName {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.length < 2) {
    throw new Error("Device name is required");
  }

  const lower = cleaned.toLowerCase();
  let brandName = "Other";
  let categoryId = preferredCategory || "smartphone";
  let storages = ["128GB", "256GB", "512GB"];

  if (/iphone|ipad|macbook|imac|mac mini|mac studio|apple watch|watch series|watch ultra|watch se/.test(lower)) {
    brandName = "Apple";
  } else if (/galaxy|samsung|\bz[\s-]?fold|\bz[\s-]?flip|\bs2\d\b/.test(lower)) {
    brandName = "Samsung";
  } else if (/pixel|google/.test(lower)) {
    brandName = "Google";
  } else if (/oneplus|one plus/.test(lower)) {
    brandName = "OnePlus";
  } else if (/nothing/.test(lower)) {
    brandName = "Nothing";
  } else if (/moto|motorola/.test(lower)) {
    brandName = "Motorola";
  } else if (/huawei/.test(lower)) {
    brandName = "Huawei";
  } else if (/surface|xbox/.test(lower)) {
    brandName = "Microsoft";
  } else if (/dell|xps|alienware/.test(lower)) {
    brandName = "Dell";
  } else if (/sony|playstation|ps5|ps4/.test(lower)) {
    brandName = "Sony";
  }

  if (!preferredCategory) {
    if (/ipad|tab\b|tablet|galaxy tab/.test(lower)) categoryId = "tablet";
    else if (/watch|galaxy watch|pixel watch/.test(lower)) categoryId = "smartwatch";
    else if (/macbook|laptop|book|xps|surface laptop|alienware/.test(lower)) categoryId = "laptop";
    else if (/imac|mac mini|mac studio|desktop/.test(lower)) categoryId = "computer";
    else if (/playstation|xbox|switch|steam deck|console/.test(lower)) categoryId = "gaming-console";
    else if (/\bvr\b|vision pro|quest/.test(lower)) categoryId = "vr";
    else categoryId = "smartphone";
  }

  if (categoryId === "smartwatch") storages = ["40mm", "41mm", "44mm", "45mm", "49mm"];
  else if (categoryId === "laptop" || categoryId === "computer") storages = ["256GB", "512GB", "1TB"];
  else if (categoryId === "tablet") storages = ["64GB", "128GB", "256GB", "512GB"];
  else if (/pro max|ultra|plus/.test(lower)) storages = ["128GB", "256GB", "512GB", "1TB"];
  else if (/iphone|galaxy|pixel|oneplus|moto/.test(lower)) storages = ["128GB", "256GB", "512GB"];

  // Title-case-ish display name preserving known tokens
  const displayName = cleaned
    .split(" ")
    .map((w) => {
      if (/^(gb|tb|mm|se|pro|max|plus|ultra|air|mini|xl|fe)$/i.test(w)) {
        return w.toUpperCase() === w ? w : w[0].toUpperCase() + w.slice(1).toLowerCase();
      }
      if (/^iphone$/i.test(w)) return "iPhone";
      if (/^ipad$/i.test(w)) return "iPad";
      if (/^imac$/i.test(w)) return "iMac";
      if (/^macbook$/i.test(w)) return "MacBook";
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(" ")
    .replace(/\bPro Max\b/i, "Pro Max")
    .replace(/\bGb\b/g, "GB");

  return {
    displayName,
    slug: slugifyDeviceName(displayName),
    brandName,
    categoryId,
    storages,
  };
}

async function buildDeviceImage(name: string, slug: string, force = false): Promise<{
  image_url: string;
  method: string;
}> {
  const args = ["--name", name, "--slug", slug];
  if (force) args.push("--force");
  const { stdout } = await execFileAsync("python3", [BUILD_SCRIPT, ...args], {
    timeout: 30_000,
    maxBuffer: 2_000_000,
  });
  const line = stdout.trim().split("\n").filter(Boolean).pop() || "{}";
  const parsed = JSON.parse(line) as { ok?: boolean; image_url?: string; method?: string; error?: string };
  if (!parsed.ok || !parsed.image_url) {
    throw new Error(parsed.error || "Image build failed");
  }
  return { image_url: parsed.image_url, method: parsed.method || "built" };
}

function ensureBrand(
  db: ReturnType<typeof getDb>,
  brandName: string,
  categoryId: string,
): string {
  const existing = db
    .prepare("SELECT id FROM brands WHERE category_id = ? AND LOWER(name) = LOWER(?) LIMIT 1")
    .get(categoryId, brandName) as { id: string } | undefined;
  if (existing) return existing.id;

  const id = `${slugifyDeviceName(brandName)}-${categoryId}`.slice(0, 48);
  db.prepare(
    `INSERT INTO brands (id, name, category_id, enabled)
     VALUES (?, ?, ?, 1)
     ON CONFLICT(id) DO UPDATE SET enabled = 1`,
  ).run(id, brandName, categoryId);
  return id;
}

function findExistingDevice(
  db: ReturnType<typeof getDb>,
  slug: string,
  displayName: string,
): {
  id: string;
  name: string;
  category_id: string;
  brand_id: string;
  storages: string;
  image_url: string | null;
  enabled: number;
} | undefined {
  const byId = db.prepare("SELECT * FROM devices WHERE id = ?").get(slug) as
    | {
        id: string;
        name: string;
        category_id: string;
        brand_id: string;
        storages: string;
        image_url: string | null;
        enabled: number;
      }
    | undefined;
  if (byId) return byId;

  return db
    .prepare("SELECT * FROM devices WHERE LOWER(name) = LOWER(?) LIMIT 1")
    .get(displayName) as typeof byId;
}

function findSiblingPrices(
  db: ReturnType<typeof getDb>,
  parsed: ParsedDeviceName,
): Array<{ storage: string; condition_grade: string; base_price: number }> {
  // Prefer previous generation: iPhone 17 → iPhone 16
  const gen = parsed.displayName.match(/(\d{1,2})/);
  const candidates: string[] = [];
  if (gen) {
    const n = Number(gen[1]);
    if (n > 1) {
      const prev = parsed.displayName.replace(String(n), String(n - 1));
      candidates.push(slugifyDeviceName(prev));
      candidates.push(slugifyDeviceName(prev.replace(/^Apple\s+/i, "")));
    }
  }
  // Brand family fallbacks
  if (parsed.brandName === "Apple" && parsed.categoryId === "smartphone") {
    candidates.push("iphone-16-pro", "iphone-16", "iphone-15");
  } else if (parsed.brandName === "Samsung") {
    candidates.push("galaxy-s24", "galaxy-s24-ultra", "s24");
  } else if (parsed.brandName === "Google") {
    candidates.push("pixel-9", "pixel-8");
  }

  for (const id of candidates) {
    const rows = db
      .prepare(
        `SELECT storage, condition_grade, base_price FROM prices
         WHERE device_id = ? AND base_price > 0`,
      )
      .all(id) as Array<{ storage: string; condition_grade: string; base_price: number }>;
    if (rows.length) {
      // New release uplift ~8% over previous gen
      return rows.map((r) => ({
        ...r,
        base_price: Math.round(r.base_price * 1.08),
      }));
    }
  }
  return [];
}

function seedPrices(
  db: ReturnType<typeof getDb>,
  deviceId: string,
  storages: string[],
  siblingRows: Array<{ storage: string; condition_grade: string; base_price: number }>,
  categoryId = "smartphone",
): number {
  const upsert = db.prepare(
    `INSERT INTO prices (device_id, storage, condition_grade, base_price, source, updated_at)
     VALUES (?, ?, ?, ?, 'bootstrap', datetime('now'))
     ON CONFLICT(device_id, storage, condition_grade)
     DO UPDATE SET base_price = excluded.base_price, source = excluded.source, updated_at = datetime('now')`,
  );

  let count = 0;
  if (siblingRows.length) {
    const byStorage = new Map<string, typeof siblingRows>();
    for (const row of siblingRows) {
      if (!byStorage.has(row.storage)) byStorage.set(row.storage, []);
      byStorage.get(row.storage)!.push(row);
    }
    const storagesToUse = storages.filter((s) => byStorage.has(s));
    const useStorages = storagesToUse.length ? storagesToUse : [...byStorage.keys()];
    for (const storage of useStorages) {
      for (const row of byStorage.get(storage) || []) {
        upsert.run(deviceId, storage, row.condition_grade, row.base_price);
        count += 1;
      }
    }
    return count;
  }

  // Generic starter ladder when no sibling exists
  const baseByCategory: Record<string, number> = {
    smartphone: 280,
    tablet: 320,
    smartwatch: 120,
    laptop: 650,
    computer: 700,
    "gaming-console": 250,
    vr: 200,
    monitor: 180,
  };
  const flawless = baseByCategory[categoryId] ?? 280;
  for (const storage of storages) {
    const storageBoost =
      storage === "1TB" || storage === "1024GB" ? 1.2 : storage === "512GB" ? 1.12 : storage === "256GB" ? 1.06 : 1;
    for (const [grade, mult] of Object.entries(GRADE_MULT)) {
      const price = Math.max(15, Math.round(flawless * storageBoost * mult));
      upsert.run(deviceId, storage, grade, price);
      count += 1;
    }
  }
  return count;
}

export async function ensureDeviceFromName(input: {
  name: string;
  categoryId?: string | null;
  brandId?: string | null;
  rebuildImage?: boolean;
  seedPrices?: boolean;
}): Promise<BootstrapResult> {
  const parsed = parseDeviceName(input.name, input.categoryId);
  const db = getDb();

  try {
    // Ensure category row exists (seed should have it; create soft fallback)
    const cat = db.prepare("SELECT id FROM categories WHERE id = ?").get(parsed.categoryId) as
      | { id: string }
      | undefined;
    if (!cat) {
      db.prepare("INSERT INTO categories (id, name, sort_order) VALUES (?, ?, 99)").run(
        parsed.categoryId,
        parsed.categoryId,
      );
    }

    const brandId = input.brandId || ensureBrand(db, parsed.brandName, parsed.categoryId);
    const existing = findExistingDevice(db, parsed.slug, parsed.displayName);

    let imageMeta: { image_url: string; method: string } | null = null;
    try {
      imageMeta = await buildDeviceImage(
        parsed.displayName,
        existing?.id || parsed.slug,
        Boolean(input.rebuildImage) || !existing?.image_url,
      );
    } catch {
      imageMeta = {
        image_url: `/devices/${existing?.id || parsed.slug}.png`,
        method: "pending",
      };
    }

    if (existing) {
      if (existing.enabled === 0) {
        db.prepare("UPDATE devices SET enabled = 1 WHERE id = ?").run(existing.id);
      }
      if (!existing.image_url || input.rebuildImage) {
        db.prepare("UPDATE devices SET image_url = ? WHERE id = ?").run(imageMeta.image_url, existing.id);
      }
      let pricesSeeded = 0;
      if (input.seedPrices !== false) {
        const hasPrices = db
          .prepare("SELECT 1 FROM prices WHERE device_id = ? LIMIT 1")
          .get(existing.id);
        if (!hasPrices) {
          pricesSeeded = seedPrices(
            db,
            existing.id,
            parsed.storages,
            findSiblingPrices(db, parsed),
            parsed.categoryId,
          );
        }
      }
      const row = db.prepare("SELECT * FROM devices WHERE id = ?").get(existing.id) as BootstrapResult["device"] & {
        storages: string;
      };
      const maxPrice = db
        .prepare(
          `SELECT MAX(base_price) AS m FROM prices WHERE device_id = ? AND condition_grade = 'flawless'`,
        )
        .get(existing.id) as { m: number | null } | undefined;
      return {
        created: false,
        matchedExisting: true,
        device: {
          ...row,
          storages: JSON.parse(row.storages || "[]"),
          max_price_flawless: maxPrice?.m ?? 0,
        } as BootstrapResult["device"],
        image: imageMeta,
        pricesSeeded,
      };
    }

    db.prepare(
      `INSERT INTO devices (id, category_id, brand_id, name, storages, image_url, enabled)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
    ).run(
      parsed.slug,
      parsed.categoryId,
      brandId,
      parsed.displayName,
      JSON.stringify(parsed.storages),
      imageMeta.image_url,
    );

    const pricesSeeded =
      input.seedPrices === false
        ? 0
        : seedPrices(
            db,
            parsed.slug,
            parsed.storages,
            findSiblingPrices(db, parsed),
            parsed.categoryId,
          );

    const row = db.prepare("SELECT * FROM devices WHERE id = ?").get(parsed.slug) as BootstrapResult["device"] & {
      storages: string;
    };
    const maxPrice = db
      .prepare(
        `SELECT MAX(base_price) AS m FROM prices WHERE device_id = ? AND condition_grade = 'flawless'`,
      )
      .get(parsed.slug) as { m: number | null } | undefined;

    return {
      created: true,
      matchedExisting: false,
      device: {
        ...row,
        storages: JSON.parse(row.storages || "[]"),
        max_price_flawless: maxPrice?.m ?? 0,
      } as BootstrapResult["device"],
      image: imageMeta,
      pricesSeeded,
    };
  } finally {
    db.close();
  }
}

/** True when the query looks like a concrete product name (not a single vague word). */
export function looksLikeProductName(q: string): boolean {
  const t = q.trim();
  if (t.length < 5) return false;
  if (/\d/.test(t)) return true;
  return /iphone|ipad|galaxy|pixel|macbook|oneplus|motorola|surface|watch|tab\b/i.test(t);
}
