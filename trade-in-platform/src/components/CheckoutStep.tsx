import { storeLocations } from "../data/catalog";
import { checkoutComplete, type TradeInState } from "../lib/tradeInTypes";
import "./FormSteps.css";

interface Props {
  contact: TradeInState["contact"];
  cartTotal: number;
  cartCount: number;
  onChange: (patch: Partial<TradeInState["contact"]>) => void;
  onSubmit: () => void;
}

export function CheckoutStep({ contact, cartTotal, cartCount, onChange, onSubmit }: Props) {
  const ready = checkoutComplete(contact);

  return (
    <section className="flow-panel">
      <header className="flow-header">
        <h1>Lock in your offer</h1>
        <p className="flow-lead">
          {cartCount > 1
            ? `${cartCount} devices · $${cartTotal.toLocaleString()} CAD total.`
            : `$${cartTotal.toLocaleString()} CAD.`}{" "}
          Mail-in needs a ship-from address; drop-off uses Tech Genius Burlington.
        </p>
      </header>

      <div className="form-block">
        <h2 className="form-label">
          Handoff <span className="req">*</span>
        </h2>
        <div className="chip-row">
          <button
            type="button"
            className={`chip ${contact.method === "mail-in" ? "chip--on" : ""}`}
            onClick={() => onChange({ method: "mail-in" })}
          >
            Mail-in (free label)
          </button>
          <button
            type="button"
            className={`chip ${contact.method === "drop-off" ? "chip--on" : ""}`}
            onClick={() => onChange({ method: "drop-off" })}
          >
            Drop off in-store
          </button>
        </div>
      </div>

      {contact.method === "drop-off" ? (
        <div className="form-block">
          <h2 className="form-label">
            Store location <span className="req">*</span>
          </h2>
          <div className="chip-row">
            {storeLocations.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`chip ${contact.storeId === s.id ? "chip--on" : ""}`}
                onClick={() => onChange({ storeId: s.id })}
              >
                {s.title}
              </button>
            ))}
          </div>
          <p className="field-hint">
            {storeLocations[0].address} · {storeLocations[0].phone}
          </p>
        </div>
      ) : (
        <div className="field-grid field-grid--2">
          <label className="field field--full">
            <span>
              Ship-from address <span className="req">*</span>
            </span>
            <input
              value={contact.shipAddress}
              onChange={(e) => onChange({ shipAddress: e.target.value })}
              placeholder="123 Main St"
              autoComplete="street-address"
            />
          </label>
          <label className="field">
            <span>
              City <span className="req">*</span>
            </span>
            <input
              value={contact.shipCity}
              onChange={(e) => onChange({ shipCity: e.target.value })}
              placeholder="Burlington"
              autoComplete="address-level2"
            />
          </label>
          <label className="field">
            <span>
              Province <span className="req">*</span>
            </span>
            <input
              value={contact.shipProvince}
              onChange={(e) => onChange({ shipProvince: e.target.value })}
              placeholder="ON"
              autoComplete="address-level1"
            />
          </label>
          <label className="field">
            <span>
              Postal code <span className="req">*</span>
            </span>
            <input
              value={contact.shipPostal}
              onChange={(e) => onChange({ shipPostal: e.target.value })}
              placeholder="L7L 0A1"
              autoComplete="postal-code"
            />
          </label>
        </div>
      )}

      <div className="form-block">
        <h2 className="form-label">
          Payout method <span className="req">*</span>
        </h2>
        <div className="chip-row">
          {(
            [
              ["etransfer", "Interac e-Transfer"],
              ["store-credit", "Store credit (+5%)"],
              ["paypal", "PayPal"],
              ...(contact.method === "drop-off" ? [["cash", "Cash (in-store)"]] : []),
            ] as [NonNullable<typeof contact.payout>, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`chip ${contact.payout === id ? "chip--on" : ""}`}
              onClick={() => onChange({ payout: id })}
            >
              {label}
            </button>
          ))}
        </div>
        {contact.payout === "store-credit" ? (
          <p className="field-hint">Store credit adds 5% to your locked-in total at checkout.</p>
        ) : null}
      </div>

      <div className="field-grid field-grid--2">
        <label className="field">
          <span>
            First name <span className="req">*</span>
          </span>
          <input
            value={contact.firstName}
            onChange={(e) => onChange({ firstName: e.target.value })}
            autoComplete="given-name"
          />
        </label>
        <label className="field">
          <span>
            Last name <span className="req">*</span>
          </span>
          <input
            value={contact.lastName}
            onChange={(e) => onChange({ lastName: e.target.value })}
            autoComplete="family-name"
          />
        </label>
        <label className="field">
          <span>
            Email <span className="req">*</span>
          </span>
          <input
            type="email"
            value={contact.email}
            onChange={(e) => onChange({ email: e.target.value })}
            autoComplete="email"
          />
        </label>
        <label className="field">
          <span>
            Phone <span className="req">*</span>
          </span>
          <input
            type="tel"
            value={contact.phone}
            onChange={(e) => onChange({ phone: e.target.value })}
            autoComplete="tel"
          />
        </label>
        <label className="field field--full">
          <span>IMEI / serial (optional — verified on intake)</span>
          <input
            value={contact.imei}
            onChange={(e) => onChange({ imei: e.target.value })}
            inputMode="numeric"
          />
        </label>
        <label className="field field--full">
          <span>Notes for Tech Genius (optional)</span>
          <input
            value={contact.notes}
            onChange={(e) => onChange({ notes: e.target.value })}
            placeholder="Anything we should know?"
          />
        </label>
      </div>

      <button type="button" className="btn btn-primary flow-cta" disabled={!ready} onClick={onSubmit}>
        Lock in offer &amp; confirm
      </button>
    </section>
  );
}
