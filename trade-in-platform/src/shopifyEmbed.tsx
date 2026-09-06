import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TradeInFlow } from "./components/TradeInFlow";
import { TrackOffer } from "./components/TrackOffer";
import { WidgetErrorBoundary } from "./components/WidgetErrorBoundary";
import { resetApiBase } from "./lib/tradeInApi";
import "./tokens.css";
import "./embedHost.css";

const MOUNT_ID = "tg-trade-in-root";

/**
 * Embed entry for techgenius.ca /sell (Framer) and shoptechgenius.ca (Shopify).
 * Mounts into #tg-trade-in-root. Does not restyle host body/html.
 *
 * The host page configures the backend, so one built file works everywhere:
 *   <div id="tg-trade-in-root"
 *        data-api="https://api.techgenius.ca"
 *        data-org="tech-genius"></div>
 */
let root: Root | null = null;

function mount() {
  const el = document.getElementById(MOUNT_ID);
  if (!el) {
    console.warn(`[Reclaim] #${MOUNT_ID} not found on page.`);
    return;
  }

  // Promote data-api to the global before anything can fetch, so the API origin
  // is resolved from this element even if the element mounted late (Framer
  // renders its canvas asynchronously).
  const api = el.getAttribute("data-api")?.trim();
  if (api) {
    (window as { TG_TRADE_IN_API?: string }).TG_TRADE_IN_API = api.replace(/\/$/, "");
    resetApiBase();
  }

  // Framer previews re-run this on every edit; reuse the root so React does not
  // warn about mounting twice into the same container.
  root ??= createRoot(el);
  root.render(
    <StrictMode>
      <div className="tg-trade-in-host" data-platform="techgenius">
        <WidgetErrorBoundary>
          <TradeInFlow />
          <TrackOffer />
        </WidgetErrorBoundary>
      </div>
    </StrictMode>,
  );
}

declare global {
  interface Window {
    TechGeniusTradeIn?: { remount: () => void };
    TG_TRADE_IN_API?: string;
  }
}

window.TechGeniusTradeIn = { remount: mount };

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount);
} else {
  mount();
}
