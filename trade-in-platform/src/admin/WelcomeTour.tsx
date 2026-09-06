import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import "./WelcomeTour.css";

const SEEN_KEY = "tg-admin-tour-seen";

interface Stop {
  title: string;
  body: string;
  /** Where this stop is talking about, so "Show me" can go there. */
  to?: string;
  cta?: string;
}

/**
 * First-run tour.
 *
 * Someone who has just signed up is looking at fourteen navigation items and no
 * data, which reads as "where do I even start". This answers that in the order
 * the work actually happens — get it on your site, watch offers arrive, price
 * them, get paid — rather than walking the menu top to bottom.
 *
 * Shown once, then remembered. Dismissible at every step — scrim, Escape or
 * Skip — because a tour you cannot leave is worse than no tour.
 */
const STOPS: Stop[] = [
  {
    title: "Welcome to Reclaim",
    body: "Four things to know before you take your first trade-in. Under a minute, and you can leave at any point.",
  },
  {
    title: "Put it on your website",
    body: "Connect gives you one block of HTML with your shop's details already filled in. Paste it anywhere — Framer, Shopify, WordPress — and customers can price a device without leaving your site.",
    to: "/admin/setup",
    cta: "Open Connect",
  },
  {
    title: "Offers land here",
    body: "Every quote a customer accepts becomes an offer you can work through: in transit, delivered, inspected, paid. Completing one creates the inventory item and the invoice for you.",
    to: "/admin/offers",
    cta: "See offers",
  },
  {
    title: "The ones who didn't finish",
    body: "Follow-ups lists people who got a price and left without submitting, with the device and the number they saw. It is usually the cheapest revenue in the system — worth a phone call.",
    to: "/admin/leads",
    cta: "See follow-ups",
  },
  {
    title: "Your prices track the market",
    body: "Reclaim reads what other buyers publish and quotes a set percentage under it. Set that margin once on Pricing and every model follows it. If a source goes quiet, the page says so rather than serving stale numbers.",
    to: "/admin/pricing",
    cta: "Open pricing",
  },
];

export function WelcomeTour() {
  const reduce = useReducedMotion();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(SEEN_KEY)) setOpen(true);
    } catch {
      /* private browsing — just don't show it */
    }
  }, []);

  function close() {
    setOpen(false);
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* ignore */
    }
  }

  // Escape closes, like any other dismissible layer.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;
  const stop = STOPS[step];
  const last = step === STOPS.length - 1;

  return (
    <AnimatePresence>
      <motion.div
        className="tour-scrim"
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={close}
      >
        <motion.div
          className="tour-card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="tour-title"
          initial={reduce ? false : { opacity: 0, y: 14, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="tour-progress" aria-hidden>
            {STOPS.map((s, i) => (
              <span key={s.title} data-done={i <= step} />
            ))}
          </div>

          <h2 id="tour-title">{stop.title}</h2>
          <p>{stop.body}</p>

          <div className="tour-actions">
            <button type="button" className="tour-skip" onClick={close}>
              {last ? "Close" : "Skip tour"}
            </button>
            <div className="tour-right">
              {stop.to ? (
                <button
                  type="button"
                  className="tour-ghost"
                  onClick={() => {
                    close();
                    navigate(stop.to!);
                  }}
                >
                  {stop.cta ?? "Show me"}
                </button>
              ) : null}
              {!last ? (
                <button type="button" className="tour-next" onClick={() => setStep((s) => s + 1)}>
                  Next
                </button>
              ) : (
                <button type="button" className="tour-next" onClick={close}>
                  Start using Reclaim
                </button>
              )}
            </div>
          </div>

          <p className="tour-count">
            {step + 1} of {STOPS.length}
          </p>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
