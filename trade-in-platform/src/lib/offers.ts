import type { QuotedDevice, ContactInfo } from "./tradeInTypes";

export interface SavedOffer {
  id: string;
  createdAt: string;
  status: "reserved" | "shipped" | "received" | "paid";
  devices: QuotedDevice[];
  total: number;
  contact: Pick<
    ContactInfo,
    "firstName" | "lastName" | "email" | "phone" | "payout" | "method" | "storeId"
  >;
  pricing?: {
    sourceCount: number;
    sourceVersion: string;
  };
}

const STORAGE_KEY = "tg-trade-in-offers-v1";
const TWENTY_OUTBOX_KEY = "tg-twenty-outbox-v1";

export function createOfferId(): string {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `TG-${stamp}-${rand}`;
}

export function saveOffer(offer: SavedOffer): void {
  const all = listOffers();
  all.unshift(offer);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all.slice(0, 50)));
}

export function pushTwentyOutbox(record: unknown): void {
  try {
    const raw = localStorage.getItem(TWENTY_OUTBOX_KEY);
    const list = raw ? (JSON.parse(raw) as unknown[]) : [];
    list.unshift(record);
    localStorage.setItem(TWENTY_OUTBOX_KEY, JSON.stringify(list.slice(0, 100)));
  } catch {
    // no-op in constrained environments
  }
}

export function listOffers(): SavedOffer[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedOffer[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function findOffer(id: string): SavedOffer | null {
  const needle = id.trim().toUpperCase();
  return listOffers().find((o) => o.id.toUpperCase() === needle) ?? null;
}
