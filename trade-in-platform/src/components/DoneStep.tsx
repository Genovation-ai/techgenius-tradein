import { motion } from "framer-motion";
import { IconBox, IconCheck, IconCopy } from "./BrandIcons";
import { displayStorage, joinDetails, type QuotedDevice } from "../lib/tradeInTypes";
import "./OfferStep.css";
import "./FormSteps.css";

interface Props {
  offerId: string;
  devices: QuotedDevice[];
  total: number;
  method: "mail-in" | "drop-off";
  onAddAnother: () => void;
  onRestart: () => void;
}

export function DoneStep({ offerId, devices, total, method, onAddAnother, onRestart }: Props) {
  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(offerId);
    } catch {
      /* ignore */
    }
  };

  return (
    <section className="flow-panel">
      <motion.div
        className="done-panel"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      >
        <IconCheck size={44} className="done-icon" />
        <h1>You’re all set</h1>
        <p className="flow-lead">
          ${total.toLocaleString()} CAD reserved for {devices.length} device
          {devices.length === 1 ? "" : "s"}.{" "}
          {method === "mail-in"
            ? "Keep your Offer ID handy — we’ll confirm packing and shipping once your offer is reviewed."
            : "Bring your device to Tech Genius Burlington with this Offer ID. We’ll verify and pay when we can."}
        </p>

        <div className="offer-id-box">
          <span>Offer ID</span>
          <strong>{offerId}</strong>
          <button type="button" className="btn btn-secondary" onClick={copyId}>
            <IconCopy size={16} /> Copy
          </button>
        </div>

        <ul className="done-list">
          {devices.map((d) => (
            <li key={d.id}>
              <IconBox size={18} /> {joinDetails(d.deviceName, displayStorage(d.storage), displayStorage(d.memory))} · ${d.offer}
            </li>
          ))}
        </ul>

        {/* Competitors publish step-by-step wipe guidance and we only had a
            three-line reminder. The exact menu paths matter: an activation lock
            left on is the single most common reason a device has to be returned
            unpaid, and "erase the device" alone does not tell someone where to
            find that. */}
        <h2 className="form-label">Before you hand it off</h2>
        <ol className="done-list done-steps">
          <li>
            <IconBox size={18} />
            <span>
              <strong>Back it up.</strong> iPhone: Settings &rsaquo; [your name] &rsaquo; iCloud
              &rsaquo; iCloud Backup. Android: Settings &rsaquo; Google &rsaquo; Backup.
            </span>
          </li>
          <li>
            <IconBox size={18} />
            <span>
              <strong>Turn off the activation lock.</strong> iPhone: Settings &rsaquo; [your name]
              &rsaquo; Find My &rsaquo; Find My iPhone &rsaquo; off, then sign out of iCloud.
              Android: remove your Google account under Settings &rsaquo; Accounts. We cannot pay
              for a locked device, so this is the one step worth double-checking.
            </span>
          </li>
          <li>
            <IconBox size={18} />
            <span>
              <strong>Erase it.</strong> iPhone: Settings &rsaquo; General &rsaquo; Transfer or
              Reset &rsaquo; Erase All Content and Settings. Android: Settings &rsaquo; System
              &rsaquo; Reset &rsaquo; Factory data reset.
            </span>
          </li>
          <li>
            <IconBox size={18} />
            <span>
              <strong>Take your SIM and memory card out</strong> — we cannot return them
              separately once the device is processed.
            </span>
          </li>
        </ol>
        <p className="field-hint">
          Forgot a step? Tell us when you hand the device over. We wipe every device we take in
          regardless, but a device still signed in has to go back to you unpaid.
        </p>

        <div className="media-cta-row">
          <button type="button" className="btn btn-primary" onClick={onAddAnother}>
            Accept &amp; add another device
          </button>
          <button type="button" className="btn btn-secondary" onClick={onRestart}>
            Start fresh
          </button>
        </div>
      </motion.div>
    </section>
  );
}
