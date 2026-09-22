import type { Database } from "better-sqlite3";

/**
 * What a repair costs the customer.
 *
 * The rule Speaker 1 gave, and nothing more for now: the part's cost, plus a
 * markup, plus a flat labour fee — or a hand-set price that ignores all of
 * that. The two knobs live in settings so the shop can move them without a
 * deploy; the defaults are the ones he named, ten per cent and a hundred
 * dollars.
 *
 * No part cost on file means no number. A made-up price on a repair is worse
 * than none — it is a promise the bench then has to keep — so the customer is
 * told the shop will quote it, and the booking still goes through.
 */

export const REPAIR_PROBLEMS = [
  { id: "screen", label: "Cracked or broken screen" },
  { id: "battery", label: "Battery drains fast or won't hold charge" },
  { id: "charging_port", label: "Won't charge / charging port" },
  { id: "back_glass", label: "Cracked back glass" },
  { id: "rear_camera", label: "Rear camera" },
  { id: "front_camera", label: "Front camera / Face ID" },
  { id: "speaker", label: "Speaker or earpiece" },
  { id: "microphone", label: "Microphone" },
  { id: "buttons", label: "Power or volume buttons" },
  { id: "water_damage", label: "Liquid damage" },
  { id: "software", label: "Software / won't turn on" },
  { id: "other", label: "Something else" },
] as const;

export type RepairProblem = string;

/**
 * What a customer is offered as "what's wrong", per shop.
 *
 * The list above is the starting point, not the law. A shop edits the words
 * its customers see, switches a problem off it does not take, and adds one
 * it does — all from the admin, saved as JSON in settings, so the widget and
 * the admin read one source. Falls back to the built-in list until a shop
 * has saved its own.
 */
export interface ProblemDef {
  id: string;
  label: string;
  enabled: boolean;
}

const PROBLEMS_KEY = (orgId: string | null) => (orgId ? `repair:${orgId}:problems` : "repair:problems");

export function getProblems(db: Database, orgId: string | null, includeDisabled = false): ProblemDef[] {
  for (const k of [PROBLEMS_KEY(orgId), PROBLEMS_KEY(null)]) {
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(k) as { value: string } | undefined;
    if (!row) continue;
    try {
      const parsed = JSON.parse(row.value) as ProblemDef[];
      if (Array.isArray(parsed) && parsed.length) {
        return includeDisabled ? parsed : parsed.filter((p) => p.enabled !== false);
      }
    } catch {
      /* a bad save falls through to the default rather than emptying the list */
    }
  }
  return REPAIR_PROBLEMS.map((p) => ({ ...p, enabled: true }));
}

const ID_SHAPE = /^[a-z0-9_]{1,40}$/;
const LABEL_SHAPE = /^[^<>]{1,80}$/;

/** Validates and saves a shop's list. Returns the cleaned list or null if unusable. */
export function setProblems(db: Database, orgId: string | null, raw: unknown): ProblemDef[] | null {
  if (!Array.isArray(raw)) return null;
  const seen = new Set<string>();
  const clean: ProblemDef[] = [];
  for (const item of raw) {
    const o = item as Partial<ProblemDef>;
    const id = String(o.id ?? "").trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
    const label = String(o.label ?? "").trim();
    if (!ID_SHAPE.test(id) || !LABEL_SHAPE.test(label) || seen.has(id)) continue;
    seen.add(id);
    clean.push({ id, label, enabled: o.enabled !== false });
  }
  if (!clean.some((p) => p.enabled)) return null; // a list with nothing to pick is not a list
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  ).run(PROBLEMS_KEY(orgId), JSON.stringify(clean));
  return clean;
}

export const REPAIR_STAGES = [
  { id: "booked", label: "Booked" },
  { id: "received", label: "Device received" },
  { id: "diagnosing", label: "Diagnosing" },
  { id: "awaiting_parts", label: "Waiting for parts" },
  { id: "in_progress", label: "Being repaired" },
  { id: "ready", label: "Ready to collect" },
  { id: "completed", label: "Completed" },
  { id: "cancelled", label: "Cancelled" },
] as const;

export type RepairStage = (typeof REPAIR_STAGES)[number]["id"];

/** Known to this shop and switched on — the only problems a customer may pick. */
export function isRepairProblem(db: Database, orgId: string | null, v: unknown): v is RepairProblem {
  return typeof v === "string" && getProblems(db, orgId).some((p) => p.id === v);
}

export function problemLabel(db: Database, orgId: string | null, id: string): string {
  return getProblems(db, orgId, true).find((p) => p.id === id)?.label ?? id;
}

export interface RepairPricingSettings {
  markupPercent: number;
  labourFee: number;
}

const DEFAULTS: RepairPricingSettings = { markupPercent: 10, labourFee: 100 };

function settingKey(orgId: string | null, key: string): string {
  return orgId ? `repair:${orgId}:${key}` : `repair:${key}`;
}

export function getRepairSettings(db: Database, orgId: string | null): RepairPricingSettings {
  const read = (key: string): number | null => {
    for (const k of [settingKey(orgId, key), settingKey(null, key)]) {
      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(k) as { value: string } | undefined;
      if (row && row.value !== "" && !Number.isNaN(Number(row.value))) return Number(row.value);
    }
    return null;
  };
  return {
    markupPercent: read("markup_percent") ?? DEFAULTS.markupPercent,
    labourFee: read("labour_fee") ?? DEFAULTS.labourFee,
  };
}

export function setRepairSettings(db: Database, orgId: string | null, s: Partial<RepairPricingSettings>): void {
  const up = db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  );
  if (s.markupPercent != null) up.run(settingKey(orgId, "markup_percent"), String(s.markupPercent));
  if (s.labourFee != null) up.run(settingKey(orgId, "labour_fee"), String(s.labourFee));
}

export interface RepairQuote {
  price: number | null;
  /**
   * override — a hand-set price for this repair
   * formula  — the shop's own part cost through markup and labour
   * market   — a published part price (iFixit, converted at the Bank of
   *            Canada rate) through markup and labour; the shop set nothing
   * quote    — nothing on file anywhere; the shop will price it by hand
   */
  source: "override" | "formula" | "market" | "quote";
  partCost: number | null;
  markupPercent: number;
  labourFee: number;
  market?: { partCostCad: number; productTitle: string; sourceUrl: string; scrapedAt: string } | null;
}

export function quoteRepair(db: Database, orgId: string | null, deviceId: string, problem: RepairProblem): RepairQuote {
  const settings = getRepairSettings(db, orgId);
  // An org's own row wins over a global one.
  const row =
    (db
      .prepare("SELECT part_cost, override_price FROM repair_parts WHERE org_id = ? AND device_id = ? AND problem = ?")
      .get(orgId, deviceId, problem) as { part_cost: number | null; override_price: number | null } | undefined) ??
    (db
      .prepare("SELECT part_cost, override_price FROM repair_parts WHERE org_id IS NULL AND device_id = ? AND problem = ?")
      .get(deviceId, problem) as { part_cost: number | null; override_price: number | null } | undefined);

  if (row?.override_price != null && row.override_price > 0) {
    return { price: Math.round(row.override_price), source: "override", partCost: row.part_cost ?? null, ...settings };
  }
  if (row?.part_cost != null && row.part_cost > 0) {
    const price = row.part_cost * (1 + settings.markupPercent / 100) + settings.labourFee;
    return { price: Math.round(price), source: "formula", partCost: row.part_cost, ...settings };
  }

  // Nothing set by the shop: a published part price, if one was read for this
  // exact model and part. It goes through the same markup and labour, and the
  // quote says where the part cost came from, so it is never mistaken for a
  // figure the shop chose.
  const mkt = db
    .prepare(
      "SELECT price_cad, product_title, source_url, scraped_at FROM repair_market_prices WHERE device_id = ? AND problem = ? ORDER BY scraped_at DESC LIMIT 1",
    )
    .get(deviceId, problem) as
    | { price_cad: number; product_title: string; source_url: string; scraped_at: string }
    | undefined;
  if (mkt && mkt.price_cad > 0) {
    const price = mkt.price_cad * (1 + settings.markupPercent / 100) + settings.labourFee;
    return {
      price: Math.round(price),
      source: "market",
      partCost: mkt.price_cad,
      ...settings,
      market: { partCostCad: mkt.price_cad, productTitle: mkt.product_title, sourceUrl: mkt.source_url, scrapedAt: mkt.scraped_at },
    };
  }
  return { price: null, source: "quote", partCost: null, ...settings };
}
