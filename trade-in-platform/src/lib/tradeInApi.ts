import type { Brand, ConditionGrade, DeviceCategory, DeviceModel } from "../data/catalog";

const BUILD_TIME_API_BASE =
  (import.meta.env.VITE_TRADE_IN_API_URL as string | undefined)?.replace(/\/$/, "") ||
  "";

let resolvedApiBase: string | null = null;

/**
 * Where the backend lives, resolved at RUNTIME so one built bundle works on any
 * host. Framer and Shopify pages are edited by staff, not rebuilt, so the API
 * origin has to be settable from the page itself:
 *
 *   <div id="tg-trade-in-root" data-api="https://api.techgenius.ca"></div>
 *   <script src="…/tg-trade-in.js" data-api="https://api.techgenius.ca"></script>
 *   <script>window.TG_TRADE_IN_API = "https://api.techgenius.ca"</script>
 *
 * Order: explicit global → mount element → script tag → build-time env →
 * same origin (the local dev/self-hosted case).
 */
export function resolveApiBase(): string {
  if (resolvedApiBase !== null) return resolvedApiBase;
  if (typeof window === "undefined") return BUILD_TIME_API_BASE;

  const candidates = [
    (window as { TG_TRADE_IN_API?: string }).TG_TRADE_IN_API,
    document.getElementById("tg-trade-in-root")?.getAttribute("data-api"),
    document.querySelector<HTMLScriptElement>("script[data-api]")?.dataset.api,
    BUILD_TIME_API_BASE,
  ];

  for (const candidate of candidates) {
    const value = (candidate || "").trim().replace(/\/$/, "");
    if (value) {
      resolvedApiBase = value;
      return value;
    }
  }

  // Nothing configured: assume the API is served from this same origin.
  resolvedApiBase = window.location.origin;
  return resolvedApiBase;
}

/** Test seam / late reconfiguration: forget the cached origin. */
export function resetApiBase(): void {
  resolvedApiBase = null;
}

function apiUrl(path: string): string {
  return `${resolveApiBase()}${path}`;
}

/**
 * Resolve an image source for use in `<img src>`.
 *
 * Bundled photos arrive as `data:` URIs and absolute URLs are already complete —
 * both pass through. A root-relative `/devices/…` path, though, would otherwise
 * resolve against the HOST page: on techgenius.ca that means
 * `https://techgenius.ca/devices/quest-3.png`, which 404s. Those must be
 * pointed at the API, which is what actually serves /devices.
 */
export function assetUrl(src?: string | null): string {
  if (!src) return "";
  if (/^(?:data:|blob:|https?:)/i.test(src)) return src;
  return `${resolveApiBase()}${src.startsWith("/") ? src : `/${src}`}`;
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface ApiCategory {
  id: string;
  name: string;
  icon?: string | null;
}

export interface ApiBrand {
  id: string;
  name: string;
  category_id: string;
}

export interface ApiDevice {
  id: string;
  category_id: string;
  brand_id: string;
  name: string;
  storages: string[];
  image_url?: string | null;
  max_price_flawless?: number;
  price_matrix?: Record<string, Partial<Record<string, number>>>;
}

export interface QuoteRequest {
  device_id: string;
  storage: string;
  memory?: string | null;
  condition_grade: ConditionGrade;
  carrier?: string | null;
  battery_health?: number | null;
  promo_code?: string | null;
  payout_method?: string | null;
}

export interface QuoteResponse {
  quoted_price: number;
  base_price: number;
  price_source?: string;
  price_mode?: string;
  competitor_price?: number | null;
  scaled_from_excellent?: boolean;
  scraped_at?: string | null;
  from_manual_table?: boolean;
  /** Whether the SERVER accepted the promo code — the only authority on this. */
  promo_applied?: boolean;
  store_credit_boost?: boolean;
  multi_spec?: boolean;
  limiting_spec?: string | null;
}

export interface WidgetSubmitRequest {
  contact: {
    first_name: string;
    last_name: string;
    email?: string;
    phone?: string;
  };
  offer_type?: string;
  payout_method?: string;
  promo_code?: string;
  ai_scan?: unknown;
  items: Array<{
    device_id?: string;
    device_name: string;
    storage?: string;
    memory?: string | null;
    carrier?: string;
    color?: string | null;
    condition_grade?: string;
    quoted_price: number;
    battery_health?: number | null;
  }>;
}

export interface TrackedOffer {
  id: string;
  /** Raw workflow id. Prefer status_label — this is the shop's internal word. */
  status: string;
  /** Customer-facing stage name, e.g. "Being checked". */
  status_label?: string;
  /** One sentence on what happens next. */
  status_note?: string;
  /** The ordinary stages in order, for the progress trail. */
  journey?: string[];
  /** Position on that trail, or null for held / revised / returned offers. */
  journey_index?: number | null;
  total_value: number;
  offer_type?: string;
  payout_method?: string;
  created_at?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  items: Array<{
    device_name: string;
    storage?: string;
    memory?: string | null;
    carrier?: string;
    color?: string | null;
    condition_grade?: string;
    quoted_price: number;
  }>;
}

const brandNameCache = new Map<string, string>();

export function brandNameFromId(brandId: string, brands?: ApiBrand[]): Brand {
  if (brands) {
    const hit = brands.find((b) => b.id === brandId);
    if (hit?.name) {
      brandNameCache.set(brandId, hit.name);
      return hit.name;
    }
  }
  const cached = brandNameCache.get(brandId);
  if (cached) return cached;
  const prefix = brandId.split("-")[0];
  if (!prefix) return "Other";
  return prefix.charAt(0).toUpperCase() + prefix.slice(1);
}

export function mapApiDevice(row: ApiDevice, brands?: ApiBrand[]): DeviceModel & { imageUrl?: string | null } {
  const storagePrices: Record<string, number> = {};
  const priceMatrix: Record<string, Partial<Record<ConditionGrade, number>>> = {};
  if (row.price_matrix) {
    for (const [storage, grades] of Object.entries(row.price_matrix)) {
      priceMatrix[storage] = grades as Partial<Record<ConditionGrade, number>>;
      const pristine = grades.flawless ?? grades.good ?? 0;
      if (pristine > 0) storagePrices[storage] = pristine;
    }
  }
  return {
    id: row.id,
    category: row.category_id as DeviceCategory,
    brand: brandNameFromId(row.brand_id, brands),
    name: row.name,
    storages: row.storages?.length ? row.storages : ["128GB"],
    basePrice: row.max_price_flawless ?? 0,
    storagePrices: Object.keys(storagePrices).length ? storagePrices : undefined,
    priceMatrix: Object.keys(priceMatrix).length ? priceMatrix : undefined,
    imageUrl: row.image_url,
  };
}

export function deviceImageUrl(device: DeviceModel & { imageUrl?: string | null }): string | null {
  if (!device.imageUrl) return null;
  if (device.imageUrl.startsWith("http")) return device.imageUrl;
  return apiUrl(device.imageUrl);
}

export async function fetchCategories(): Promise<ApiCategory[]> {
  return fetchJson<ApiCategory[]>("/api/catalog/categories");
}

export async function fetchBrands(categoryId: string): Promise<ApiBrand[]> {
  return fetchJson<ApiBrand[]>(`/api/catalog/brands?category_id=${encodeURIComponent(categoryId)}`);
}

export async function fetchDevices(opts: {
  categoryId: string;
  brandId?: string | null;
  q?: string;
  limit?: number;
}): Promise<ApiDevice[]> {
  const params = new URLSearchParams({
    category_id: opts.categoryId,
    include_prices: "true",
    limit: String(opts.limit ?? 2000),
  });
  if (opts.brandId) params.set("brand_id", opts.brandId);
  if (opts.q?.trim()) params.set("q", opts.q.trim());
  return fetchJson<ApiDevice[]>(`/api/catalog/devices?${params}`);
}

export async function fetchQuote(body: QuoteRequest): Promise<QuoteResponse> {
  return fetchJson<QuoteResponse>("/api/quote", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function submitOffer(
  body: WidgetSubmitRequest,
): Promise<{ id: string; total_value: number; status?: string }> {
  return fetchJson("/api/widget/submit", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Upload angle photos as trade-in evidence after offer create. */
export async function uploadOfferMedia(
  offerId: string,
  files: Array<{ filename: string; mime_type: string; content_base64: string; angle?: string }>,
): Promise<{ ok: boolean; count: number }> {
  return fetchJson(`/api/widget/offers/${encodeURIComponent(offerId)}/media`, {
    method: "POST",
    body: JSON.stringify({ files }),
  });
}

export async function trackOffer(id: string): Promise<TrackedOffer> {
  return fetchJson<TrackedOffer>(`/api/widget/offers/${encodeURIComponent(id.trim())}`);
}

export interface PortalOffer extends TrackedOffer {
  portal: true;
  payout_status?: string;
  tracking_number?: string | null;
  courier?: string | null;
  shipping_label_url?: string | null;
  invoice?: { id: string; status: string; amount: number; issued_at?: string } | null;
}

export async function portalUnlock(offerId: string, email: string): Promise<PortalOffer> {
  return fetchJson<PortalOffer>("/api/widget/portal", {
    method: "POST",
    body: JSON.stringify({ offer_id: offerId.trim(), email: email.trim() }),
  });
}

export const DEFAULT_WIDGET_TEMPLATE = "techgenius";

/**
 * Org slug this widget instance belongs to, read from the host page:
 *   <div id="tg-trade-in-root" data-org="acme-wireless">
 * or the loading script tag. Returns null for the single-tenant install.
 */
export function embedOrgSlug(): string | null {
  if (typeof document === "undefined") return null;
  const mount = document.getElementById("tg-trade-in-root");
  const fromMount = mount?.getAttribute("data-org");
  if (fromMount) return fromMount.trim() || null;
  const script = document.querySelector<HTMLScriptElement>("script[data-org]");
  return script?.dataset.org?.trim() || null;
}

/**
 * Which frontend template the widget should render with. Never throws — a
 * template is cosmetic, so a failed lookup falls back to the default rather
 * than blocking the sell flow.
 */
/**
 * Who the shopper thinks they are dealing with.
 *
 * The widget is embedded on the merchant's own site, so it has to wear the
 * merchant's name. A shopper on redbull.example selling a phone is selling it
 * to Red Bull; showing the platform's name there would be as odd as a shop till
 * displaying the name of the company that made the till.
 *
 * Falls back to Tech Genius, which is both the original tenant and a safe
 * default if the lookup fails — better a name than an empty header.
 */
export interface OrgBranding {
  companyName: string;
  brandColor: string | null;
  ctaColor: string | null;
  logoUrl: string | null;
  plan: string | null;
}

const DEFAULT_BRANDING: OrgBranding = {
  companyName: "Tech Genius",
  brandColor: null,
  ctaColor: null,
  logoUrl: null,
  plan: null,
};

export async function fetchOrgBranding(orgSlug?: string | null): Promise<OrgBranding> {
  if (!orgSlug) return DEFAULT_BRANDING;
  try {
    const data = await fetchJson<{
      company_name?: string;
      brand_color?: string | null;
      cta_color?: string | null;
      logo_url?: string | null;
      plan?: string | null;
    }>(`/api/saas/widget-config?org=${encodeURIComponent(orgSlug)}`);
    return {
      companyName: data.company_name?.trim() || DEFAULT_BRANDING.companyName,
      brandColor: data.brand_color || null,
      ctaColor: data.cta_color || null,
      logoUrl: data.logo_url || null,
      plan: data.plan || null,
    };
  } catch {
    return DEFAULT_BRANDING;
  }
}

export async function fetchWidgetTemplate(orgSlug?: string | null): Promise<string> {
  try {
    const qs = orgSlug ? `?org=${encodeURIComponent(orgSlug)}` : "";
    const data = await fetchJson<{ template?: string }>(`/api/widget/template${qs}`);
    return data.template || DEFAULT_WIDGET_TEMPLATE;
  } catch {
    return DEFAULT_WIDGET_TEMPLATE;
  }
}

/**
 * Record an abandoned buyback so the shop can follow up.
 *
 * Fired once the shopper has both a priced device and a way to reach them, and
 * again as they progress. Most people who price a device never submit, and
 * without this every one of them is lost. Never throws and never blocks the
 * flow — a failed follow-up record must not cost us the sale in progress.
 */
export async function recordLead(payload: {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  offer_type?: string;
  payout_method?: string;
  furthest_step?: string;
  quoted_total?: number;
  items?: Array<{ device_id?: string; device_name?: string; storage?: string; condition_grade?: string; quoted_price?: number }>;
}): Promise<void> {
  if (!payload.email && !payload.phone) return;
  try {
    await fetchJson("/api/widget/lead", {
      method: "POST",
      body: JSON.stringify({ ...payload, org: embedOrgSlug() ?? undefined }),
    });
  } catch {
    /* follow-up is best-effort; never interrupt the sell flow */
  }
}

export async function checkApiHealth(): Promise<boolean> {
  try {
    await fetchJson<{ status: string }>("/api/health");
    return true;
  } catch {
    return false;
  }
}

/** Bootstrap a new phone/device from name only — builds image + catalog row. */
export async function ensureDeviceFromName(opts: {
  name: string;
  categoryId?: string | null;
  rebuildImage?: boolean;
}): Promise<{
  created: boolean;
  device: ApiDevice;
  image: { image_url: string; method: string } | null;
  pricesSeeded: number;
}> {
  return fetchJson("/api/widget/ensure-device", {
    method: "POST",
    body: JSON.stringify({
      name: opts.name,
      category_id: opts.categoryId ?? "smartphone",
      rebuild_image: opts.rebuildImage ?? false,
    }),
  });
}

/* ——— Repairs ——— */

export interface RepairProblem {
  id: string;
  label: string;
}

export interface RepairQuoteResponse {
  device_id: string;
  device_name: string;
  problem: string;
  problem_label: string;
  price: number | null;
  price_source: "override" | "formula" | "market" | "quote";
  needs_quote: boolean;
  /**
   * Where a market-derived part cost came from. Present only when the price
   * was built from a published supplier listing rather than set by the shop.
   */
  market?: {
    product: string;
    read_on: string;
    vendor: string;
    url: string;
    part_cost_cad: number;
    listed_price: number;
    listed_currency: string;
    /** null when the listing was already in CAD and nothing was converted. */
    fx_rate: number | null;
    in_stock: boolean | null;
    alternatives: number | null;
  } | null;
  /** The arithmetic behind the number, when there is one to show. */
  breakdown?: { part_cost: number; markup_percent: number; labour_fee: number } | null;
}

export async function fetchRepairProblems(): Promise<RepairProblem[]> {
  return fetchJson<RepairProblem[]>("/api/repair/problems");
}

export async function fetchRepairQuote(device_id: string, problem: string): Promise<RepairQuoteResponse> {
  return fetchJson<RepairQuoteResponse>("/api/repair/quote", {
    method: "POST",
    body: JSON.stringify({ device_id, problem }),
  });
}

export async function bookRepair(body: {
  contact: { first_name: string; last_name?: string; email?: string; phone?: string };
  device_id: string;
  problem: string;
  fulfilment: "drop-off" | "mail-in";
  notes?: string;
}): Promise<{ id: string; quoted_price: number | null; needs_quote: boolean; fulfilment: string }> {
  return fetchJson("/api/repair/book", { method: "POST", body: JSON.stringify(body) });
}
