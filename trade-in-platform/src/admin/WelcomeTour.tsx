import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import "./WelcomeTour.css";

const SEEN_KEY = "tg-admin-tour-seen";

/**
 * Asks the tour to open, from anywhere.
 *
 * It ran once on first sign-in and was then unreachable for the life of the
 * account — which is the wrong way round, because the person who most wants a
 * walkthrough is usually not the person who saw it on day one. It is the same
 * tour either way; only the trigger is new.
 */
export const TOUR_EVENT = "tg-admin-tour-open";

export function openAdminTour(): void {
  window.dispatchEvent(new CustomEvent(TOUR_EVENT));
}

interface Stop {
  title: string;
  body: string;
  /** Where this stop is talking about, so "Show me" can go there. */
  to?: string;
  cta?: string;
}

/**
 * Guided tour of every function.
 *
 * Someone who has just signed in is looking at a full menu and no data, which
 * reads as "where do I even start". This walks the whole platform in the order
 * the work actually happens — get it on your site, watch offers arrive, work
 * them, pay, price, and run the back office — rather than the menu top to
 * bottom, and gives each function one plain sentence of what it is for.
 *
 * Shown once, then remembered, and reachable from the sidebar for ever after
 * via openAdminTour(). Dismissible at every step — scrim, Escape or Skip —
 * because a tour you cannot leave is worse than no tour, and every stop can
 * jump you straight to the page it describes.
 */
const STOPS: Stop[] = [
  {
    title: "Welcome to Gadget Swap",
    body: "A quick tour of everything the platform does, in the order the work actually happens. About two minutes, and you can leave at any point — it is always here in the sidebar when you want it again.",
  },
  {
    title: "Your shop at a glance",
    body: "The Dashboard is your morning view: offers in progress, money moving, and anything waiting on you. Start here each day and follow it to whatever needs attention.",
    to: "/admin/dashboard",
    cta: "Open dashboard",
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
    title: "Repair bookings",
    body: "If you offer repairs, every booking from the repair tool arrives here with the device, the fault, and the price quoted — worked the same way you work a trade-in offer.",
    to: "/admin/repairs",
    cta: "See repairs",
  },
  {
    title: "The ones who didn't finish",
    body: "Follow-ups lists people who got a price and left without submitting, with the device and the number they saw. It is usually the cheapest revenue in the system — worth a phone call.",
    to: "/admin/leads",
    cta: "See follow-ups",
  },
  {
    title: "Mail-in, tracked",
    body: "Shipping is where mailed-in devices are followed: what is on its way, labels to print or buy, and whether you offer mail-in at all. The fine detail of one parcel is edited inside its offer.",
    to: "/admin/shipping",
    cta: "Open shipping",
  },
  {
    title: "Paying the customer",
    body: "Once a device is inspected, pay by e-transfer, cash or store credit and record it on Payouts — every payment tied to its offer, so what you owe and what you have paid is always clear.",
    to: "/admin/payouts",
    cta: "Open payouts",
  },
  {
    title: "Taking in a batch",
    body: "Clearing a drawer of old handsets, or buying a company's fleet? Bulk quote & hand-off prices many devices at once and processes them together, instead of one offer at a time.",
    to: "/admin/bulk",
    cta: "Open bulk",
  },
  {
    title: "Devices become stock",
    body: "Every completed trade-in lands in Inventory as a stock item, with what you paid for it — your resale pipeline, ready to list or move on.",
    to: "/admin/inventory",
    cta: "Open inventory",
  },
  {
    title: "Invoices, made for you",
    body: "Completing an offer generates its invoice automatically. They all live here, searchable, for your records and the customer's.",
    to: "/admin/invoices",
    cta: "See invoices",
  },
  {
    title: "The devices you buy",
    body: "Catalog is every model you accept — phones, tablets, laptops, consoles — and the storage variants of each. A sync keeps the list and its prices current.",
    to: "/admin/catalog",
    cta: "Open catalog",
  },
  {
    title: "Your prices track the market",
    body: "Gadget Swap reads what other buyers publish and quotes a set percentage under it. Set that margin once on Pricing and every model follows it. If a source goes quiet, the page says so rather than serving stale numbers.",
    to: "/admin/pricing",
    cta: "Open pricing",
  },
  {
    title: "Everyone who sold to you",
    body: "Customers collects everyone who submitted a trade-in, searchable, with their history. The first trade-in adds a customer for you automatically.",
    to: "/admin/customers",
    cta: "See customers",
  },
  {
    title: "The numbers that matter",
    body: "Reports shows what you have bought, what it cost, and what is still owed — the health of your trade-in business at a glance, ready to export.",
    to: "/admin/reports",
    cta: "Open reports",
  },
  {
    title: "Your staff and what they can do",
    body: "Add your team and set what each person sees. Admins control everything including billing; managers run the floor; operators process offers but not settings.",
    to: "/admin/team",
    cta: "Open team",
  },
  {
    title: "Your subscription",
    body: "Billing is your own Gadget Swap plan — what you are on, your usage against its limits, and your card. Change plan or update payment details here any time.",
    to: "/admin/billing",
    cta: "Open billing",
  },
  {
    title: "Make it yours",
    body: "Settings is the shop itself: logo and colours, your store locations, how you take devices in (mail-in, drop-off or both), your return address, and the keys that embed the widget on your site.",
    to: "/admin/settings",
    cta: "Open settings",
  },
];

export function WelcomeTour() {
  const reduce = useReducedMotion();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [open, setOpen] = useState(false);

  // Replay on request. Deliberately does not clear the seen flag: asking for
  // the tour should not mean being shown it again unprompted next sign-in.
  useEffect(() => {
    const open = () => {
      setStep(0);
      setOpen(true);
    };
    window.addEventListener(TOUR_EVENT, open);
    return () => window.removeEventListener(TOUR_EVENT, open);
  }, []);

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
                  Start using Gadget Swap
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
