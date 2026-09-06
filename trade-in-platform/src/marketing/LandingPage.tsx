import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion, useMotionValueEvent, useScroll, useReducedMotion } from "framer-motion";
import { fetchDevices, fetchQuote, type ApiDevice } from "../lib/tradeInApi";
import "./LandingPage.css";

/**
 * Reclaim — the platform's own page, for shop owners rather than shoppers.
 *
 * The hero is a real quote against the live catalogue, not a screenshot of one.
 * A shop owner deciding whether to buy this does not want to read about pricing
 * accuracy; they want to type in a phone they bought last week and see whether
 * the number is one they would actually have paid. So that is the hero: the
 * product doing its only job, in public, before any claim is made about it.
 */

function useCountUp(target: number | null, enabled: boolean): number | null {
  const [shown, setShown] = useState<number | null>(null);
  useEffect(() => {
    if (target === null) {
      setShown(null);
      return;
    }
    if (!enabled) {
      setShown(target);
      return;
    }
    const from = 0;
    const start = performance.now();
    const ms = 520;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      // ease-out: the number decelerates into place rather than snapping
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(from + (target - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, enabled]);
  return shown;
}

export default function LandingPage() {
  const reduce = useReducedMotion();
  const [query, setQuery] = useState("");
  const [devices, setDevices] = useState<ApiDevice[]>([]);
  const [picked, setPicked] = useState<ApiDevice | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const { scrollY } = useScroll();
  const [stuck, setStuck] = useState(false);
  useMotionValueEvent(scrollY, "change", (v) => setStuck(v > 8));
  const heroRef = useRef<HTMLDivElement | null>(null);
  const [pastHero, setPastHero] = useState(false);
  useMotionValueEvent(scrollY, "change", (v) => {
    const h = heroRef.current?.getBoundingClientRect().height ?? 640;
    setPastHero(v > h * 0.75);
  });

  useEffect(() => {
    void fetchDevices({ categoryId: "smartphone", limit: 400 })
      .then(setDevices)
      .catch(() => setDevices([]));
  }, []);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Only models we can actually price — an empty result in the hero would
    // undercut the exact claim the hero is making.
    const pool = devices.filter((d) => (d.storages?.length ?? 0) > 0);
    if (!q) return pool.slice(0, 5);
    return pool.filter((d) => d.name.toLowerCase().includes(q)).slice(0, 5);
  }, [devices, query]);

  async function quote(device: ApiDevice) {
    setPicked(device);
    setPending(true);
    setFailed(false);
    setPrice(null);
    try {
      const storage = device.storages?.[0] ?? "";
      const res = await fetchQuote({
        device_id: device.id,
        storage,
        condition_grade: "good",
      });
      setPrice(res?.quoted_price ?? null);
      if (!res?.quoted_price) setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  const shown = useCountUp(price, !reduce);

  return (
    <div className="rc">
      <header className="rc-nav" data-stuck={stuck}>
        <div className="rc-wrap rc-nav-in">
          <span className="rc-mark">
            <span className="rc-mark-dot" aria-hidden />
            Reclaim
          </span>
          {pastHero && price !== null ? (
            <motion.span
              className="rc-nav-price"
              initial={reduce ? false : { opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28 }}
            >
              {picked?.name}{"  "}${price}
            </motion.span>
          ) : null}
          <span className="rc-nav-cta">
            <Link className="rc-btn rc-btn--quiet" to="/admin/login">
              Sign in
            </Link>
            <Link className="rc-btn" to="/admin/signup">
              Start free
            </Link>
          </span>
        </div>
      </header>

      <main>
        <section className="rc-hero" ref={heroRef}>
          <div className="rc-wrap rc-hero-grid">
            <div>
              <h1>Know what a used phone is worth before you buy it.</h1>
              <p className="rc-hero-sub">
                Reclaim prices trade-ins from what buyers are paying this week, puts the
                quote on your website, and tracks the device through to payout.
              </p>
              <div className="rc-hero-actions">
                <Link className="rc-btn" to="/admin/signup">
                  Start free
                </Link>
                <a className="rc-btn rc-btn--quiet" href="#install">
                  See how it installs
                </a>
              </div>
              <p className="rc-hero-note">
                No card to start. Your first quote works before you finish reading this page.
              </p>
            </div>

            <div className="rc-quote">
              <p className="rc-quote-label">Try it — this is the live pricing engine.</p>
              <input
                className="rc-quote-input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search a phone, e.g. iPhone 15"
                aria-label="Search a device to price"
              />
              <ul className="rc-quote-list">
                {matches.map((d) => (
                  <li key={d.id}>
                    <button
                      type="button"
                      data-active={picked?.id === d.id}
                      onClick={() => void quote(d)}
                    >
                      {d.name}
                    </button>
                  </li>
                ))}
                {!matches.length ? (
                  <li className="rc-quote-empty">No match. Try another model.</li>
                ) : null}
              </ul>

              <div className="rc-quote-out">
                {pending ? (
                  <span className="rc-quote-empty">Pricing…</span>
                ) : failed ? (
                  <span className="rc-quote-empty">
                    No price for that one yet — the catalogue is still filling in.
                  </span>
                ) : shown !== null ? (
                  <>
                    <span className="rc-price">${shown}</span>
                    <span className="rc-price-sub">
                      {picked?.name} in good condition, paid today
                    </span>
                  </>
                ) : (
                  <span className="rc-quote-empty">Pick a model to see a real offer.</span>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="rc-section">
          <div className="rc-wrap">
            <h2>Most shops guess. Guessing is what costs you.</h2>
            <p className="rc-section-lead">
              Pay over the market and the margin is gone before the device reaches the
              shelf. Pay under and the customer walks to whoever quoted them properly.
            </p>
            <div className="rc-points">
              <div className="rc-point">
                <h3>Priced against the market</h3>
                <p>
                  Reclaim reads what buyers publish, and quotes a set percentage under it.
                  You choose the margin once; every model follows it.
                </p>
              </div>
              <div className="rc-point">
                <h3>The offer is the server's</h3>
                <p>
                  Prices are never calculated in the browser, so nobody can edit one before
                  submitting. What the customer accepts is what you agreed to pay.
                </p>
              </div>
              <div className="rc-point">
                <h3>Nothing quietly goes stale</h3>
                <p>
                  Sources refresh weekly. If a feed stops answering, the dashboard says so
                  instead of serving last month's numbers.
                </p>
              </div>
              <div className="rc-point">
                <h3>The ones who left</h3>
                <p>
                  Customers who got a quote and didn't finish land on a follow-up list with
                  their device and price. That list is usually the cheapest revenue you have.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="rc-section" id="install">
          <div className="rc-wrap">
            <h2>One block of HTML, on any site.</h2>
            <p className="rc-section-lead">
              Works on Framer, Shopify, WordPress or hand-written HTML. Your shop's name and
              colours come through automatically — customers never see ours.
            </p>
            <div className="rc-install">
              <pre>{`<div id="tg-trade-in-root"
     data-api="https://api.reclaim.app"
     `}<span className="tok">data-org="your-shop"</span>{`></div>
<script src="https://api.reclaim.app/embed/tg-trade-in.js" defer></script>`}</pre>
            </div>
          </div>
        </section>

        <section className="rc-section">
          <div className="rc-wrap">
            <h2>Plans</h2>
            <p className="rc-section-lead">
              Start free while you decide. Upgrade when the trade-ins justify it.
            </p>
            <div className="rc-plans">
              <div className="rc-plan">
                <h3>Free</h3>
                <p className="rc-plan-price">
                  $0<span> / month</span>
                </p>
                <ul>
                  <li>Up to 25 offers a month</li>
                  <li>Full device catalogue</li>
                  <li>Widget on one site</li>
                  <li>Follow-up list</li>
                </ul>
                <Link className="rc-btn rc-btn--quiet" to="/admin/signup">
                  Start free
                </Link>
              </div>
              <div className="rc-plan" data-featured="true">
                <h3>Shop</h3>
                <p className="rc-plan-price">
                  $49<span> / month</span>
                </p>
                <ul>
                  <li>Unlimited offers</li>
                  <li>Your colours and logo</li>
                  <li>Staff accounts and roles</li>
                  <li>Inventory, invoices, payouts</li>
                </ul>
                <Link className="rc-btn" to="/admin/signup">
                  Start free trial
                </Link>
              </div>
              <div className="rc-plan">
                <h3>Group</h3>
                <p className="rc-plan-price">
                  $149<span> / month</span>
                </p>
                <ul>
                  <li>Several locations</li>
                  <li>Per-store pricing</li>
                  <li>API access</li>
                  <li>Priority support</li>
                </ul>
                <Link className="rc-btn rc-btn--quiet" to="/admin/signup">
                  Start free trial
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="rc-wrap rc-foot">
        <span>Reclaim — trade-in software for repair shops and resellers.</span>
        <Link to="/admin/login">Sign in</Link>
        <Link to="/preview">Widget preview</Link>
      </footer>
    </div>
  );
}
