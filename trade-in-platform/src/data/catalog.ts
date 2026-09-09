export type DeviceCategory =
  | "smartphone"
  | "tablet"
  | "smartwatch"
  | "laptop"
  | "computer"
  | "gaming-console"
  | "vr"
  | "monitor";

export type Brand = string;

/** Condition grades used for quotes (internal keys — do not rename; map to scraped prices) */
export type ConditionGrade =
  | "flawless"
  | "good"
  | "average"
  | "fair"
  | "defective";

/**
 * Tech Genius customer-facing grade names — the store's own sell/trade-in
 * conditions. Internal keys stay stable so quotes keep hitting the
 * GoRecell/UniverCell scraped tiers:
 *   flawless → Like New
 *   good     → Good
 *   average  → Acceptable
 *   fair     → Unacceptable (cracked but working / one minor defect)
 *   defective→ As-Is (outside every published condition)
 */
export const gradeLabels: Record<ConditionGrade, string> = {
  flawless: "Like New",
  good: "Good",
  average: "Acceptable",
  fair: "Unacceptable",
  defective: "As-Is",
};

/** Short subtitle under each grade name (shown in GradeStep) */
export const gradeTaglines: Record<ConditionGrade, string> = {
  flawless: "Looks like new · battery 85%+",
  good: "Normal signs of wear · battery 84%+",
  average: "Significant wear · battery may be 83% or below",
  fair: "Cracked screen that still works, or one minor defect",
  defective: "Liquid damage, iCloud locked, blacklisted, or numerous faults",
};


export const gradeDefinitions: Record<ConditionGrade, string[]> = {
  flawless: [
    "Looks like new cosmetically",
    "Fully functional",
    "Unlocked and is a Canadian model",
    "No liquid damage",
    "Battery holds a charge (health 85% or higher)",
    "Not iCloud locked or a blacklisted device",
  ],
  good: [
    "Has normal signs of wear",
    "Fully functional",
    "Unlocked and is a Canadian model",
    "Battery holds a charge (health 84% or higher)",
    "No heavy scratches, cracks or damaged parts",
    "No liquid damage",
    "Not iCloud locked or a blacklisted device",
  ],
  average: [
    "Significant signs of wear — scratches, scuffs, nicks and/or minor dents",
    "Fully functional",
    "Compatible on Canadian cellular networks",
    "May have a weak battery (83% or below), but otherwise in good shape",
    "No serious damage or cracks",
    "No liquid damage",
    "Not iCloud locked or a blacklisted device",
  ],
  fair: [
    "May have a cracked screen that still turns on, touchscreen fully working",
    "May have a minor defect (for example one defective button)",
    "Does not have numerous defects",
    "No liquid damage",
    "Not iCloud locked",
  ],
  defective: [
    "Falls outside the conditions above",
    "Liquid damage, will not power on, or numerous defects",
    "iCloud locked or blacklisted",
    "We still buy many of these — priced individually",
  ],
};

export interface DeviceModel {
  id: string;
  category: DeviceCategory;
  brand: Brand;
  name: string;
  storages: string[];
  basePrice: number;
  /** Per-storage pristine (flawless) prices when loaded from API */
  storagePrices?: Record<string, number>;
  /** Full storage × grade matrix when available from API (offer-facing). */
  priceMatrix?: Record<string, Partial<Record<ConditionGrade, number>>>;
}

export const categories: { id: DeviceCategory; label: string; blurb: string }[] = [
  { id: "smartphone", label: "Smartphone", blurb: "iPhone, Galaxy, Pixel…" },
  { id: "tablet", label: "Tablet", blurb: "iPad & Android tablets" },
  { id: "smartwatch", label: "Smartwatch", blurb: "Apple Watch & more" },
  { id: "laptop", label: "Laptop / Mac", blurb: "MacBook & Windows" },
  { id: "computer", label: "Desktop / iMac", blurb: "iMac, Mac mini, Studio" },
  { id: "gaming-console", label: "Gaming Console", blurb: "PlayStation, Xbox, Switch…" },
  { id: "vr", label: "VR / Wearables", blurb: "Quest, PSVR, smart glasses" },
  { id: "monitor", label: "Monitor", blurb: "Displays & screens" },
];

export const brands: Brand[] = ["Apple", "Samsung", "Google", "Other"];

export const devices: DeviceModel[] = [
  // Smartphones — Apple
  { id: "iphone-16-pro-max", category: "smartphone", brand: "Apple", name: "iPhone 16 Pro Max", storages: ["256GB", "512GB", "1TB"], basePrice: 1180 },
  { id: "iphone-16-pro", category: "smartphone", brand: "Apple", name: "iPhone 16 Pro", storages: ["128GB", "256GB", "512GB", "1TB"], basePrice: 1020 },
  { id: "iphone-16", category: "smartphone", brand: "Apple", name: "iPhone 16", storages: ["128GB", "256GB", "512GB"], basePrice: 780 },
  { id: "iphone-16-plus", category: "smartphone", brand: "Apple", name: "iPhone 16 Plus", storages: ["128GB", "256GB", "512GB"], basePrice: 820 },
  { id: "iphone-15-pro-max", category: "smartphone", brand: "Apple", name: "iPhone 15 Pro Max", storages: ["256GB", "512GB", "1TB"], basePrice: 980 },
  { id: "iphone-15-pro", category: "smartphone", brand: "Apple", name: "iPhone 15 Pro", storages: ["128GB", "256GB", "512GB", "1TB"], basePrice: 820 },
  { id: "iphone-15", category: "smartphone", brand: "Apple", name: "iPhone 15", storages: ["128GB", "256GB", "512GB"], basePrice: 620 },
  { id: "iphone-15-plus", category: "smartphone", brand: "Apple", name: "iPhone 15 Plus", storages: ["128GB", "256GB", "512GB"], basePrice: 660 },
  { id: "iphone-14-pro-max", category: "smartphone", brand: "Apple", name: "iPhone 14 Pro Max", storages: ["128GB", "256GB", "512GB", "1TB"], basePrice: 720 },
  { id: "iphone-14-pro", category: "smartphone", brand: "Apple", name: "iPhone 14 Pro", storages: ["128GB", "256GB", "512GB", "1TB"], basePrice: 580 },
  { id: "iphone-14", category: "smartphone", brand: "Apple", name: "iPhone 14", storages: ["128GB", "256GB", "512GB"], basePrice: 430 },
  { id: "iphone-14-plus", category: "smartphone", brand: "Apple", name: "iPhone 14 Plus", storages: ["128GB", "256GB", "512GB"], basePrice: 460 },
  { id: "iphone-13-pro-max", category: "smartphone", brand: "Apple", name: "iPhone 13 Pro Max", storages: ["128GB", "256GB", "512GB", "1TB"], basePrice: 520 },
  { id: "iphone-13-pro", category: "smartphone", brand: "Apple", name: "iPhone 13 Pro", storages: ["128GB", "256GB", "512GB", "1TB"], basePrice: 420 },
  { id: "iphone-13", category: "smartphone", brand: "Apple", name: "iPhone 13", storages: ["128GB", "256GB", "512GB"], basePrice: 340 },
  { id: "iphone-13-mini", category: "smartphone", brand: "Apple", name: "iPhone 13 mini", storages: ["128GB", "256GB", "512GB"], basePrice: 280 },
  { id: "iphone-12-pro-max", category: "smartphone", brand: "Apple", name: "iPhone 12 Pro Max", storages: ["128GB", "256GB", "512GB"], basePrice: 380 },
  { id: "iphone-12-pro", category: "smartphone", brand: "Apple", name: "iPhone 12 Pro", storages: ["128GB", "256GB", "512GB"], basePrice: 300 },
  { id: "iphone-12", category: "smartphone", brand: "Apple", name: "iPhone 12", storages: ["64GB", "128GB", "256GB"], basePrice: 250 },
  { id: "iphone-11-pro-max", category: "smartphone", brand: "Apple", name: "iPhone 11 Pro Max", storages: ["64GB", "256GB", "512GB"], basePrice: 260 },
  { id: "iphone-11", category: "smartphone", brand: "Apple", name: "iPhone 11", storages: ["64GB", "128GB", "256GB"], basePrice: 180 },
  { id: "iphone-se-3", category: "smartphone", brand: "Apple", name: "iPhone SE (3rd gen)", storages: ["64GB", "128GB", "256GB"], basePrice: 140 },
  // Smartphones — Samsung
  { id: "s25-ultra", category: "smartphone", brand: "Samsung", name: "Galaxy S25 Ultra", storages: ["256GB", "512GB", "1TB"], basePrice: 980 },
  { id: "s25", category: "smartphone", brand: "Samsung", name: "Galaxy S25", storages: ["128GB", "256GB"], basePrice: 620 },
  { id: "s24-ultra", category: "smartphone", brand: "Samsung", name: "Galaxy S24 Ultra", storages: ["256GB", "512GB", "1TB"], basePrice: 780 },
  { id: "s24-plus", category: "smartphone", brand: "Samsung", name: "Galaxy S24+", storages: ["256GB", "512GB"], basePrice: 560 },
  { id: "s24", category: "smartphone", brand: "Samsung", name: "Galaxy S24", storages: ["128GB", "256GB"], basePrice: 480 },
  { id: "s23-ultra", category: "smartphone", brand: "Samsung", name: "Galaxy S23 Ultra", storages: ["256GB", "512GB", "1TB"], basePrice: 560 },
  { id: "s23", category: "smartphone", brand: "Samsung", name: "Galaxy S23", storages: ["128GB", "256GB"], basePrice: 340 },
  { id: "s22-ultra", category: "smartphone", brand: "Samsung", name: "Galaxy S22 Ultra", storages: ["128GB", "256GB", "512GB"], basePrice: 360 },
  { id: "s22", category: "smartphone", brand: "Samsung", name: "Galaxy S22", storages: ["128GB", "256GB"], basePrice: 280 },
  { id: "z-fold6", category: "smartphone", brand: "Samsung", name: "Galaxy Z Fold6", storages: ["256GB", "512GB", "1TB"], basePrice: 980 },
  { id: "z-flip6", category: "smartphone", brand: "Samsung", name: "Galaxy Z Flip6", storages: ["256GB", "512GB"], basePrice: 520 },
  { id: "a55", category: "smartphone", brand: "Samsung", name: "Galaxy A55", storages: ["128GB", "256GB"], basePrice: 180 },
  // Smartphones — Google
  { id: "pixel-9-pro-xl", category: "smartphone", brand: "Google", name: "Pixel 9 Pro XL", storages: ["128GB", "256GB", "512GB"], basePrice: 720 },
  { id: "pixel-9-pro", category: "smartphone", brand: "Google", name: "Pixel 9 Pro", storages: ["128GB", "256GB", "512GB"], basePrice: 620 },
  { id: "pixel-9", category: "smartphone", brand: "Google", name: "Pixel 9", storages: ["128GB", "256GB"], basePrice: 480 },
  { id: "pixel-8-pro", category: "smartphone", brand: "Google", name: "Pixel 8 Pro", storages: ["128GB", "256GB", "512GB"], basePrice: 420 },
  { id: "pixel-8", category: "smartphone", brand: "Google", name: "Pixel 8", storages: ["128GB", "256GB"], basePrice: 300 },
  { id: "pixel-7-pro", category: "smartphone", brand: "Google", name: "Pixel 7 Pro", storages: ["128GB", "256GB", "512GB"], basePrice: 260 },
  { id: "pixel-7", category: "smartphone", brand: "Google", name: "Pixel 7", storages: ["128GB", "256GB"], basePrice: 180 },
  // Tablets
  { id: "ipad-pro-13-m4", category: "tablet", brand: "Apple", name: "iPad Pro 13 (M4)", storages: ["256GB", "512GB", "1TB"], basePrice: 980 },
  { id: "ipad-pro-11", category: "tablet", brand: "Apple", name: "iPad Pro 11", storages: ["128GB", "256GB", "512GB", "1TB"], basePrice: 680 },
  { id: "ipad-air-m2", category: "tablet", brand: "Apple", name: "iPad Air M2", storages: ["128GB", "256GB", "512GB"], basePrice: 520 },
  { id: "ipad-10", category: "tablet", brand: "Apple", name: "iPad (10th gen)", storages: ["64GB", "256GB"], basePrice: 280 },
  { id: "ipad-mini-6", category: "tablet", brand: "Apple", name: "iPad mini 6", storages: ["64GB", "256GB"], basePrice: 320 },
  { id: "tab-s9-ultra", category: "tablet", brand: "Samsung", name: "Galaxy Tab S9 Ultra", storages: ["256GB", "512GB", "1TB"], basePrice: 720 },
  { id: "tab-s9", category: "tablet", brand: "Samsung", name: "Galaxy Tab S9", storages: ["128GB", "256GB"], basePrice: 410 },
  { id: "tab-s8", category: "tablet", brand: "Samsung", name: "Galaxy Tab S8", storages: ["128GB", "256GB"], basePrice: 280 },
  { id: "pixel-tablet", category: "tablet", brand: "Google", name: "Pixel Tablet", storages: ["128GB", "256GB"], basePrice: 220 },
  // Watches
  { id: "watch-ultra-2", category: "smartwatch", brand: "Apple", name: "Apple Watch Ultra 2", storages: ["49mm"], basePrice: 420 },
  { id: "watch-series-10", category: "smartwatch", brand: "Apple", name: "Apple Watch Series 10", storages: ["42mm", "46mm"], basePrice: 280 },
  { id: "watch-series-9", category: "smartwatch", brand: "Apple", name: "Apple Watch Series 9", storages: ["41mm", "45mm"], basePrice: 220 },
  { id: "watch-se-2", category: "smartwatch", brand: "Apple", name: "Apple Watch SE (2nd gen)", storages: ["40mm", "44mm"], basePrice: 120 },
  { id: "watch6-classic", category: "smartwatch", brand: "Samsung", name: "Galaxy Watch6 Classic", storages: ["43mm", "47mm"], basePrice: 160 },
  { id: "watch7", category: "smartwatch", brand: "Samsung", name: "Galaxy Watch7", storages: ["40mm", "44mm"], basePrice: 180 },
  { id: "pixel-watch-2", category: "smartwatch", brand: "Google", name: "Pixel Watch 2", storages: ["41mm"], basePrice: 140 },
  // Laptops
  { id: "macbook-pro-16", category: "laptop", brand: "Apple", name: "MacBook Pro 16", storages: ["512GB", "1TB"], basePrice: 1280 },
  { id: "macbook-pro-14", category: "laptop", brand: "Apple", name: "MacBook Pro 14", storages: ["512GB", "1TB"], basePrice: 980 },
  { id: "macbook-air-m3", category: "laptop", brand: "Apple", name: "MacBook Air M3", storages: ["256GB", "512GB", "1TB"], basePrice: 820 },
  { id: "macbook-air-m2", category: "laptop", brand: "Apple", name: "MacBook Air M2", storages: ["256GB", "512GB", "1TB"], basePrice: 720 },
  { id: "galaxy-book4", category: "laptop", brand: "Samsung", name: "Galaxy Book4", storages: ["256GB", "512GB"], basePrice: 480 },
  { id: "galaxy-book3", category: "laptop", brand: "Samsung", name: "Galaxy Book3", storages: ["256GB", "512GB"], basePrice: 360 },
];

export const conditionMultipliers: Record<ConditionGrade, number> = {
  flawless: 1,
  good: 0.9,
  average: 0.78,
  fair: 0.4,
  defective: 0.1,
};

export const storageBoost: Record<string, number> = {
  "40mm": 0,
  "41mm": 0,
  "42mm": 0.02,
  "43mm": 0.02,
  "44mm": 0.04,
  "45mm": 0.04,
  "46mm": 0.05,
  "47mm": 0.05,
  "49mm": 0,
  "64GB": 0,
  "128GB": 0,
  "256GB": 0.06,
  "512GB": 0.12,
  "1TB": 0.18,
};

export const carriers = [
  "Unlocked",
  "Rogers",
  "Bell",
  "Telus",
  "Freedom",
  "Virgin Mobile",
  "Koodo",
  "Fido",
  "Other",
] as const;

export type Carrier = (typeof carriers)[number];

export type ExteriorCondition = "none" | "minor" | "visible" | "heavy" | "cracks";

export interface ValuationAnswers {
  powerOn: boolean | null;
  fullyFunctional: boolean | null;
  exterior: ExteriorCondition | null;
  liquidDamage: boolean | null;
  batteryHealth: number | null;
  activationLockFree: boolean | null;
  cleanImei: boolean | null;
  /** Unlocked Canadian model — required for Like New and Good. */
  canadianModel: boolean | null;
  underContract: boolean | null;
  chargerIncluded: boolean | null;
}

/** Tech Genius Burlington — primary drop-off (Framer site contact) */
export const storeLocations = [
  {
    id: "burlington",
    title: "Tech Genius Burlington",
    address: "Burlington, Ontario",
    phone: "+1 (289) 455-5556",
    mapsUrl: "https://maps.app.goo.gl/XeALL2XyjW1i1uqH7",
  },
] as const;

/**
 * NOT the source of truth. The live codes live in the backend `promo_codes`
 * table, which also tracks expiry and remaining uses; `/api/quote` returns
 * `promo_applied` and that is what the widget shows.
 *
 * This map had drifted out of sync — it advertised GENIUS5, TRADE10 and
 * WELCOME5, none of which exist in the database, so entering one told the
 * customer "offer boosted" over a price that carried no boost. Retained only
 * for the offline estimate helpers and their unit tests.
 */
export const PROMO_CODES: Record<string, number> = {
  GENIUS5: 0.05,
  TRADE10: 0.1,
  WELCOME5: 0.05,
  WELCOME10: 0.1,
};

export function calcOffer(opts: {
  basePrice: number;
  storage: string;
  grade: ConditionGrade;
  carrier: Carrier | null;
  batteryHealth: number | null;
  promoCode?: string | null;
}): number {
  const storageFactor = 1 + (storageBoost[opts.storage] ?? 0);
  const carrierFactor = opts.carrier === "Unlocked" ? 1.04 : 1;
  let batteryFactor = 1;
  if (opts.batteryHealth !== null) {
    if (opts.batteryHealth < 80) batteryFactor = 0.88;
    else if (opts.batteryHealth < 85) batteryFactor = 0.94;
    else if (opts.batteryHealth < 90) batteryFactor = 0.98;
  }
  let total =
    opts.basePrice *
    storageFactor *
    conditionMultipliers[opts.grade] *
    carrierFactor *
    batteryFactor;
  const code = (opts.promoCode ?? "").trim().toUpperCase();
  if (code && PROMO_CODES[code]) total *= 1 + PROMO_CODES[code];
  return Math.round(total);
}

export function applyStoreCreditBoost(total: number, payout: string | null | undefined): number {
  if (payout === "store-credit") return Math.round(total * 1.05);
  return total;
}

export function inferGradeFromAnswers(v: ValuationAnswers): ConditionGrade {
  // Every published condition requires no liquid damage and a clean
  // iCloud/blacklist status, so failing either puts the device outside them all.
  if (v.liquidDamage === true) return "defective";
  if (v.activationLockFree === false || v.cleanImei === false) return "defective";
  if (v.powerOn === false) return "defective";

  // "Unacceptable" covers a cracked screen that still works, or one minor
  // defect. Anything worse is priced individually as As-Is.
  if (v.exterior === "cracks" || v.exterior === "heavy") return "fair";
  if (v.fullyFunctional === false) return "fair";

  const battery = v.batteryHealth ?? 100;

  // "Acceptable" is where significant wear or a weak battery lands.
  if (v.exterior === "visible" || battery <= 83) return "average";

  // "Good" needs normal wear only and a battery at 84% or higher.
  if (v.exterior === "minor" || battery < 85) return "good";

  // "Like New" additionally needs a Canadian, unlocked model.
  if (v.canadianModel === false) return "good";

  return "flawless";
}

/** When true, customer cannot pick a higher grade than As-Is. */
export function isGradeLockedToDefective(v: ValuationAnswers): boolean {
  return (
    v.liquidDamage === true ||
    v.powerOn === false ||
    v.activationLockFree === false ||
    v.cleanImei === false
  );
}

export function gradeLockReason(v: ValuationAnswers): string | null {
  if (v.liquidDamage === true) {
    return "Liquid / water damage always grades as As-Is — even if the device still powers on.";
  }
  if (v.powerOn === false) return "Devices that won’t power on are graded As-Is.";
  if (v.activationLockFree === false) {
    return "iCloud / activation locked devices fall outside every published condition and are graded As-Is.";
  }
  if (v.cleanImei === false) {
    return "Blacklisted devices fall outside every published condition and are graded As-Is.";
  }
  return null;
}

export function filterDevices(opts: {
  category: DeviceCategory | null;
  brand: Brand | null;
  query?: string;
}): DeviceModel[] {
  const q = (opts.query ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const compact = q.replace(/\s/g, "");
  return devices.filter((d) => {
    if (opts.category && d.category !== opts.category) return false;
    if (opts.brand && opts.brand !== "Other" && d.brand !== opts.brand) return false;
    if (!q) return true;
    const name = d.name.toLowerCase();
    const nameCompact = name.replace(/\s/g, "");
    return (
      name.includes(q) ||
      nameCompact.includes(compact) ||
      d.brand.toLowerCase().includes(q) ||
      d.id.includes(compact.replace(/iphone/, "iphone"))
    );
  });
}

/**
 * The condition answers a chosen grade already implies.
 *
 * The flow used to ask eight checklist questions and then, one step later, show
 * five condition cards whose own descriptions restate every one of those
 * questions — "no liquid damage", "not iCloud locked", "battery 85% or higher",
 * "unlocked Canadian model". The customer was answering the same thing twice,
 * which is most of what made the flow feel long and repetitive.
 *
 * Only the cards are asked now, the way the buyers customers compare us against
 * do it, and the answers are derived here. Pricing, grading and hand-off keep
 * reading the same ValuationAnswers shape they always did.
 *
 * Battery health stays null rather than guessing a number. The pricing engine
 * treats null as no adjustment, so a weak battery is caught at inspection
 * rather than by inventing a percentage the customer never gave us.
 */
export function valuationFromGrade(
  grade: ConditionGrade,
  confirmedOwnership: boolean,
): ValuationAnswers {
  const base: ValuationAnswers = {
    powerOn: true,
    fullyFunctional: true,
    exterior: "none",
    liquidDamage: false,
    batteryHealth: null,
    activationLockFree: confirmedOwnership,
    cleanImei: confirmedOwnership,
    canadianModel: true,
    underContract: false,
    chargerIncluded: false,
  };
  switch (grade) {
    case "flawless":
      return base;
    case "good":
      return { ...base, exterior: "minor" };
    case "average":
      return { ...base, exterior: "visible" };
    case "fair":
      // A cracked-but-working screen, or one minor defect.
      return { ...base, exterior: "cracks", fullyFunctional: false };
    case "defective":
      // The card that says liquid damage, will not power on, or iCloud locked.
      return { ...base, exterior: "heavy", fullyFunctional: false, powerOn: false };
  }
}
