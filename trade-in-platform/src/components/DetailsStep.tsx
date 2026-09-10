import { useEffect } from "react";
import type { Carrier, DeviceCategory, DeviceModel } from "../data/catalog";
import { carriers } from "../data/catalog";
import { DEVICE_COLORS, specKind, specLabel, specQuestionLabel } from "../lib/tradeInTypes";
import "./FormSteps.css";

interface Props {
  device: DeviceModel;
  storage: string | null;
  memory?: string | null;
  carrier: Carrier | null;
  color: string | null;
  onStorage: (v: string) => void;
  onMemory?: (v: string) => void;
  onCarrier: (v: Carrier) => void;
  onColor: (v: string | null) => void;
  onContinue: () => void;
}

function needsCarrier(category: DeviceCategory): boolean {
  return category === "smartphone" || category === "tablet";
}

export function DetailsStep({
  device,
  storage,
  memory,
  carrier,
  color,
  onStorage,
  onMemory,
  onCarrier,
  onColor,
  onContinue,
}: Props) {
  const carrierRequired = needsCarrier(device.category);

  // Around a quarter of the catalog is priced on a single placeholder tier
  // ("default") rather than real capacities — watches and older handsets whose
  // storage was never imported. Showing a lone chip labelled "default" is a
  // question with one meaningless answer, so we pick it silently and hide the
  // control. The value still goes to the server, matching that device's price
  // table exactly, so quotes are unaffected.
  const realStorages = device.storages.filter((s) => !/^default$/i.test(s));

  // Laptops list a drive size AND a memory config in the same field. Asking one
  // question over a mixed list ("Storage capacity: 16GB") is unanswerable, so
  // split them and ask each separately. Devices with a single axis are
  // unaffected and still see one question.
  const driveOptions = realStorages.filter((s) => specKind(s, device.category) === "storage");
  const memoryOptions = realStorages.filter((s) => specKind(s, device.category) === "memory");
  const isTwoAxis = driveOptions.length > 0 && memoryOptions.length > 0;

  const primaryOptions = isTwoAxis ? driveOptions : realStorages;
  const showStoragePicker = primaryOptions.length > 0;
  const specQuestion = isTwoAxis
    ? "Storage (SSD)"
    : specQuestionLabel(realStorages, device.category);
  const specNoun = specQuestion.toLowerCase();
  const effectiveStorage = showStoragePicker ? storage : storage ?? device.storages[0] ?? null;

  useEffect(() => {
    if (!showStoragePicker && !storage && device.storages[0]) {
      onStorage(device.storages[0]);
    }
  }, [showStoragePicker, storage, device.storages, onStorage]);

  const ready =
    Boolean(effectiveStorage) &&
    (!isTwoAxis || Boolean(memory)) &&
    (!carrierRequired || Boolean(carrier));

  return (
    <section className="flow-panel">
      <header className="flow-header">
        <h1>{device.name}</h1>
        <p className="flow-lead">
          {showStoragePicker
            ? carrierRequired
              ? `${specQuestion} and carrier / network status are required for an accurate quote.`
              : isTwoAxis
                ? "Tell us the storage and memory in your machine to continue."
                : `Select your ${specNoun} to continue your quote.`
            : carrierRequired
              ? "Confirm carrier / network status for an accurate quote."
              : "Confirm the details below to continue your quote."}
        </p>
      </header>

      {showStoragePicker ? (
        <div className="form-block">
          <h2 className="form-label">
            {specQuestion} <span className="req">*</span>
          </h2>
          <div className="chip-row">
            {primaryOptions.map((s) => {
              const tip = device.storagePrices?.[s];
              return (
                <button
                  key={s}
                  type="button"
                  className={`chip ${storage === s ? "chip--on" : ""}`}
                  onClick={() => onStorage(s)}
                >
                  <span>{specLabel(s, device.category)}</span>
                  {tip && tip > 0 ? (
                    <span className="chip-price">up to ${tip.toLocaleString()}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {isTwoAxis ? (
        <div className="form-block">
          <h2 className="form-label">
            Memory (RAM) <span className="req">*</span>
          </h2>
          <div className="chip-row">
            {memoryOptions.map((m) => (
              <button
                key={m}
                type="button"
                className={`chip ${memory === m ? "chip--on" : ""}`}
                onClick={() => onMemory?.(m)}
              >
                <span>{specLabel(m, device.category)}</span>
              </button>
            ))}
          </div>
          <p className="field-hint">
            Not sure? On a Mac, open the Apple menu &rsquo; About This Mac. We confirm the
            full configuration when your device arrives.
          </p>
        </div>
      ) : null}

      {carrierRequired ? (
        <div className="form-block">
          <h2 className="form-label">
            Carrier / network <span className="req">*</span>
          </h2>
          <div className="chip-row">
            {carriers.map((c) => (
              <button
                key={c}
                type="button"
                className={`chip ${carrier === c ? "chip--on" : ""}`}
                onClick={() => onCarrier(c)}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Optional, and deliberately last: it never gates the quote and never
          changes it. Tapping a selected colour again clears it, so someone who
          is not sure is not stuck with a guess. */}
      <div className="form-block">
        <h2 className="form-label">
          Colour <span className="form-optional">optional</span>
        </h2>
        <p className="field-hint">Helps us match your device to your offer when it arrives.</p>
        <div className="chip-row">
          {DEVICE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`chip ${color === c ? "chip--on" : ""}`}
              aria-pressed={color === c}
              onClick={() => onColor(color === c ? null : c)}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <button type="button" className="btn btn-primary flow-cta" disabled={!ready} onClick={onContinue}>
        Continue
      </button>
    </section>
  );
}
