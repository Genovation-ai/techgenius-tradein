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
          {/* One line, not a banner. The old intro — an eyebrow, a heading, a
              sentence of pitch and a row of links — was 206px tall and pushed
              the category grid to 559px on a phone, so the first thing a
              customer saw was text about selling rather than the thing to tap.
              The widget's own heading asks the question; this only names the
              shop. The dev links moved to the foot, where they were never the
              customer's business anyway. */}
          <div className="trade-intro trade-intro--slim">
            <h1>Sell your device for cash</h1>
          </div>
          <TradeInFlow />
          <TrackOffer />
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
