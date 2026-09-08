import { motion } from "framer-motion";
import { IconBolt, IconShield, IconTruck } from "./BrandIcons";
import {
  gradeLabels,
  type ConditionGrade,
  type DeviceModel,
} from "../data/catalog";
import { joinDetails, specLabel } from "../lib/tradeInTypes";
import "./OfferStep.css";
import "./FormSteps.css";

interface Props {
  device: DeviceModel;
  storage: string;
  memory?: string | null;
  grade: ConditionGrade;
  offer: number;
  batteryHealth: number | null;
  promoCode: string;
  /** Server's verdict from the last quote. */
  promoApplied?: boolean;
  quoteLoading?: boolean;
  onPromo: (code: string) => void;
  onContinue: () => void;
  /** Bank this device and pick another for the same offer. */
  onAddAnother?: () => void;
}

export function OfferStep({
  device,
  storage,
  memory,
  grade,
  offer,
  batteryHealth,
  promoCode,
  promoApplied = false,
  quoteLoading = false,
  onPromo,
  onContinue,
  onAddAnother,
}: Props) {
  const code = promoCode.trim().toUpperCase();
  // Only the server knows which codes are live, how many uses are left and
  // whether one has expired — it holds the promo_codes table. The widget used
  // to answer from a hardcoded map that had drifted: it advertised GENIUS5,
  // TRADE10 and WELCOME5, none of which exist in the database, so a customer
  // was told "offer boosted" while the price they saw had no boost in it.
  const promoOk = Boolean(code) && promoApplied;
  const promoBad = Boolean(code) && !promoApplied && !quoteLoading;

  return (
    <section className="flow-panel">
      <header className="flow-header">
        <p className="flow-kicker">Your offer</p>
        <h1>Here’s what we’ll pay</h1>
        <p className="flow-lead">
          {joinDetails(
            device.name,
            specLabel(storage, device.category),
            memory ? specLabel(memory, device.category) : "",
            gradeLabels[grade],
          )}
          {batteryHealth !== null ? ` · battery ${batteryHealth}%` : ""}. Hold good for 7 days,
          pending intake check.
        </p>
      </header>

      <motion.div
        className="offer-hero"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      >
        <span className="offer-label">Cash offer</span>
        <strong className="offer-amount">${offer.toLocaleString()} CAD</strong>
        <span className="offer-note">
          {promoOk ? `Promo ${code} applied · ` : ""}
          Paid after inspection · Interac e-Transfer available
        </span>
      </motion.div>

      <div className="form-block">
        <h2 className="form-label">Promo code (optional)</h2>
        <label className="field">
          <span className="sr-only">Promo code</span>
          <input
            value={promoCode}
            onChange={(e) => onPromo(e.target.value)}
            placeholder="e.g. GENIUS5"
            autoComplete="off"
          />
        </label>
        {promoOk ? <p className="field-hint">Code applied — offer boosted.</p> : null}
        {quoteLoading && code ? <p className="field-hint">Checking code…</p> : null}
        {promoBad ? <p className="form-error">That code isn&rsquo;t valid or has expired.</p> : null}
      </div>

      <ul className="offer-perks">
        <li>
          <IconTruck size={18} /> Free Canada Post label &amp; kit
        </li>
        <li>
          <IconBolt size={18} /> Fast payout after intake — same-day in store when we can
        </li>
        <li>
          <IconShield size={18} /> Grade mismatch on intake → re-offer or free return
        </li>
      </ul>

      <div className="offer-actions">
        <button type="button" className="btn btn-primary flow-cta" onClick={onContinue}>
          Accept offer &amp; continue
        </button>
        {onAddAnother ? (
          <button type="button" className="btn btn-ghost" onClick={onAddAnother}>
            Accept &amp; add another device
          </button>
        ) : null}
      </div>
      <p className="field-hint offer-actions-hint">
        Selling more than one? Add them to the same offer and we&rsquo;ll pay for it all together.
      </p>
    </section>
  );
}
