import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { getDb } from "../db/migrate.js";

const SCRAPER_SCRIPT = path.resolve(import.meta.dirname, "../../scripts/scrape_prices.py");
const OUTPUT_FILE = path.resolve(import.meta.dirname, "../../data/scraped_prices.json");

export interface ScrapedPrice {
  device_id: string;
  storage: string;
  condition_grade: string;
  base_price: number;
  source: string;
}

export function runScraper(configPath?: string): { success: boolean; count: number; error?: string } {
  const cfg = configPath || path.resolve(import.meta.dirname, "../../config/scrape.json");
  try {
    execSync(
      `python3 "${SCRAPER_SCRIPT}" --config "${cfg}" --output "${OUTPUT_FILE}"`,
      { timeout: 120_000, stdio: "pipe" }
    );

    if (!fs.existsSync(OUTPUT_FILE)) {
      return { success: false, count: 0, error: "Scraper produced no output" };
    }

    const prices: ScrapedPrice[] = JSON.parse(fs.readFileSync(OUTPUT_FILE, "utf-8"));
    if (!prices.length) return { success: true, count: 0 };

    const db = getDb();
    const stmt = db.prepare(
      `INSERT INTO prices (device_id, storage, condition_grade, base_price, source, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(device_id, storage, condition_grade) DO UPDATE SET
         base_price = excluded.base_price, source = excluded.source, updated_at = datetime('now')`
    );
    const tx = db.transaction(() => {
      for (const p of prices) {
        stmt.run(p.device_id, p.storage, p.condition_grade, p.base_price, p.source || "scraper");
      }
    });
    tx();
    db.close();

    return { success: true, count: prices.length };
  } catch (e) {
    return { success: false, count: 0, error: String(e).slice(0, 500) };
  }
}
