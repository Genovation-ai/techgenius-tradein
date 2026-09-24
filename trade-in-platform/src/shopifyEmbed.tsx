import { StrictMode, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TradeInFlow } from "./components/TradeInFlow";
import { RepairFlow } from "./components/RepairFlow";
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
 *        data-org="tech-genius"
 *        data-mode="both"></div>
 *
 * data-mode picks what the block offers:
 *   both    sell and repair, with a switch between them (default)
 *   sell    trade-in only — what every existing embed did before repairs
 *   repair  repair only, for a shop that wants it on its own page
 *
 * The default is "both" rather than "sell" on purpose: repairs existed for a
 * week in the admin and on the preview page while every live embed still
 * mounted the trade-in alone, so nobody visiting the shop could book one. An
 * embed that already says data-mode="sell" is unaffected.
 */
type Mode = "sell" | "repair";

let root: Root | null = null;

/**
 * Load the widget's typeface on the host page.
 *
 * The embed styles everything with --font-body, but nothing ever fetched the
 * font, so on Framer and Shopify the widget silently fell back to whatever the
 * shop's theme had loaded. Injected once, guarded by id, and harmless if the
 * host already has it.
 */
function ensureFont() {
  const ID = "tg-trade-in-font";
  if (document.getElementById(ID)) return;
  const link = document.createElement("link");
  link.id = ID;
  link.rel = "stylesheet";
  link.href =
    "https://fonts.googleapis.com/css2?family=PT+Sans:ital,wght@0,400;0,700;1,400;1,700&display=swap";
  document.head.appendChild(link);
}

/**
 * Sell and repair in one block.
 *
 * The switch is only drawn when the host asked for both; a single-purpose
 * embed shows its one flow with no chrome above it. #repair in the host page's
 * URL opens on repairs, so a shop can link straight to it from its own menu.
 */
function Widget({ offer }: { offer: "both" | Mode }) {
  const initial: Mode =
    offer === "repair" || (offer === "both" && window.location.hash === "#repair") ? "repair" : "sell";
  const [mode, setMode] = useState<Mode>(initial);

  useEffect(() => {
    if (offer !== "both") return;
    const onHash = () => setMode(window.location.hash === "#repair" ? "repair" : "sell");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [offer]);

  const choose = (m: Mode) => {
    setMode(m);
    // Replace rather than push: the switch is not a page the back button
    // should have to walk through on the shop's own site.
    window.history.replaceState(null, "", m === "repair" ? "#repair" : window.location.pathname + window.location.search);
  };

  return (
    <>
      {offer === "both" ? (
        <div className="mode-switch" role="tablist" aria-label="Sell or repair">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "sell"}
            className={mode === "sell" ? "is-on" : ""}
            onClick={() => choose("sell")}
          >
            Sell
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "repair"}
            className={mode === "repair" ? "is-on" : ""}
            onClick={() => choose("repair")}
          >
            Repair
          </button>
        </div>
      ) : null}

      {mode === "repair" ? <RepairFlow /> : <TradeInFlow />}
      {/* Tracking is for trade-in offers; a repair has its own id and the
          shop calls about it. */}
      {mode === "sell" ? <TrackOffer /> : null}
    </>
  );
}

function mount() {
  ensureFont();
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

  const asked = (el.getAttribute("data-mode") || "both").trim().toLowerCase();
  const offer: "both" | Mode = asked === "sell" || asked === "repair" ? asked : "both";

  // Framer previews re-run this on every edit; reuse the root so React does not
  // warn about mounting twice into the same container.
  root ??= createRoot(el);
  root.render(
    <StrictMode>
      <div className="tg-trade-in-host" data-platform="techgenius">
        <WidgetErrorBoundary>
          <Widget offer={offer} />
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
