import { useState } from "react";
import { Link } from "react-router-dom";
import { adminFetch } from "../api";

type Line = {
  device_id: string;
  device_name: string;
  storage: string;
  condition_grade: string;
};

export function BulkHandoffPage() {
  const [mode, setMode] = useState<"bulk" | "handoff">("handoff");
  const [lines, setLines] = useState<Line[]>([
    { device_id: "iphone-15", device_name: "iPhone 15", storage: "128GB", condition_grade: "good" },
  ]);
  const [contact, setContact] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
  });
  const [quote, setQuote] = useState<{ total_value: number; items: Array<{ quoted_price: number | null; error?: string }> } | null>(
    null,
  );
  const [resultId, setResultId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resolveMsg, setResolveMsg] = useState<string | null>(null);

  const resolveLineFromName = async (idx: number) => {
    const line = lines[idx];
    const name = (line.device_name || line.device_id || "").trim();
    if (!name) {
      setError("Type a model name first (e.g. iPhone 17 Pro Max)");
      return;
    }
    setBusy(true);
    setError(null);
    setResolveMsg(null);
    try {
      const boot = await adminFetch<{
        created: boolean;
        device: { id: string; name: string; storages?: string[] };
        image?: { method?: string } | null;
      }>("/api/catalog/devices/from-name", {
        method: "POST",
        body: JSON.stringify({ name, rebuild_image: true }),
      });
      setLines((all) =>
        all.map((l, i) =>
          i === idx
            ? {
                ...l,
                device_id: boot.device.id,
                device_name: boot.device.name,
                storage: l.storage || boot.device.storages?.[0] || "128GB",
              }
            : l,
        ),
      );
      setResolveMsg(
        `${boot.created ? "Added" : "Linked"} ${boot.device.name} · image ${boot.image?.method || "ready"}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build device");
    } finally {
      setBusy(false);
    }
  };

  const runQuote = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await adminFetch<{ total_value: number; items: Array<{ quoted_price: number | null; error?: string }> }>(
        "/api/bulk/quote",
        { method: "POST", body: JSON.stringify({ items: lines }) },
      );
      setQuote(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Quote failed");
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const path = mode === "handoff" ? "/api/offers/handoff" : "/api/bulk/offer";
      const data = await adminFetch<{ id: string; total_value: number }>(path, {
        method: "POST",
        body: JSON.stringify({
          contact,
          items: lines,
          offer_type: mode === "handoff" ? "drop-off" : "mail-in",
          payout_method: mode === "handoff" ? "cash" : "etransfer",
        }),
      });
      setResultId(data.id);
      setQuote({ total_value: data.total_value, items: [] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1 className="admin-page-title">Bulk quote & hand-off</h1>
      <p className="admin-section-lead">
        Quote many devices at once, create a bulk offer, or hand off a walk-in drop-off from the counter.
        New phone releases: type the model name and hit <strong>Build</strong> — we generate the image and add it.
      </p>

      <div className="admin-tabs">
        <button type="button" className={mode === "handoff" ? "active" : ""} onClick={() => setMode("handoff")}>
          Hand-off
        </button>
        <button type="button" className={mode === "bulk" ? "active" : ""} onClick={() => setMode("bulk")}>
          Bulk offer
        </button>
      </div>

      {error ? <p className="admin-error">{error}</p> : null}
      {resolveMsg ? <p className="admin-ok">{resolveMsg}</p> : null}
      {resultId ? (
        <p className="admin-ok">
          Created{" "}
          <Link to={`/admin/offers/${encodeURIComponent(resultId)}`}>{resultId}</Link>
        </p>
      ) : null}

      <div className="admin-pricing-form" style={{ maxWidth: 900 }}>
        <h2 className="admin-section-title">Customer</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
          <input
            className="admin-input"
            placeholder="First name"
            value={contact.first_name}
            onChange={(e) => setContact((c) => ({ ...c, first_name: e.target.value }))}
          />
          <input
            className="admin-input"
            placeholder="Last name"
            value={contact.last_name}
            onChange={(e) => setContact((c) => ({ ...c, last_name: e.target.value }))}
          />
          <input
            className="admin-input"
            placeholder="Email"
            value={contact.email}
            onChange={(e) => setContact((c) => ({ ...c, email: e.target.value }))}
          />
          <input
            className="admin-input"
            placeholder="Phone"
            value={contact.phone}
            onChange={(e) => setContact((c) => ({ ...c, phone: e.target.value }))}
          />
        </div>

        <h2 className="admin-section-title">Devices</h2>
        {lines.map((line, idx) => (
          <div
            key={idx}
            style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 0.9fr 0.7fr auto auto", gap: "0.4rem", marginBottom: "0.35rem" }}
          >
            <input
              className="admin-input"
              value={line.device_name || line.device_id}
              onChange={(e) =>
                setLines((all) =>
                  all.map((l, i) =>
                    i === idx
                      ? { ...l, device_name: e.target.value, device_id: e.target.value.includes(" ") ? "auto" : e.target.value }
                      : l,
                  ),
                )
              }
              placeholder="Model name or id — e.g. iPhone 17 Pro Max"
            />
            <input
              className="admin-input"
              value={line.storage}
              onChange={(e) => setLines((all) => all.map((l, i) => (i === idx ? { ...l, storage: e.target.value } : l)))}
              placeholder="128GB"
            />
            <select
              className="admin-select"
              value={line.condition_grade}
              onChange={(e) =>
                setLines((all) => all.map((l, i) => (i === idx ? { ...l, condition_grade: e.target.value } : l)))
              }
            >
              <option value="flawless">Pristine</option>
              <option value="good">Great</option>
              <option value="average">Wear</option>
              <option value="fair">Cracked</option>
              <option value="defective">As-Is</option>
            </select>
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              disabled={busy}
              onClick={() => void resolveLineFromName(idx)}
              title="Build image and add to catalog from name"
            >
              Build
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              onClick={() => setLines((all) => all.filter((_, i) => i !== idx))}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          className="admin-btn admin-btn--ghost"
          onClick={() =>
            setLines((all) => [
              ...all,
              { device_id: "auto", device_name: "", storage: "128GB", condition_grade: "good" },
            ])
          }
        >
          Add device
        </button>

        <div className="admin-inline-actions" style={{ marginTop: "0.75rem" }}>
          <button type="button" className="admin-btn admin-btn--ghost" disabled={busy} onClick={() => void runQuote()}>
            Preview quote
          </button>
          <button type="button" className="admin-btn" disabled={busy} onClick={() => void submit()}>
            {mode === "handoff" ? "Create hand-off offer" : "Create bulk offer"}
          </button>
        </div>
        {quote ? (
          <p className="admin-ok">
            Quote total: <strong>${Number(quote.total_value || 0).toLocaleString()}</strong>
          </p>
        ) : null}
      </div>
    </>
  );
}
