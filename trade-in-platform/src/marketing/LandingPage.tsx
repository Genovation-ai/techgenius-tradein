import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  motion,
  useMotionValueEvent,
  useScroll,
  useTransform,
  useReducedMotion,
} from "framer-motion";
import { fetchDevices, fetchQuote, type ApiDevice } from "../lib/tradeInApi";
import "./LandingPage.css";

/**
 * Three and its postprocessing addons are ~600 KB. Loading them from the main
 * bundle would put them in front of every staff member opening the admin, who
 * will never see this scene. Split out so only the landing page pays for it,
 * and so the page's text and the live quote render before the canvas arrives.
 */
const FlowWave = lazy(() => import("./FlowWave").then((m) => ({ default: m.FlowWave })));

/**
 * Reclaim — the platform's own page, for shop owners rather than shoppers.
 *
 * The hero is a real quote against the live catalogue, not a screenshot of one.
 * A shop owner deciding whether to buy this does not want to read about pricing
 * accuracy; they want to type in a phone they bought last week and see whether
 * the number is one they would actually have paid. So that is the hero: the
 * product doing its only job, in public, before any claim is made about it.
 */

/** Hero entrance: a short rise, reused by each line so the sequence reads as one move. */
const rise = {
  hidden: { opacity: 0, y: 12 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const } },
};

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


/**
 * The price band.
 *
 * Display-scale type that slides sideways as the page moves — the one piece of
 * motion typography here, and it is made of the product's own output rather
 * than a slogan: real models from the live catalogue and the money this engine
 * pays for them, ordered by value. Decorative repetition, so it is hidden from
 * assistive tech; the same figures are readable in the quote panel below it.
 */
function PriceBand({ devices }: { devices: ApiDevice[] }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement | null>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const x = useTransform(scrollYProgress, [0, 1], ["1%", "-36%"]);

  const items = useMemo(
    () =>
      devices
        .filter((d) => (d.max_price_flawless ?? 0) > 90)
        .sort((a, b) => (b.max_price_flawless ?? 0) - (a.max_price_flawless ?? 0))
        .slice(0, 12)
        .map((d) => ({ name: d.name, price: Math.round(d.max_price_flawless ?? 0) })),
    [devices],
  );

  // Nothing to say until the catalogue answers — an empty band would leave a
  // gap where the page's one moving line is supposed to be.
  if (!items.length) return null;

  return (
    <div className="rc-band" ref={ref} aria-hidden>
      <motion.div className="rc-band-row" style={reduce ? undefined : { x }}>
        {/* Doubled so the row still spans the viewport at the end of its travel. */}
        {[...items, ...items].map((it, i) => (
          <span className="rc-band-item" key={`${it.name}-${i}`}>
            {it.name}
            <b>${it.price}</b>
          </span>
        ))}
      </motion.div>
    </div>
  );
}

/**
 * How a price is built, revealed by scrolling.
 *
 * The single scroll-driven moment on the page, and it earns the scroll because
 * it is the product's actual mechanism rather than decoration: a competitor's
 * published price, the shop's margin, the resulting offer. The figures on the
 * left stay pinned and light up as the matching explanation passes, so the
 * arithmetic assembles itself while you read the reason for each line.
 */
function PriceBuild() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement | null>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 65%", "end 75%"] });
  const [active, setActive] = useState(0);
  useMotionValueEvent(scrollYProgress, "change", (v) => {
    setActive(v < 0.36 ? 0 : v < 0.7 ? 1 : 2);
  });

  const rows = [
    { k: "What another buyer pays", v: "$348" },
    { k: "Your margin", v: "−2%" },
    { k: "What you offer", v: "$341" },
  ];
  const steps = [
    {
      h: "Start from a real number",
      p: "Reclaim reads the prices other buyers publish for the exact model, storage and condition in front of you. Not an estimate, not last quarter's book value — what someone is paying for it this week.",
    },
    {
      h: "Take your margin off the top",
      p: "You set one percentage. Every model in the catalogue follows it, so the spread you agreed to is the spread you get, whether it's an iPhone 15 or a five-year-old Pixel nobody has priced in months.",
    },
    {
      h: "That is the offer, and it holds",
      p: "The figure is calculated on the server and handed to the customer whole. Nothing in the browser can move it, so what they accept on your website is exactly what you expected to pay at the counter.",
    },
  ];

  return (
    <section className="rc-section rc-build" ref={ref}>
      <div className="rc-wrap rc-build-grid">
        <div className="rc-build-sticky">
          <p className="rc-build-label">One quote, three decisions</p>
          <div className="rc-build-rows">
            {rows.map((r, i) => (
              <div key={r.k} className="rc-build-row" data-state={i < active ? "past" : i === active ? "now" : "next"}>
                <span>{r.k}</span>
                <motion.b
                  animate={reduce ? {} : { scale: i === active ? 1.06 : 1 }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                >
                  {r.v}
                </motion.b>
              </div>
            ))}
          </div>
        </div>

        <div className="rc-build-steps">
          {steps.map((s, i) => (
            <div key={s.h} className="rc-build-step" data-active={i === active}>
              <h3>{s.h}</h3>
              <p>{s.p}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
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

  // The scene needs a black ground under it before WebGL's first frame. The
  // stylesheet ships in the app-wide bundle, so the rule is scoped to this
  // class and removed when the page unmounts.
  useEffect(() => {
    document.documentElement.classList.add("rc-dark");
    return () => document.documentElement.classList.remove("rc-dark");
  }, []);

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
    if (q) return pool.filter((d) => d.name.toLowerCase().includes(q)).slice(0, 5);

    // The catalogue sorts alphabetically, which opened the hero on "Edge (2022)"
    // — a phone almost nobody is holding. Lead with the ones a shop actually
    // sees across the counter, and only fall back to raw order if none are in.
    const wanted = ["iPhone 15", "iPhone 14", "Galaxy S24", "Pixel 9", "iPhone 13"];
    const picked = wanted
      .map((w) => pool.find((d) => d.name.toLowerCase().startsWith(w.toLowerCase())))
      .filter((d): d is ApiDevice => Boolean(d));
    return picked.length >= 3 ? picked.slice(0, 5) : pool.slice(0, 5);
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
      <Suspense fallback={null}>
        <FlowWave />
      </Suspense>
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
          <div className="rc-wrap">
            <motion.div
              initial={reduce ? false : "hidden"}
              animate="shown"
              variants={{ shown: { transition: { staggerChildren: 0.085, delayChildren: 0.04 } } }}
            >
              <motion.h1 variants={rise}>
                <span>Know what a phone is worth</span>
                <span className="rc-line-ghost">before you pay for it.</span>
              </motion.h1>
              <motion.p className="rc-hero-sub" variants={rise}>
                Reclaim prices trade-ins from what buyers are paying this week, puts the
                quote on your website, and tracks the device through to payout.
              </motion.p>
              <motion.div className="rc-hero-actions" variants={rise}>
                <Link className="rc-btn" to="/admin/signup">
                  Start free
                </Link>
                <a className="rc-btn rc-btn--quiet" href="#install">
                  See how it installs
                </a>
              </motion.div>
              <motion.p className="rc-hero-note" variants={rise}>
                No card to start. Your first quote works before you finish reading this page.
              </motion.p>
              <motion.p className="rc-scroll-cue" variants={rise}>
                Scroll — the engine is running below
              </motion.p>
            </motion.div>
          </div>
        </section>

        {/* Everything past the hero sits on a veil (see .rc-below): the field
            stays visible as texture, but body copy gets a ground to read on. */}
        <div className="rc-below">
        <PriceBand devices={devices} />

        <section className="rc-try" id="try">
          <div className="rc-wrap">
            <h2>Type in a phone you bought last week.</h2>
            <p className="rc-try-lead">
              No sandbox, no sample data. This is the engine your customers would use,
              quoting against today's catalogue.
            </p>

            <motion.div
              className="rc-quote"
              initial={reduce ? false : { opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.24, ease: [0.22, 1, 0.36, 1] }}
            >
              <p className="rc-quote-label">Live pricing engine</p>
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
            </motion.div>
          </div>
        </section>

        <PriceBuild />

        <section className="rc-section">
          <div className="rc-wrap">
            <h2>Most shops guess. Guessing is what costs you.</h2>
            <p className="rc-section-lead">
              Pay over the market and the margin is gone before the device reaches the
              shelf. Pay under and the customer walks to whoever quoted them properly.
            </p>
            <div className="rc-points">
              <div className="rc-point">
                <h3>Nothing quietly goes stale</h3>
                <p>
                  Sources refresh weekly. If one stops answering, the dashboard says so
                  instead of serving last month's numbers as if they were current.
                </p>
              </div>
              <div className="rc-point">
                <h3>The ones who left</h3>
                <p>
                  Customers who got a price and didn't finish land on a follow-up list with
                  their device and the number they saw. Usually the cheapest revenue you have.
                </p>
              </div>
              <div className="rc-point">
                <h3>Your name on it</h3>
                <p>
                  The widget wears your shop's name, colours and logo. Customers are selling
                  to you — they never see us.
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
     data-api="https://reclaim-hq.up.railway.app"
     `}<span className="tok">data-org="your-shop"</span>{`></div>
<script src="https://reclaim-hq.up.railway.app/embed/tg-trade-in.js" defer></script>`}</pre>
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
        </div>
      </main>

      <footer className="rc-wrap rc-foot">
        <span>Reclaim — trade-in software for repair shops and resellers.</span>
        <Link to="/admin/login">Sign in</Link>
        <Link to="/preview">Widget preview</Link>
      </footer>
    </div>
  );
}
