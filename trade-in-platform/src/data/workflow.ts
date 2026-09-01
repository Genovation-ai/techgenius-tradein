/**
 * Competitor-aligned sell workflow (GoRecell + UniverCell):
 * 1 Category (Phone/Tablet/Watch/Laptop) — image tiles
 * 2 Find device — search + brand chips + IMAGE grid (all brands in category)
 * 3 Details — storage / carrier
 * 4 Checklist — condition Qs
 * 5 Vision — photo/video AI (optional skip)
 * 6 Grade — confirm (AI-suggested, editable)
 * 7 Offer — Tech Genius cash only
 * 8 Payout — mail-in / drop-off + contact
 * 9 Done — Offer ID + track
 */
export const SELL_WORKFLOW = [
  "category",
  "device",
  "details",
  "valuation",
  "media-ai",
  "grade",
  "offer",
  "checkout",
  "done",
] as const;
