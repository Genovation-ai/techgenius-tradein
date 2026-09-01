/**
 * Shared server-side quote calculation.
 * Widget submit and /api/quote must use the same path so clients cannot invent prices.
 */
import { getDb } from "../db/migrate.js";
import { resolveFrontendBasePrice } from "./competitorPricing.js";

export interface QuoteInput {
  deviceId: string;
  storage: string;
  /**
   * Second spec axis, for devices priced on more than one (laptops list both a
   * drive size and a memory config). Optional: phones and tablets have one axis.
   */
  memory?: string | null;
  conditionGrade: string;
  carrier?: string | null;
  batteryHealth?: number | null;
  promoCode?: string | null;
  /** When store-credit, customer offer is boosted +5% (matches checkout UI). */
  payoutMethod?: string | null;
}

export interface QuoteResult {
  quotedPrice: number;
  basePrice: number;
  priceSource: string;
  priceMode: string;
  competitorPrice: number | null;
  scaledFromExcellent: boolean;
  scrapedAt: string | null;
  fromManualTable: boolean;
  promoApplied: boolean;
  storeCreditBoost: boolean;
  /** True when a second spec axis constrained the price (see limitingSpec). */
  multiSpec: boolean;
  /** Which axis set the price, when two were supplied. */
  limitingSpec: string | null;
}

/**
 * A device must exist and be enabled to be quotable.
 *
 * Retiring a catalog row only hides its tile — `/api/quote` and
 * `/api/widget/submit` are public and take a device_id, so without this check a
 * disabled row stays priceable by anyone holding its id. That mattered when the
 * duplicate rows were retired: the surviving iPhone 12 quotes $245, while a
 * retired duplicate still carried a TechAPI retail price of $758.
 */
function isQuotableDevice(deviceId: string): boolean {
  const db = getDb();
  try {
    const row = db
      .prepare("SELECT 1 AS ok FROM devices WHERE id = ? AND enabled = 1")
      .get(deviceId) as { ok: number } | undefined;
    return Boolean(row);
  } finally {
    db.close();
  }
}

/** Worst -> best. */
const GRADE_LADDER = ["defective", "fair", "average", "good", "flawless"];

/**
 * Resolve the base price, capped so a worse condition can never be quoted above
 * a better one.
 *
 * This has to happen here, at read time, rather than by cleaning a table.
 * resolveFrontendBasePrice reads live competitor scrapes first and only falls
 * back to the `prices` table, so repairing that table leaves the primary path
 * untouched — and the next scrape would undo a repair anyway. Capping where the
 * price is actually decided covers every source and survives future syncs.
 *
 * Walks down from flawless, carrying the running cap. Grades with no price are
 * skipped rather than treated as zero.
 */
function resolveLadderCappedPrice(deviceId: string, storage: string, grade: string) {
  const index = GRADE_LADDER.indexOf(grade);
  const resolveAt = (g: string) =>
    resolveFrontendBasePrice({ productId: deviceId, variant: storage, conditionGrade: g });

  if (index < 0) return resolveAt(grade); // unknown grade: nothing to compare against

  let cap = Number.POSITIVE_INFINITY;
  let mine = resolveAt(GRADE_LADDER[GRADE_LADDER.length - 1]);

  for (let i = GRADE_LADDER.length - 1; i >= index; i -= 1) {
    const resolved = i === GRADE_LADDER.length - 1 ? mine : resolveAt(GRADE_LADDER[i]);
    let price = resolved.basePrice;
    if (price > 0) {
      if (price > cap) price = cap;
      else cap = price;
    }
    if (i === index) mine = { ...resolved, basePrice: price };
  }
  return mine;
}

/** Capacity in GB, or -1 for trims that are not a capacity (40mm, "default"). */
function capacityGb(value: string): number {
  const m = String(value).trim().toLowerCase().replace(/\s/g, "").match(/^([\d.]+)(tb|gb)$/);
  return m ? parseFloat(m[1]) * (m[2] === "tb" ? 1024 : 1) : -1;
}

/**
 * A smaller capacity must never be quoted above a larger one of the same device
 * and grade.
 *
 * Competitors do not publish every grade for every capacity, so the missing
 * ones are derived from that capacity's own anchor. Nothing in that derivation
 * can see sibling capacities, so a derived price for a small tier can land above
 * a REAL scraped price for a bigger one — GoRecell lists no "fair" iPhone 7
 * 32GB, so ours came out at $6 while the genuine 128GB fair price is $5.
 *
 * Clamping down rather than up keeps the authoritative number: the larger tier's
 * price is real scraped data, the smaller tier's is inferred. It also cannot
 * overpay. Only capacities are compared — laptops list memory in the same field,
 * and 16GB of RAM is not a smaller version of a 1TB drive.
 */
function storageCap(deviceId: string, storage: string, grade: string): number {
  const gb = capacityGb(storage);
  if (gb <= 0) return Number.POSITIVE_INFINITY;

  const db = getDb();
  let siblings: string[];
  try {
    const row = db.prepare("SELECT storages FROM devices WHERE id = ?").get(deviceId) as
      | { storages: string }
      | undefined;
    siblings = row ? (JSON.parse(row.storages || "[]") as string[]) : [];
  } catch {
    siblings = [];
  } finally {
    db.close();
  }

  let cap = Number.POSITIVE_INFINITY;
  for (const other of siblings) {
    const otherGb = capacityGb(other);
    if (otherGb <= gb) continue; // only larger capacities constrain this one
    const price = resolveLadderCappedPrice(deviceId, other, grade).basePrice;
    if (price > 0 && price < cap) cap = price;
  }
  return cap;
}

export function computeServerQuote(input: QuoteInput): QuoteResult | null {
  if (!isQuotableDevice(String(input.deviceId))) {
    return null;
  }

  const grade = String(input.conditionGrade);
  const primary = resolveLadderCappedPrice(String(input.deviceId), String(input.storage), grade);

  // Two-axis devices: we hold a real scraped price for each tier separately,
  // but never for a combination. Rather than invent one by adding them up —
  // which would pay out a number no competitor ever quoted — price on the
  // limiting spec: the cheaper of the two tiers. That is monotonic in both
  // axes (raising either spec can only raise the offer), never exceeds a real
  // quoted tier, and staff confirm the full configuration at hand-off anyway.
  let resolved = primary;
  let limitingSpec: string | null = null;

  // A bigger capacity is worth at least as much as a smaller one.
  const cap = storageCap(String(input.deviceId), String(input.storage), grade);
  if (Number.isFinite(cap) && primary.basePrice > cap) {
    resolved = { ...primary, basePrice: cap };
  }
  const secondAxis = input.memory ? String(input.memory).trim() : "";

  if (secondAxis && secondAxis !== String(input.storage)) {
    const capped = resolved;
    const secondary = resolveLadderCappedPrice(String(input.deviceId), secondAxis, grade);
    if (secondary.basePrice > 0 && capped.basePrice > 0) {
      const primaryWins = capped.basePrice <= secondary.basePrice;
      resolved = primaryWins ? capped : secondary;
      limitingSpec = primaryWins ? String(input.storage) : secondAxis;
    } else if (secondary.basePrice > 0) {
      resolved = secondary;
      limitingSpec = secondAxis;
    }
  }

  if (!resolved.basePrice || resolved.basePrice <= 0) {
    return null;
  }

  let price = resolved.basePrice;
  const db = getDb();
  let promoApplied = false;
  let storeCreditBoost = false;

  const adjustments = db
    .prepare(
      "SELECT * FROM price_adjustments WHERE enabled = 1 AND (condition_grade IS NULL OR condition_grade = ?)",
    )
    .all(input.conditionGrade) as Array<{ adjust_percent: number; adjust_amount: number }>;

  for (const adj of adjustments) {
    price *= 1 + adj.adjust_percent / 100;
    price += adj.adjust_amount;
  }

  if (input.carrier === "Unlocked") price *= 1.04;

  if (input.batteryHealth != null && Number.isFinite(input.batteryHealth)) {
    const bh = Number(input.batteryHealth);
    if (bh < 80) price *= 0.88;
    else if (bh < 85) price *= 0.94;
    else if (bh < 90) price *= 0.98;
  }

  if (input.promoCode) {
    const promo = db
      .prepare(
        `SELECT * FROM promo_codes WHERE code = ? AND active = 1
         AND (expires_at IS NULL OR expires_at >= date('now'))
         AND (max_uses IS NULL OR uses < max_uses)`,
      )
      .get(String(input.promoCode).toUpperCase()) as
      | { discount_percent: number; discount_amount: number }
      | undefined;
    if (promo) {
      // Field name is historical: values are customer offer boosts (+%), not markdowns.
      price *= 1 + promo.discount_percent / 100;
      price += promo.discount_amount;
      promoApplied = true;
    }
  }

  if (input.payoutMethod === "store-credit") {
    price *= 1.05;
    storeCreditBoost = true;
  }

  db.close();

  return {
    quotedPrice: Math.max(1, Math.round(price)),
    basePrice: resolved.basePrice,
    priceSource: resolved.source,
    priceMode: resolved.mode,
    competitorPrice: resolved.competitorPrice,
    scaledFromExcellent: resolved.scaled,
    scrapedAt: resolved.scraped_at,
    fromManualTable: resolved.fromManualTable,
    promoApplied,
    storeCreditBoost,
    multiSpec: limitingSpec !== null,
    limitingSpec,
  };
}
