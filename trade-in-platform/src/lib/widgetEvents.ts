/**
 * Browser events the widget emits so the host page can measure the funnel.
 *
 * On Framer or Shopify the widget is an opaque island: the shop can see traffic
 * land on /sell and can see offers arrive in admin, but nothing in between. No
 * way to answer "how many people priced a device and left", which step loses
 * them, or whether a campaign converts. Reusely emits its own events for the
 * same reason.
 *
 * These are plain CustomEvents on `window`, so any analytics tool already on the
 * page can listen without us bundling or endorsing one:
 *
 *   window.addEventListener("techgenius:offer_shown", (e) => {
 *     gtag("event", "trade_in_offer", { value: e.detail.value });
 *   });
 *
 * Rules: never include personal data (no name, email or phone) — the host page
 * may forward these to third parties. Device, step and amount only. Emitting is
 * best-effort and must never interrupt the sell flow.
 */

export type WidgetEventName =
  | "techgenius:flow_started"
  | "techgenius:device_selected"
  | "techgenius:offer_shown"
  | "techgenius:offer_accepted"
  | "techgenius:device_added"
  | "techgenius:offer_submitted"
  | "techgenius:quote_failed"
  | "techgenius:widget_error";

export interface WidgetEventDetail {
  step?: string;
  deviceId?: string;
  deviceName?: string;
  storage?: string | null;
  grade?: string | null;
  value?: number | null;
  currency?: string;
  itemCount?: number;
  offerId?: string;
  /** Error class/message for techgenius:widget_error. Never carries shopper input. */
  error?: string;
}

export function emitWidgetEvent(name: WidgetEventName, detail: WidgetEventDetail = {}): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(
      new CustomEvent(name, { detail: { currency: "CAD", ...detail } }),
    );
  } catch {
    /* analytics must never break the flow */
  }
}
