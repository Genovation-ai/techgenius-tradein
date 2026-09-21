import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { Brand, DeviceCategory, DeviceModel } from "../data/catalog";
import { useCatalog } from "../hooks/useCatalog";
import {
  bookRepair,
  fetchRepairProblems,
  fetchRepairQuote,
  type RepairProblem,
  type RepairQuoteResponse,
} from "../lib/tradeInApi";
import { CategoryStep } from "./CategoryStep";
import { DevicePickStep } from "./DevicePickStep";
import { TradeInProgress } from "./TradeInProgress";
import "./FormSteps.css";
import "./RepairFlow.css";

/**
 * Repair, in the shape a customer already knows.
 *
 * Repair → your device → what's wrong → the price → book. The first two steps
 * are the trade-in's own, reused rather than rebuilt, so the catalogue, the
 * photos, the ordering and the search all come for free and behave the same
 * way whichever thing the customer came to do.
 *
 * When there is no part cost on file the customer is told the shop will quote
 * it and the booking still goes through. A made-up number here is a promise
 * the bench then has to keep.
 */

type Step = "category" | "device" | "problem" | "price" | "book" | "done";
const ORDER: Step[] = ["category", "device", "problem", "price", "book", "done"];
const LABELS: Record<Step, string> = {
  category: "Device type",
  device: "Your model",
  problem: "What's wrong",
  price: "Your price",
  book: "Book it in",
  done: "Done",
};

export function RepairFlow() {
  const reduce = useReducedMotion();
  const [step, setStep] = useState<Step>("category");
  const [category, setCategory] = useState<DeviceCategory | null>(null);
  const [brandFilter, setBrandFilter] = useState<Brand | "All">("All");
  const [query, setQuery] = useState("");
  const [device, setDevice] = useState<DeviceModel | null>(null);
  const [problems, setProblems] = useState<RepairProblem[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [quote, setQuote] = useState<RepairQuoteResponse | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [contact, setContact] = useState({ first_name: "", last_name: "", email: "", phone: "" });
  const [fulfilment, setFulfilment] = useState<"drop-off" | "mail-in">("drop-off");
  const [notes, setNotes] = useState("");
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; quoted_price: number | null; needs_quote: boolean } | null>(null);

  const catalog = useCatalog(category, brandFilter, query);
  const brandAuto = useRef(true);
  useEffect(() => {
    if (step !== "device" || !brandAuto.current) return;
    if (brandFilter !== "All" || catalog.brands.length === 0) return;
    brandAuto.current = false;
    setBrandFilter(catalog.brands[0] as Brand);
  }, [step, brandFilter, catalog.brands]);

  useEffect(() => {
    void fetchRepairProblems().then(setProblems).catch(() => setProblems([]));
  }, []);

  // Same landing behaviour as the trade-in: a step change brings the panel's
  // top into view rather than leaving the reader at the bottom of the last one.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const root = rootRef.current;
    if (!root) return;
    const top = root.getBoundingClientRect().top + window.scrollY - 12;
    if (window.scrollY > top) window.scrollTo({ top: Math.max(0, top), behavior: reduce ? "auto" : "smooth" });
  }, [step, reduce]);

  const idx = ORDER.indexOf(step);
  const back = () => setStep(ORDER[Math.max(0, idx - 1)]);

  const pickProblem = async (id: string) => {
    if (!device) return;
    setProblem(id);
    setQuoting(true);
    setError(null);
    try {
      setQuote(await fetchRepairQuote(device.id, id));
      setStep("price");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not price this repair");
    } finally {
      setQuoting(false);
    }
  };

  const submit = async () => {
    if (!device || !problem) return;
    if (!contact.first_name.trim() || !(contact.email.trim() || contact.phone.trim())) {
      setError("Your first name and a phone number or email, so we can reach you.");
      return;
    }
    setBooking(true);
    setError(null);
    try {
      const r = await bookRepair({ contact, device_id: device.id, problem, fulfilment, notes: notes || undefined });
      setResult(r);
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not book this repair");
    } finally {
      setBooking(false);
    }
  };

  const restart = () => {
    setStep("category");
    setCategory(null);
    setBrandFilter("All");
    brandAuto.current = true;
    setQuery("");
    setDevice(null);
    setProblem(null);
    setQuote(null);
    setResult(null);
    setError(null);
  };

  return (
    <div className="tg-trade-in tg-repair" ref={rootRef}>
      <TradeInProgress
        step={step === "category" ? "category" : step === "device" ? "device" : step === "done" ? "done" : "details"}
        onBack={idx > 0 && step !== "done" ? back : undefined}
        overrideLabels={LABELS as Record<string, string>}
        overrideOrder={ORDER}
        overrideCurrent={step}
      />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={step}
          initial={reduce ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        >
          {step === "category" && (
            <CategoryStep
              heading="What needs fixing?"
              onSelect={(c) => {
                brandAuto.current = true;
                setCategory(c);
                setBrandFilter("All");
                setDevice(null);
                setQuery("");
                setStep("device");
              }}
            />
          )}

          {step === "device" && category && (
            <DevicePickStep
              category={category}
              brandFilter={brandFilter}
              query={query}
              devices={catalog.devices}
              brands={catalog.brands}
              loading={catalog.loading}
              error={catalog.error}
              apiOnline={catalog.apiOnline}
              onBrandFilter={(b) => {
                brandAuto.current = false;
                setBrandFilter(b);
              }}
              onQuery={setQuery}
              onSelect={(d) => {
                setDevice(d);
                setStep("problem");
              }}
            />
          )}

          {step === "problem" && device && (
            <section className="flow-panel">
              <header className="flow-header">
                <h1>What's wrong with your {device.name}?</h1>
              </header>
              {error ? <p className="flow-error">{error}</p> : null}
              <div className="repair-problems">
                {problems.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`repair-problem ${problem === p.id ? "is-on" : ""}`}
                    disabled={quoting}
                    onClick={() => void pickProblem(p.id)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </section>
          )}

          {step === "price" && device && quote && (
            <section className="flow-panel">
              <header className="flow-header">
                <h1>{quote.needs_quote ? "We'll price this one for you" : "Your repair price"}</h1>
              </header>
              <div className="repair-price-card">
                <p className="repair-price-device">
                  {device.name} · {quote.problem_label}
                </p>
                {quote.needs_quote ? (
                  <p className="repair-price-note">
                    We don't have a set price for this repair yet. Book it in and we'll call you with a quote
                    before any work starts — nothing is charged until you say yes.
                  </p>
                ) : (
                  <>
                    <p className="repair-price-amount">${quote.price}</p>
                    <p className="repair-price-note">
                      Parts and labour included. If we open it up and find something else, we'll call before
                      doing more.
                    </p>
                  </>
                )}
              </div>
              <button type="button" className="btn btn-primary flow-cta" onClick={() => setStep("book")}>
                {quote.needs_quote ? "Book it in for a quote" : "Book this repair"}
              </button>
            </section>
          )}

          {step === "book" && device && (
            <section className="flow-panel">
              <header className="flow-header">
                <h1>Book it in</h1>
              </header>
              {error ? <p className="flow-error">{error}</p> : null}
              <div className="form-block">
                <h2 className="form-label">How will we get the device?</h2>
                <div className="chip-row">
                  <button type="button" className={`chip ${fulfilment === "drop-off" ? "chip--on" : ""}`} onClick={() => setFulfilment("drop-off")}>
                    Drop it at the shop
                  </button>
                  <button type="button" className={`chip ${fulfilment === "mail-in" ? "chip--on" : ""}`} onClick={() => setFulfilment("mail-in")}>
                    Mail it in
                  </button>
                </div>
              </div>
              <div className="form-grid">
                <label className="field">
                  First name
                  <input value={contact.first_name} onChange={(e) => setContact({ ...contact, first_name: e.target.value })} autoComplete="given-name" />
                </label>
                <label className="field">
                  Last name
                  <input value={contact.last_name} onChange={(e) => setContact({ ...contact, last_name: e.target.value })} autoComplete="family-name" />
                </label>
                <label className="field">
                  Phone
                  <input value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} inputMode="tel" autoComplete="tel" />
                </label>
                <label className="field">
                  Email
                  <input value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} inputMode="email" autoComplete="email" />
                </label>
                <label className="field field--wide">
                  Anything we should know? <span className="form-optional">optional</span>
                  <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
                </label>
              </div>
              <button type="button" className="btn btn-primary flow-cta" disabled={booking} onClick={() => void submit()}>
                {booking ? "Booking…" : "Confirm booking"}
              </button>
            </section>
          )}

          {step === "done" && result && (
            <section className="flow-panel">
              <header className="flow-header">
                <h1>You're booked in</h1>
              </header>
              <div className="offer-id-box">
                <span>Repair ID</span>
                <strong>{result.id}</strong>
              </div>
              <p className="flow-lead">
                {result.needs_quote
                  ? "We'll call you with a price before any work starts."
                  : `Your price is $${result.quoted_price}, parts and labour included.`}{" "}
                {fulfilment === "drop-off"
                  ? "Bring the device in whenever suits you — no appointment needed."
                  : "We'll email you a shipping label."}{" "}
                Keep the Repair ID to check on it any time.
              </p>
              <button type="button" className="btn btn-secondary" onClick={restart}>
                Book another repair
              </button>
            </section>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
