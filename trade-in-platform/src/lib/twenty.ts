import type { SavedOffer } from "./offers";

export type TwentyStage =
  | "new-lead"
  | "instant-quote"
  | "dropoff-or-mailin"
  | "inspection"
  | "final-offer"
  | "paid-closed";

export interface TwentyOpportunityPayload {
  externalId: string;
  name: string;
  stage: TwentyStage;
  amountCad: number;
  pricingLabel: "Tech Genius Pricing";
  metadata: {
    sourceCount: number;
    sourceVersion: string;
    method: "mail-in" | "drop-off";
    payout: SavedOffer["contact"]["payout"];
  };
}

export interface TwentyContactPayload {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

export interface TwentyTradeInRecord {
  contact: TwentyContactPayload;
  opportunity: TwentyOpportunityPayload;
  timelineNote: string;
}

export function mapOfferToTwenty(offer: SavedOffer): TwentyTradeInRecord {
  const primary = offer.devices[0];
  const itemLabel =
    offer.devices.length > 1
      ? `${primary?.deviceName ?? "Device"} + ${offer.devices.length - 1} more`
      : primary?.deviceName ?? "Trade-In Device";

  return {
    contact: {
      firstName: offer.contact.firstName,
      lastName: offer.contact.lastName,
      email: offer.contact.email,
      phone: offer.contact.phone,
    },
    opportunity: {
      externalId: offer.id,
      name: `Trade-In ${offer.id} · ${itemLabel}`,
      stage: inferTwentyStage(offer.status),
      amountCad: offer.total,
      pricingLabel: "Tech Genius Pricing",
      metadata: {
        sourceCount: offer.pricing?.sourceCount ?? 0,
        sourceVersion: offer.pricing?.sourceVersion ?? "v1",
        method: offer.contact.method,
        payout: offer.contact.payout,
      },
    },
    timelineNote: buildTimelineNote(offer),
  };
}

function inferTwentyStage(status: SavedOffer["status"]): TwentyStage {
  switch (status) {
    case "reserved":
      return "instant-quote";
    case "shipped":
      return "dropoff-or-mailin";
    case "received":
      return "inspection";
    case "paid":
      return "paid-closed";
  }
}

function buildTimelineNote(offer: SavedOffer): string {
  const modelSummary = offer.devices
    .map((d) => `${d.deviceName} ${d.storage} · ${d.grade} · $${d.offer}`)
    .join(" | ");
  return [
    `Offer ${offer.id} created ${offer.createdAt}`,
    `Method: ${offer.contact.method} · Payout: ${offer.contact.payout}`,
    `Models: ${modelSummary}`,
  ].join("\n");
}

/**
 * Push offer to CRM via backend outbox.
 * Requires admin session + TG_CRM_WEBHOOK_URL on the server for live delivery.
 * Without the webhook, events are stored as blocked in crm_outbox (not a fake success).
 */
export async function pushOfferToCrm(offerId: string, token: string): Promise<{
  status: "sent" | "blocked" | "failed";
  detail?: string;
}> {
  const base =
    (import.meta.env.VITE_TRADE_IN_API_URL as string | undefined)?.replace(/\/$/, "") ||
    window.location.origin;
  const res = await fetch(`${base}/api/integrations/crm/dispatch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": token,
    },
    body: JSON.stringify({ offer_id: offerId, type: "offer.sync" }),
  });
  const data = (await res.json()) as { status?: "sent" | "blocked" | "failed"; detail?: string; error?: string };
  if (!res.ok) throw new Error(data.error || `CRM dispatch HTTP ${res.status}`);
  return { status: data.status || "failed", detail: data.detail };
}
