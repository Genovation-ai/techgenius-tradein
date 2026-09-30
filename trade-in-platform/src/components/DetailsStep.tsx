import { useEffect, useMemo, useState } from "react";
import type { Carrier, DeviceCategory, DeviceModel } from "../data/catalog";
import { carriers } from "../data/catalog";
import { specKind, specLabel, specQuestionLabel } from "../lib/tradeInTypes";
import { colorsFor } from "../lib/deviceColors";
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

  /**
   * One question at a time, and answering it moves to the next.
   *
   * This step used to put storage, memory, carrier and colour on one screen
   * behind a Continue button. The shop asked for the flow it is compared
   * against, where picking an answer replaces the question with the next one
   * in the same place: "it automatically vanishes and goes to next step, on
   * the same screen". A single choice is its own confirmation, so asking the
   * customer to pick and then press Continue is asking twice.
   *
   * Only the required questions advance on their own. Colour is optional and
   * never changes the quote, so it is last and keeps a button — auto-advancing
   * past a question someone might want to skip would be the same discourtesy
   * in the other direction.
   */
  type Q = "storage" | "memory" | "carrier" | "color";
  const questions = useMemo(() => {
    const q: Q[] = [];
    if (showStoragePicker) q.push("storage");
    if (isTwoAxis) q.push("memory");
    if (carrierRequired) q.push("carrier");
    q.push("color");
    return q;
  }, [showStoragePicker, isTwoAxis, carrierRequired]);

  const answered = (q: Q): boolean =>
    q === "storage" ? Boolean(storage) : q === "memory" ? Boolean(memory) : q === "carrier" ? Boolean(carrier) : true;

  // Land on the first unanswered question, so coming back from a later step
  // does not march the customer through answers they already gave.
  const [at, setAt] = useState(() => {
    const i = questions.findIndex((q) => !answered(q));
    return i === -1 ? questions.length - 1 : i;
  });
  const current = questions[Math.min(at, questions.length - 1)];

  /** Move to the next unanswered question, or stop on the last one. */
  const advance = (justAnswered: Q) => {
    const from = questions.indexOf(justAnswered);
    for (let i = from + 1; i < questions.length; i++) {
      if (!answered(questions[i])) return setAt(i);
    }
    setAt(questions.length - 1);
  };

  /** What has been chosen so far, so it can be seen and changed. */
  const trail: Array<{ q: Q; label: string }> = [];
  if (showStoragePicker && storage) trail.push({ q: "storage", label: specLabel(storage, device.category) });
  if (isTwoAxis && memory) trail.push({ q: "memory", label: specLabel(memory, device.category) });
  if (carrierRequired && carrier) trail.push({ q: "carrier", label: carrier });
  if (color) trail.push({ q: "color", label: color });

  return (
    <section className="flow-panel">
      <header className="flow-header">
        <h1>{device.name}</h1>
        {/* One line for the question on screen, not for all of them at once:
            the others are not being asked yet. */}
        <p className="flow-lead">
          {current === "storage"
            ? `Select your ${specNoun} — it changes what we can pay.`
            : current === "memory"
              ? "How much memory is in your machine?"
              : current === "carrier"
                ? "Who is it locked to, if anyone?"
                : "Last one, and this is optional."}
        </p>
      </header>

      {/* What is settled so far. Tapping one reopens that question, which is
          the only way back to an answer once its question has been replaced. */}
      {trail.length ? (
        <div className="spec-trail">
          {trail.map((t) => (
            <button
              key={t.q}
              type="button"
              className={`spec-trail-item ${current === t.q ? "is-open" : ""}`}
              onClick={() => setAt(questions.indexOf(t.q))}
            >
              {t.label}
            </button>
          ))}
        </div>
      ) : null}

      {current === "storage" && showStoragePicker ? (
        <div className="form-block">
          <h2 className="form-label">
            {specQuestion} <span className="req">*</span>
          </h2>
          <div className="chip-row">
            {/* No "up to $X" under each capacity. It is the same trap the
                condition cards had: a column of figures turns "how much
                storage does my phone have" into "which of these pays most",
                and the answer to the first question is a fact the customer
                either knows or can look up. The price for what they actually
                chose sits in the panel beside this. */}
            {primaryOptions.map((s) => (
              <button
                key={s}
                type="button"
                className={`chip ${storage === s ? "chip--on" : ""}`}
                onClick={() => {
                  onStorage(s);
                  advance("storage");
                }}
              >
                <span>{specLabel(s, device.category)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {current === "memory" && isTwoAxis ? (
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
                onClick={() => {
                  onMemory?.(m);
                  advance("memory");
                }}
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

      {current === "carrier" && carrierRequired ? (
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
                onClick={() => {
                  onCarrier(c);
                  advance("carrier");
                }}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Optional, and deliberately last: it never gates the quote and never
          changes it. Tapping a selected colour again clears it, so someone who
          is not sure is not stuck with a guess — which is also why this one
          does not advance on its own. */}
      {current === "color" ? (
        <div className="form-block">
          <h2 className="form-label">
            Colour <span className="form-optional">optional</span>
          </h2>
          <p className="field-hint">Helps us match your device to your offer when it arrives.</p>
          <div className="chip-row">
            {/* The model's own launch palette, not a generic dozen. */}
            {colorsFor(device.name).map((c) => (
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
      ) : null}

      <button type="button" className="btn btn-primary flow-cta" disabled={!ready} onClick={onContinue}>
        Continue
      </button>
    </section>
  );
}
