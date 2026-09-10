import type { ExteriorCondition, ValuationAnswers } from "../data/catalog";
import { asksAccountLock, asksBattery, asksCarrier, valuationComplete } from "../lib/tradeInTypes";
import { exteriorConditionDescriptions } from "../lib/pricingBackend";
import "./FormSteps.css";

interface Props {
  value: ValuationAnswers;
  /** Drives which questions apply — a monitor has no battery and no carrier. */
  category: string | null;
  onChange: (patch: Partial<ValuationAnswers>) => void;
  onContinue: () => void;
}

function YesNo({
  label,
  hint,
  value,
  onChange,
  required,
}: {
  label: string;
  hint?: string;
  value: boolean | null;
  onChange: (v: boolean) => void;
  required?: boolean;
}) {
  return (
    <div className="form-block">
      <h2 className="form-label">
        {label} {required ? <span className="req">*</span> : null}
      </h2>
      {hint ? <p className="field-hint">{hint}</p> : null}
      <div className="chip-row">
        <button
          type="button"
          className={`chip ${value === true ? "chip--on" : ""}`}
          onClick={() => onChange(true)}
        >
          Yes
        </button>
        <button
          type="button"
          className={`chip ${value === false ? "chip--on" : ""}`}
          onClick={() => onChange(false)}
        >
          No
        </button>
      </div>
    </div>
  );
}

const exteriorOptions: { id: ExteriorCondition; label: string }[] = [
  { id: "none", label: "Like new / none" },
  { id: "minor", label: "Minor wear" },
  { id: "visible", label: "Visible wear" },
  { id: "heavy", label: "Heavy wear" },
  { id: "cracks", label: "Cracks / damage" },
];

export function ValuationStep({ value, category, onChange, onContinue }: Props) {
  const ready = valuationComplete(value, category);

  return (
    <section className="flow-panel">
      <header className="flow-header">
        <h1>A few questions about your device</h1>
        <p className="flow-lead">
          These are what change the price. Answer honestly — we check on arrival, and an accurate
          answer now is the offer you actually get paid.
        </p>
      </header>

      <YesNo
        required
        label="Does the device power on?"
        value={value.powerOn}
        onChange={(powerOn) => onChange({ powerOn })}
      />
      <YesNo
        required
        label="Is the device fully functional?"
        hint="Buttons, touchscreen, Face ID / fingerprint, cameras, speakers — all working."
        value={value.fullyFunctional}
        onChange={(fullyFunctional) => onChange({ fullyFunctional })}
      />

      <div className="form-block">
        <h2 className="form-label">
          What best describes the exterior condition? <span className="req">*</span>
        </h2>
        <div className="chip-row">
          {exteriorOptions.map((o) => (
            <div key={o.id}>
              <button
                type="button"
                className={`chip ${value.exterior === o.id ? "chip--on" : ""}`}
                onClick={() => onChange({ exterior: o.id })}
              >
                {o.label}
              </button>
              {value.exterior === o.id ? (
                <p className="field-hint">{exteriorConditionDescriptions[o.id]}</p>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <YesNo
        required
        label="Any liquid / water damage?"
        hint="If yes — even when the device still powers on — it grades as As-Is (lowest band)."
        value={value.liquidDamage}
        onChange={(liquidDamage) => onChange({ liquidDamage })}
      />

      {asksBattery(category) ? (
      <div className="form-block">
        <h2 className="form-label">
          Battery health <span className="req">*</span>
        </h2>
        <p className="field-hint">
          Check Settings → Battery for the percentage. Higher health usually means a stronger offer.
        </p>
        <label className="field">
          <span className="sr-only">Battery health percent</span>
          <input
            type="number"
            min={0}
            max={100}
            inputMode="numeric"
            placeholder="e.g. 87"
            value={value.batteryHealth ?? ""}
            onChange={(e) => {
              const n = e.target.value === "" ? null : Number(e.target.value);
              onChange({ batteryHealth: n });
            }}
          />
        </label>
      </div>
      ) : null}

      {asksAccountLock(category) ? (
        <YesNo
          required
          label="iCloud / FRP / activation lock removed?"
          hint="Must be unlocked — no iCloud, Google FRP, or Samsung account lock."
          value={value.activationLockFree}
          onChange={(activationLockFree) => onChange({ activationLockFree })}
        />
      ) : null}

      <YesNo
        required
        label={
          asksCarrier(category)
            ? "Clean IMEI (not lost or stolen)?"
            : "Is it yours to sell (not lost or stolen)?"
        }
        hint="We check this on arrival. A blacklisted device cannot be bought."
        value={value.cleanImei}
        onChange={(cleanImei) => onChange({ cleanImei })}
      />

      {/* Like New and Good both require an unlocked Canadian model; Acceptable
          only requires it to work on Canadian networks. Meaningless for a
          device with no cellular radio, so it is only asked where it applies. */}
      {asksCarrier(category) ? (
        <YesNo
          required
          label="Unlocked Canadian model?"
          hint="Carrier-unlocked and bought in Canada. A working import still sells — it just grades lower."
          value={value.canadianModel}
          onChange={(canadianModel) => onChange({ canadianModel })}
        />
      ) : null}

      {!ready && value.cleanImei === false ? (
        <p className="form-error">
          We can’t buy blacklisted / lost-stolen devices. Confirm a clean IMEI to continue.
        </p>
      ) : null}

      <button type="button" className="btn btn-primary flow-cta" disabled={!ready} onClick={onContinue}>
        Continue
      </button>
    </section>
  );
}
