import { TradeInFlow } from "./components/TradeInFlow";
import { TrackOffer } from "./components/TrackOffer";
import { TgMark } from "./components/BrandIcons";
import "./AppShell.css";

/**
 * Local preview of the Shopify embed for shoptechgenius.ca.
 * Production: mount on https://shoptechgenius.ca/pages/sell-my-device
 */
export default function App() {
  return (
    <div className="app-shell">
      <header className="tg-top">
        <div className="container tg-top-inner">
          <span className="tg-logo">
            <TgMark size={24} />
            Tech Genius
          </span>
          <span className="tg-top-note">Burlington · Sell for cash</span>
        </div>
      </header>

      <main className="main">
        <div className="container trade-page">
          <div className="trade-intro">
            <span className="brand-line">Trade-in</span>
            <h1>Sell your device for cash</h1>
            <p>
              Pick your model, answer a few condition questions, and get a clear offer from Tech
              Genius — mail it in or drop by the shop.
            </p>
            <p className="embed-banner">
              Live on{" "}
              <a href="https://shoptechgenius.ca/pages/sell-my-device" target="_blank" rel="noreferrer">
                shoptechgenius.ca
              </a>
              {" · "}
              <a href="/admin">Admin</a>
            </p>
          </div>
          <TradeInFlow />
          <TrackOffer />
        </div>
      </main>

      <footer className="tg-foot">
        <div className="container">Tech Genius Burlington · Fair offers · Fast payouts</div>
      </footer>
    </div>
  );
}
