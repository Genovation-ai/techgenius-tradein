import type {
  Brand,
  Carrier,
  ConditionGrade,
  DeviceCategory,
  DeviceModel,
  ValuationAnswers,
} from "../data/catalog";

export type TradeInStep =
  | "category"
  | "device"
  | "details"
  | "valuation"
  | "media-ai"
  | "grade"
  | "offer"
  | "checkout"
  | "done";

export type PhotoAngle = "front" | "back" | "left" | "right" | "extra";

export type IssueType =
  | "crack"
  | "scratch"
  | "dent"
  | "discoloration"
  | "dead_pixels"
  | "glare"
  | "powered_off"
  | "blurry"
  | "no_device";

export type IssueSeverity = "low" | "medium" | "high";

export interface DetectedIssue {
  id: string;
  type: IssueType;
  severity: IssueSeverity;
  angle: PhotoAngle;
  confidence: number;
  label: string;
}

export interface MediaFile {
  id: string;
  kind: "image" | "video";
  name: string;
  previewUrl: string;
  sizeLabel: string;
  /** Which side of the phone this capture represents */
  angle?: PhotoAngle;
  /** Kept in-memory for post-submit evidence upload */
  file?: File;
}

export interface VisionMetrics {
  method: "local-cv";
  framesAnalyzed: number;
  images: number;
  videos: number;
  crackDensity: number;
  scratchIndex: number;
  discoloration: number;
  sharpness: number;
  edgePreviewUrl?: string;
}

export interface AngleScanSummary {
  angle: PhotoAngle;
  framesAnalyzed: number;
  screenScore: number;
  bodyScore: number;
  crackDensity: number;
  scratchIndex: number;
  discoloration: number;
  sharpness: number;
  scenario: string;
  poweredOffLikely: boolean;
  issues: DetectedIssue[];
}

export interface AiScanResult {
  screenScore: number;
  bodyScore: number;
  suggestedGrade: ConditionGrade;
  notes: string[];
  confidence: number;
  usedMedia: boolean;
  vision?: VisionMetrics;
  /** Structured issues from front/back/sides */
  issues?: DetectedIssue[];
  perAngle?: AngleScanSummary[];
  anglesCovered?: PhotoAngle[];
}

export interface ContactInfo {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  imei: string;
  notes: string;
  promoCode: string;
  payout: "etransfer" | "store-credit" | "paypal" | "cash";
  method: "mail-in" | "drop-off";
  storeId: string;
  shipAddress: string;
  shipCity: string;
  shipProvince: string;
  shipPostal: string;
}

export interface QuotedDevice {
  id: string;
  deviceId: string;
  category: DeviceCategory;
  brand: Brand;
  deviceName: string;
  storage: string;
  /** Second spec axis (laptop memory config); null for single-axis devices. */
  memory?: string | null;
  carrier: Carrier;
  /** Customer-declared colour. Optional, and never priced on. */
  color?: string | null;
  grade: ConditionGrade;
  offer: number;
  batteryHealth: number | null;
}

export interface TradeInState {
  step: TradeInStep;
  category: DeviceCategory | null;
  brand: Brand | null;
  brandFilter: Brand | "All";
  device: DeviceModel | null;
  storage: string | null;
  memory: string | null;
  carrier: Carrier | null;
  color: string | null;
  /** The single ownership / lock confirmation on the condition step. */
  owned: boolean;
  modelQuery: string;
  valuation: ValuationAnswers;
  media: MediaFile[];
  mediaSkipped: boolean;
  aiResult: AiScanResult | null;
  grade: ConditionGrade | null;
  offer: number | null;
  cart: QuotedDevice[];
  contact: ContactInfo;
  offerId: string | null;
}

export const emptyValuation: ValuationAnswers = {
  powerOn: null,
  fullyFunctional: null,
  exterior: null,
  liquidDamage: null,
  batteryHealth: null,
  activationLockFree: null,
  cleanImei: null,
  canadianModel: null,
  underContract: null,
  chargerIncluded: null,
};

export const emptyContact: ContactInfo = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  imei: "",
  notes: "",
  promoCode: "",
  payout: "etransfer",
  method: "mail-in",
  storeId: "burlington",
  shipAddress: "",
  shipCity: "",
  shipProvince: "ON",
  shipPostal: "",
};

export const initialTradeInState: TradeInState = {
  step: "category",
  category: null,
  brand: null,
  brandFilter: "All",
  device: null,
  storage: null,
  memory: null,
  carrier: null,
  color: null,
  owned: false,
  modelQuery: "",
  valuation: emptyValuation,
  media: [],
  mediaSkipped: false,
  aiResult: null,
  grade: null,
  offer: null,
  cart: [],
  contact: emptyContact,
  offerId: null,
};

/**
 * "valuation" is intentionally absent.
 *
 * It asked eight questions the condition cards on the next step already
 * answered in their own descriptions, so the customer stated their device's
 * condition twice. The step type is kept so leads recorded against it before
 * this change still resolve to a label.
 */
export const stepOrder: TradeInStep[] = [
  "category",
  "device",
  "details",
  "media-ai",
  "grade",
  "offer",
  "checkout",
  "done",
];

/**
 * Progress labels the customer reads.
 *
 * Named for what the person is doing at that moment, not for the component
 * behind it. "Vision" and "Checklist" described our implementation — a shopper
 * has no idea whether that means a camera, a form, or something to read.
 *
 * The keys are unchanged: they are what gets written to `furthest_step` on a
 * lead, so renaming a label never breaks stored data or the Follow-ups page.
 */
/**
 * What each step asks for, in the words a customer would use.
 *
 * "Specs", "Grade" and "Payout" are what these steps are called in the code
 * and on the staff board. Someone selling a phone does not have specs; they
 * have a phone with a certain amount of storage on a certain network. The
 * point of the rail is to tell them what is coming, and a word they have to
 * decode does not do that.
 */
export const stepLabels: Record<TradeInStep, string> = {
  category: "Device type",
  device: "Your model",
  details: "Storage & carrier",
  valuation: "Condition",
  "media-ai": "Photos",
  grade: "Condition",
  offer: "Your offer",
  checkout: "Getting paid",
  done: "Done",
};

export function checkoutComplete(c: ContactInfo): boolean {
  const base =
    c.firstName.trim().length > 1 &&
    c.lastName.trim().length > 1 &&
    c.email.includes("@") &&
    c.phone.trim().length >= 7;
  if (!base) return false;
  if (c.method === "drop-off") return Boolean(c.storeId);
  return (
    c.shipAddress.trim().length > 3 &&
    c.shipCity.trim().length > 1 &&
    c.shipPostal.trim().length >= 3
  );
}

/**
 * Storage label to show a customer, or "" when there is nothing worth showing.
 *
 * Roughly a quarter of the catalog is priced on a single placeholder tier
 * literally named "default" (watches and older handsets whose capacities were
 * never imported). That value is real as far as the price table is concerned,
 * so it keeps flowing to the server — it just must never be rendered as though
 * it were a capacity the shopper chose.
 */
export function displayStorage(storage?: string | null): string {
  if (!storage) return "";
  return /^default$/i.test(storage.trim()) ? "" : storage;
}

/** Join parts with " · ", dropping the empty ones (e.g. a hidden storage). */
export function joinDetails(...parts: Array<string | number | null | undefined>): string {
  return parts
    .map((p) => (typeof p === "number" ? String(p) : (p ?? "").trim()))
    .filter(Boolean)
    .join(" · ");
}

/**
 * What a catalog "storage" value actually describes.
 *
 * The importer put memory configurations into the same list as drive
 * capacities, so a MacBook can arrive as ["4TB","2TB","1TB","32GB","24GB","16GB"]
 * and a Galaxy Book4 as ["16GB","8GB"] with no drive sizes at all. Asking a
 * shopper for "Storage capacity: 16GB" on a laptop is a question that cannot be
 * answered correctly, and comparing 16GB of RAM against 1TB of SSD as if they
 * were the same axis is what produced most of the price-ladder warnings.
 *
 * On laptops and desktops a value at or below this threshold is memory: no
 * machine in this catalog ships a drive that small.
 */
const RAM_CEILING_GB = 64;

export type SpecKind = "storage" | "memory" | "other";

function toGb(value: string): number {
  const m = value.trim().toLowerCase().replace(/\s/g, "").match(/^([\d.]+)(tb|gb)$/);
  if (!m) return -1;
  return parseFloat(m[1]) * (m[2] === "tb" ? 1024 : 1);
}

export function specKind(value: string, category?: string | null): SpecKind {
  const gb = toGb(value);
  if (gb < 0) return "other";
  if ((category === "laptop" || category === "computer") && gb <= RAM_CEILING_GB) return "memory";
  return "storage";
}

/** Customer-facing label: "1TB SSD", "16GB RAM", "256GB", "44mm". */
export function specLabel(value: string, category?: string | null): string {
  const shown = displayStorage(value);
  if (!shown) return "";
  switch (specKind(value, category)) {
    case "memory":
      return `${shown} RAM`;
    case "storage":
      return category === "laptop" || category === "computer" ? `${shown} SSD` : shown;
    default:
      return shown;
  }
}

/** Heading for the picker: laptops mix drive and memory tiers, so ask for a configuration. */
export function specQuestionLabel(values: string[], category?: string | null): string {
  const kinds = new Set(values.map((v) => specKind(v, category)));
  if (kinds.has("memory")) {
    return kinds.has("storage") ? "Configuration" : "Memory (RAM)";
  }
  return "Storage capacity";
}


/**
 * Colours a customer can pick from.
 *
 * Deliberately generic rather than per-model. The catalogue's upstream source
 * carries no colour data at all, so a per-device list would have to be invented,
 * and an invented list is worse than none — it would offer finishes a model was
 * never sold in. These are the shades a person recognises on their own desk;
 * anything unusual goes under "Other" and gets confirmed when the device lands.
 *
 * It is never required and never changes the price. Its job is to help the shop
 * match the parcel on the bench to the offer on the screen.
 */
export const DEVICE_COLORS = [
  "Black",
  "White",
  "Silver",
  "Grey",
  "Gold",
  "Blue",
  "Green",
  "Red",
  "Purple",
  "Pink",
  "Yellow",
  "Other",
] as const;
