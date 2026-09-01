const API_BASE =
  (import.meta.env.VITE_TRADE_IN_API_URL as string | undefined)?.replace(/\/$/, "") || "";

const KEY_STORAGE = "tg-admin-session";
const USER_STORAGE = "tg-admin-user";
const ORG_STORAGE = "tg-admin-org";

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
  org_id?: string;
}

export interface AdminOrg {
  id: string;
  slug: string;
  name: string;
  plan: string;
  status: string;
}

export function getAdminApiKey(): string {
  return localStorage.getItem(KEY_STORAGE) || "";
}

export function setAdminApiKey(key: string): void {
  localStorage.setItem(KEY_STORAGE, key);
}

export function getAdminUser(): AdminUser | null {
  try {
    const raw = localStorage.getItem(USER_STORAGE);
    return raw ? (JSON.parse(raw) as AdminUser) : null;
  } catch {
    return null;
  }
}

export function setAdminUser(user: AdminUser | null): void {
  if (!user) localStorage.removeItem(USER_STORAGE);
  else localStorage.setItem(USER_STORAGE, JSON.stringify(user));
}

export function getAdminOrg(): AdminOrg | null {
  try {
    const raw = localStorage.getItem(ORG_STORAGE);
    return raw ? (JSON.parse(raw) as AdminOrg) : null;
  } catch {
    return null;
  }
}

export function setAdminOrg(org: AdminOrg | null): void {
  if (!org) localStorage.removeItem(ORG_STORAGE);
  else localStorage.setItem(ORG_STORAGE, JSON.stringify(org));
}

export function clearAdminSession(): void {
  localStorage.removeItem(KEY_STORAGE);
  localStorage.removeItem(USER_STORAGE);
  localStorage.removeItem(ORG_STORAGE);
}

const STORE_KEY = "tg-admin-store";

/**
 * Store currently selected in the admin header, or null for "not chosen yet".
 * Ops lists pass this as `store_id` so a multi-location shop sees one desk's
 * work rather than every location's.
 */
export function currentStoreId(): string | null {
  return localStorage.getItem(STORE_KEY);
}

/** Append the selected store to a query string, when one is selected. */
export function withStoreScope(params: URLSearchParams): URLSearchParams {
  const store = currentStoreId();
  if (store) params.set("store_id", store);
  return params;
}

/**
 * Subscribe to store-selector changes. AdminLayout dispatches `tg-admin-store`
 * whenever staff switch locations; every scoped list reloads through this.
 */
export function onStoreChange(handler: () => void): () => void {
  window.addEventListener(STORE_KEY, handler);
  return () => window.removeEventListener(STORE_KEY, handler);
}

export function apiUrl(path: string): string {
  const base = API_BASE || window.location.origin;
  if (!path) return base;
  if (path.startsWith("http")) return path;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Resolve a device's photo URL. Returns "" when we have nothing for this
 * device — callers should render a neutral placeholder (see DeviceThumb).
 * It deliberately does not fall back to a stock handset: showing an iPhone
 * where a Pixel belongs is the same mis-identification bug the catalog image
 * repair removed.
 */
export function deviceImgSrc(imageUrl?: string | null, deviceId?: string | null): string {
  if (imageUrl) return apiUrl(imageUrl);
  if (deviceId) return apiUrl(`/devices/${deviceId}.png`);
  return "";
}

export async function loginAdmin(email: string, password: string): Promise<{
  token: string;
  user: AdminUser;
  org?: AdminOrg;
}> {
  const res = await fetch(apiUrl("/api/auth/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  const data = (await res.json()) as { token: string; user: AdminUser; org?: AdminOrg };
  setAdminApiKey(data.token);
  setAdminUser(data.user);
  if (data.org) setAdminOrg(data.org);
  return data;
}

export async function signupShop(body: {
  company_name: string;
  slug?: string;
  email: string;
  password: string;
  admin_name?: string;
  phone?: string;
}): Promise<{ token: string; user: AdminUser; org: AdminOrg; api_key: string }> {
  const res = await fetch(apiUrl("/api/saas/signup"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    token: string;
    user: AdminUser;
    org: AdminOrg;
    api_key: string;
  };
  setAdminApiKey(data.token);
  setAdminUser(data.user);
  setAdminOrg(data.org);
  return data;
}

export async function logoutAdmin(): Promise<void> {
  const token = getAdminApiKey();
  try {
    if (token) {
      await fetch(apiUrl("/api/auth/logout"), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": token },
      });
    }
  } finally {
    clearAdminSession();
  }
}

export async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const key = getAdminApiKey();
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    if (res.status === 401) clearAdminSession();
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface DashboardData {
  pipeline: Array<{ status: string; count: number; total: number }>;
  stats: {
    total_offers: number;
    total_customers: number;
    available_inventory: number;
    completed_revenue: number;
  };
}

export interface OfferRow {
  id: string;
  status: string;
  total_value: number;
  offer_type?: string;
  payout_method?: string;
  created_at?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
}

export interface OfferDetail extends OfferRow {
  phone?: string;
  notes?: string;
  shipping_label_url?: string;
  tracking_number?: string;
  courier?: string;
  payout_status?: string;
  store_id?: string;
  invoice?: { id: string; status: string; amount: number } | null;
  uploads?: Array<{
    id: string;
    filename: string;
    mime_type: string;
    size_bytes: number;
    created_at?: string;
    /** Capture angle from the widget vision step (front/back/left/right); null for staff uploads. */
    angle?: string | null;
  }>;
  items: Array<{
    id: number;
    device_id?: string;
    device_name: string;
    storage?: string;
    carrier?: string;
    condition_grade?: string;
    quoted_price: number;
    final_price?: number;
    battery_health?: number;
    imei?: string;
    device_image_url?: string;
  }>;
}

export interface CatalogDevice {
  id: string;
  category_id: string;
  brand_id: string;
  name: string;
  storages: string[];
  image_url?: string | null;
  max_price_flawless?: number;
  enabled?: number;
  price_matrix?: Record<string, Partial<Record<string, number>>>;
  prices?: Array<{
    device_id: string;
    storage: string;
    condition_grade: string;
    base_price: number;
    source: string;
    updated_at: string;
  }>;
}

export const PIPELINE_STAGES = [
  { id: "active_lead", label: "Active Leads" },
  { id: "in_transit", label: "In Transit" },
  { id: "delivered", label: "Delivered" },
  { id: "being_inspected", label: "Being Inspected" },
  { id: "general_hold", label: "General Hold" },
  { id: "payout_processing", label: "Payout Processing" },
  { id: "revised_offer", label: "Revised Offer" },
  { id: "completed", label: "Completed" },
  { id: "returned", label: "Returned" },
] as const;

const CHANNEL_KEY = "tg-admin-channel";

export function getAdminChannelPreference(): string {
  try {
    return localStorage.getItem(CHANNEL_KEY) || "mail-in";
  } catch {
    return "mail-in";
  }
}

export function setAdminChannelPreference(channel: string): void {
  try {
    localStorage.setItem(CHANNEL_KEY, channel);
  } catch {
    /* ignore */
  }
}
