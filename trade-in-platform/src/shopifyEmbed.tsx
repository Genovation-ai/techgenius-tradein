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

/*
 * Where this script was served from, captured while the browser is still
 * executing it.
 *
 * document.currentScript is only non-null during that first synchronous run,
 * so it has to be read at module top rather than inside a function called
 * later.
 */
const SCRIPT_SRC: string =
  (document.currentScript as HTMLScriptElement | null)?.src ||
  Array.from(document.querySelectorAll<HTMLScriptElement>("script[src]"))
    .map((el) => el.src)
    .find((src) => /tg-trade-in(\.lite)?\.js(\?|$)/.test(src)) ||
  "";

/**
 * Bring our own stylesheet.
 *
 * The site tells a shop to paste two lines: a div and this script. Two lines
 * is the promise and it was not true — the widget needs its stylesheet as
 * well, and without it a new customer's first act after subscribing was to
 * paste the snippet and get Times New Roman, square grey buttons and the
 * progress bar rendered as a numbered list. Nothing was broken; it simply
 * looked like nothing worked.
 *
 * The script knows its own URL, so it can fetch the stylesheet sitting beside
 * it. Guarded by id and by href, so an embed that already links the CSS — the
 * shops set up by hand before this existed — does not load it twice.
 */
function ensureStyles() {
  if (!SCRIPT_SRC) return;
  const ID = "tg-trade-in-styles";
  if (document.getElementById(ID)) return;

  const href = SCRIPT_SRC.replace(/\.js(\?.*)?$/, ".css$1");
  if (href === SCRIPT_SRC) return;

  const already = Array.from(
    document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
  ).some((l) => l.href === href);
  if (already) return;

  const link = document.createElement("link");
  link.id = ID;
  link.rel = "stylesheet";
  link.href = href;
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
    // Keep the choice in the URL so it can be linked to and so a reload lands
    // where the customer was — but only where that is possible.
    //
    // On Framer the widget runs inside an about:srcdoc iframe, whose document
    // has the parent's origin and the URL "about:srcdoc". Asking that document
    // to rewrite its history to "/srcdoc" throws a SecurityError, which is
    // what every Sell/Repair tap on the live site was doing. The switch still
    // worked because the throw came after setMode, but it filled the console
    // with an error on the shop's own page, and anything added after that line
    // would never have run.
    //
    // Replace rather than push: the switch is not a page the back button
    // should have to walk through.
    try {
      if (window.location.protocol === "about:") return;
      const next = m === "repair" ? "#repair" : window.location.pathname + window.location.search;
      window.history.replaceState(null, "", next);
    } catch {
      // A host that will not let us touch history is not a reason to fail to
      // switch; the customer already sees the flow they asked for.
    }
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
  ensureStyles();
  const el = document.getElementById(MOUNT_ID);
  if (!el) {
    console.warn(`[Gadget Swap] #${MOUNT_ID} not found on page.`);
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
