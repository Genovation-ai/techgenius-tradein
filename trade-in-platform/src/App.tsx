import { useEffect, useState } from "react";
import { TradeInFlow } from "./components/TradeInFlow";
import { RepairFlow } from "./components/RepairFlow";
import { TrackOffer } from "./components/TrackOffer";
import { TgMark } from "./components/BrandIcons";
import "./AppShell.css";

/**
 * Local preview of the Shopify embed for shoptechgenius.ca.
 * Production: mount on https://shoptechgenius.ca/pages/sell-my-device
 *
 * Two things a customer can come here to do, one switch between them. The
 * choice is also in the URL hash (#repair) so a shop can link straight to
 * repairs from its own navigation, and so a reload keeps the customer where
 * they were.
 */
type Mode = "sell" | "repair";

function modeFromHash(): Mode {
  return typeof window !== "undefined" && window.location.hash === "#repair" ? "repair" : "sell";
}

export default function App() {
  const [mode, setMode] = useState<Mode>(modeFromHash);

  useEffect(() => {
    const onHash = () => setMode(modeFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const choose = (m: Mode) => {
    setMode(m);
    window.history.replaceState(null, "", m === "repair" ? "#repair" : window.location.pathname);
  };

  return (
    <div className="app-shell">
      <header className="tg-top">
        <div className="container tg-top-inner">
          <span className="tg-logo">
            <TgMark size={24} />
            Tech Genius
          </span>
          <span className="tg-top-note">Burlington · {mode === "repair" ? "Repairs" : "Sell for cash"}</span>
        </div>
      </header>

      <main className="main">
        <div className="container trade-page">
          <div className="trade-intro trade-intro--slim">
            <h1>{mode === "repair" ? "Get your device repaired" : "Sell your device for cash"}</h1>
          </div>

          <div className="mode-switch" role="tablist" aria-label="What would you like to do?">
            <button type="button" role="tab" aria-selected={mode === "sell"} className={mode === "sell" ? "is-on" : ""} onClick={() => choose("sell")}>
              Sell
            </button>
            <button type="button" role="tab" aria-selected={mode === "repair"} className={mode === "repair" ? "is-on" : ""} onClick={() => choose("repair")}>
              Repair
            </button>
          </div>

          {mode === "repair" ? <RepairFlow /> : <TradeInFlow />}
          {mode === "sell" ? <TrackOffer /> : null}
          <p className="embed-banner">
            Live on{" "}
            <a href="https://shoptechgenius.ca/pages/sell-my-device" target="_blank" rel="noreferrer">
              shoptechgenius.ca
            </a>
            {" · "}
            <a href="/admin">Admin</a>
          </p>
        </div>
      </main>

      <footer className="tg-foot">
        <div className="container">Tech Genius Burlington · Fair offers · Fast payouts</div>
      </footer>
    </div>
  );
}
