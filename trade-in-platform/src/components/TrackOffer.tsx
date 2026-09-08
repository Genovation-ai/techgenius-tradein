import { useState } from "react";
import { findOffer, type SavedOffer } from "../lib/offers";
import { portalUnlock, trackOffer, type PortalOffer, type TrackedOffer } from "../lib/tradeInApi";
import "./FormSteps.css";
import "./TrackOffer.css";
import { displayStorage, joinDetails } from "../lib/tradeInTypes";

/**
 * Short forms of the customer-facing stage names, for the progress trail.
 * The server sends the full sentence for the current stage; these only have to
 * be readable in a row of six on a phone.
 */
const JOURNEY_LABELS: Record<string, string> = {
  active_lead: "Accepted",
  in_transit: "On its way",
  delivered: "Arrived",
  being_inspected: "Checked",
  payout_processing: "Paying",
  completed: "Paid",
};

export function TrackOffer() {
  const [query, setQuery] = useState("");
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<SavedOffer | TrackedOffer | PortalOffer | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const track = async () => {
    const needle = query.trim();
    if (!needle) return;
    setLoading(true);
    setResult(undefined);
    setError(null);
    try {
      if (email.trim()) {
        const portal = await portalUnlock(needle, email.trim());
        setResult(portal);
      } else {
        const remote = await trackOffer(needle);
        setResult(remote);
      }
    } catch (e) {
      if (email.trim()) {
        setError(e instanceof Error ? e.message : "Portal unlock failed");
        setResult(null);
      } else {
        const local = findOffer(needle);
        setResult(local);
      }
    } finally {
      setLoading(false);
    }
  };

  const isRemote = (r: SavedOffer | TrackedOffer | PortalOffer): r is TrackedOffer | PortalOffer =>
    "total_value" in r;
  const isPortal = (r: SavedOffer | TrackedOffer | PortalOffer): r is PortalOffer =>
    "portal" in r && (r as PortalOffer).portal === true;

  return (
    <section className="track-panel" id="track-offer">
      <h2>Track my offer</h2>
      <p>
        Enter your Offer ID for a public status check. Add the email used at checkout to open the customer
        portal (payout + tracking details).
      </p>
      <div className="track-row">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="TG-…"
          aria-label="Offer ID"
        />
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email (portal)"
          aria-label="Email for portal"
          type="email"
        />
        <button type="button" className="btn btn-dark" onClick={() => void track()} disabled={loading}>
          {loading ? "…" : email.trim() ? "Open portal" : "Track"}
        </button>
      </div>
      {error ? <p className="form-error">{error}</p> : null}
      {result === null ? <p className="form-error">No offer found for that ID.</p> : null}
      {result ? (
        <div className="track-result">
          {isRemote(result) ? (
            <>
              <p className="track-headline">
                <strong>{result.id}</strong> · ${result.total_value.toLocaleString()} CAD
              </p>

              {/* Where it is, and what happens next. The second line is the one
                  that stops the phone call. */}
              <p className="track-status">{result.status_label ?? result.status}</p>
              {result.status_note ? <p className="track-note">{result.status_note}</p> : null}

              {result.journey?.length ? (
                <ol
                  className="track-trail"
                  aria-label={`Progress: ${result.status_label ?? result.status}`}
                >
                  {result.journey.map((stage, i) => (
                    <li
                      key={stage}
                      data-state={
                        result.journey_index === null || result.journey_index === undefined
                          ? "off"
                          : i < result.journey_index
                            ? "done"
                            : i === result.journey_index
                              ? "now"
                              : "next"
                      }
                    >
                      <span className="track-dot" aria-hidden />
                      <span className="track-stage">{JOURNEY_LABELS[stage] ?? stage}</span>
                    </li>
                  ))}
                </ol>
              ) : null}
              {isPortal(result) ? (
                <ul>
                  <li>Payout: {result.payout_method || "—"} · {result.payout_status || "pending"}</li>
                  <li>
                    Shipping: {result.courier || "—"} · {result.tracking_number || "No tracking yet"}
                  </li>
                  {result.invoice ? (
                    <li>
                      Invoice {result.invoice.id} · {result.invoice.status} · $
                      {Number(result.invoice.amount).toLocaleString()}
                    </li>
                  ) : null}
                </ul>
              ) : null}
              <ul>
                {result.items.map((d, i) => (
                  <li key={`${d.device_name}-${i}`}>
                    {joinDetails(d.device_name, displayStorage(d.storage), displayStorage(d.memory))} · ${d.quoted_price}
                  </li>
                ))}
              </ul>
              <p className="field-hint">
                {result.first_name} {result.last_name}
                {result.email ? ` · ${result.email}` : ""}
              </p>
            </>
          ) : (
            <>
              <p>
                <strong>{result.id}</strong> · {result.status} · ${result.total.toLocaleString()} CAD
              </p>
              <ul>
                {result.devices.map((d) => (
                  <li key={d.id}>
                    {joinDetails(d.deviceName, displayStorage(d.storage), displayStorage(d.memory))} · ${d.offer}
                  </li>
                ))}
              </ul>
              <p className="field-hint">
                {result.contact.firstName} {result.contact.lastName} · {result.contact.method} ·{" "}
                {result.contact.payout}
              </p>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
