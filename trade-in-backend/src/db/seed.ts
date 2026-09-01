import { getDb } from "./migrate.js";
import fs from "node:fs";
import path from "node:path";

interface SeedData {
  categories: Array<{ id: string; name: string }>;
  brands: Array<{ id: string; name: string; category_id: string }>;
  devices: Array<{
    id: string;
    category_id: string;
    brand_id: string;
    name: string;
    storages: string[];
    base_price: number;
    has_image: boolean;
  }>;
}

export function seedCatalog() {
  const seedPath = path.resolve(import.meta.dirname, "../../config/seed_catalog.json");
  if (!fs.existsSync(seedPath)) {
    console.log("No seed_catalog.json found, skipping catalog seed.");
    return;
  }

  const data: SeedData = JSON.parse(fs.readFileSync(seedPath, "utf-8"));
  const db = getDb();

  const insertCat = db.prepare(
    "INSERT OR IGNORE INTO categories (id, name, sort_order, enabled) VALUES (?, ?, ?, 1)"
  );
  const insertBrand = db.prepare(
    "INSERT OR IGNORE INTO brands (id, name, category_id, enabled) VALUES (?, ?, ?, 1)"
  );
  const insertDevice = db.prepare(
    "INSERT OR IGNORE INTO devices (id, category_id, brand_id, name, storages, image_url, enabled) VALUES (?, ?, ?, ?, ?, ?, 1)"
  );
  const insertPrice = db.prepare(
    `INSERT OR IGNORE INTO prices (device_id, storage, condition_grade, base_price, source, updated_at)
     VALUES (?, ?, ?, ?, 'catalog-seed', datetime('now'))`
  );

  const conditionMultipliers: Record<string, number> = {
    flawless: 1.0,
    good: 0.9,
    average: 0.78,
    fair: 0.62,
    defective: 0.4,
  };

  const tx = db.transaction(() => {
    for (let i = 0; i < data.categories.length; i++) {
      const c = data.categories[i];
      insertCat.run(c.id, c.name, i + 1);
    }

    for (const b of data.brands) {
      insertBrand.run(b.id, b.name, b.category_id);
    }

    for (const d of data.devices) {
      const imageUrl = d.has_image ? `/devices/${d.id}.png` : null;
      insertDevice.run(d.id, d.category_id, d.brand_id, d.name, JSON.stringify(d.storages), imageUrl);

      for (const storage of d.storages) {
        for (const [grade, mult] of Object.entries(conditionMultipliers)) {
          const price = Math.round(d.base_price * mult);
          insertPrice.run(d.id, storage, grade, price);
        }
      }
    }
  });

  tx();
  db.close();

  const totalPrices = data.devices.reduce(
    (sum, d) => sum + d.storages.length * Object.keys(conditionMultipliers).length, 0
  );
  console.log(
    `Seeded: ${data.categories.length} categories, ${data.brands.length} brands, ${data.devices.length} devices, ${totalPrices} price points`
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedCatalog();
}
