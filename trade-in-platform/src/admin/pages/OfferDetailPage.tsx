import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { adminFetch, apiUrl, getAdminApiKey, PIPELINE_STAGES, type OfferDetail } from "../api";
import { DeviceThumb } from "../DeviceThumb";
import { pushOfferToCrm } from "../../lib/twenty";

export function OfferDetailPage() {
  const { id = "" } = useParams();
  const [offer, setOffer] = useState<OfferDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState("");
  const [tracking, setTracking] = useState("");
  const [courier, setCourier] = useState("");
  const [labelUrl, setLabelUrl] = useState("");
  const [payoutMethod, setPayoutMethod] = useState("");
  const [history, setHistory] = useState<Array<{
    id: number; action: string; field?: string | null; old_value?: string | null;
    new_value?: string | null; actor?: string | null; actor_role?: string | null;
    note?: string | null; created_at?: string;
  }>>([]);

  const load = useCallback(() => {
    adminFetch<OfferDetail>(`/api/offers/${encodeURIComponent(id)}`)
      .then((o) => {
        setOffer(o);
        setNotes(o.notes || "");
        setTracking(o.tracking_number || "");
        setCourier(o.courier || "");
        setLabelUrl(o.shipping_label_url || "");
        setPayoutMethod(o.payout_method || "");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Not found"));
    // Best-effort: an offer is still usable if its history cannot be read.
    adminFetch<typeof history>(`/api/offers/${encodeURIComponent(id)}/history`)
      .then(setHistory)
      .catch(() => setHistory([]));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await adminFetch(`/api/offers/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          notes,
          tracking_number: tracking,
          courier,
          shipping_label_url: labelUrl,
          payout_method: payoutMethod,
        }),
      });
      load();
      setMessage("Saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (status: string) => {
    await adminFetch(`/api/offers/${encodeURIComponent(id)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    load();
  };

  const generateLabel = async () => {
    setError(null);
    try {
      const res = await adminFetch<{
        shipping_label_url: string;
        tracking_number: string;
        courier: string;
      }>(`/api/offers/${encodeURIComponent(id)}/shipping-label`, {
        method: "POST",
        body: JSON.stringify({ tracking_number: tracking || undefined, courier: courier || undefined }),
      });
      setLabelUrl(res.shipping_label_url);
      setTracking(res.tracking_number);
      setCourier(res.courier);
      setMessage("Shipping label generated");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Label failed");
    }
  };

  const openLabel = async () => {
    const key = getAdminApiKey();
    const res = await fetch(apiUrl(`/api/offers/${encodeURIComponent(id)}/shipping-label`), {
      headers: { "x-api-key": key },
    });
    const html = await res.text();
    const w = window.open("", "_blank");
    if (w) {
      w.document.write(html);
      w.document.close();
    }
  };

  const dispatchCrm = async () => {
    try {
      const result = await pushOfferToCrm(id, getAdminApiKey());
      setMessage(`CRM: ${result.status}${result.detail ? ` — ${result.detail}` : ""}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "CRM failed");
    }
  };

  const uploadFile = async (file: File) => {
    setError(null);
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
    const content_base64 = btoa(binary);
    try {
      await adminFetch("/api/uploads", {
        method: "POST",
        body: JSON.stringify({
          offer_id: id,
          filename: file.name,
          mime_type: file.type || "application/octet-stream",
          content_base64,
        }),
      });
      setMessage(`Uploaded ${file.name}`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    }
  };

  if (!offer && !error) return <p>Loading…</p>;
  if (!offer) return <p className="admin-error">{error}</p>;

  const invoice = (offer as OfferDetail & { invoice?: { id: string; status: string; amount: number } | null })
    .invoice;
  const uploads = (
    offer as OfferDetail & {
      uploads?: Array<{ id: string; filename: string; mime_type: string; size_bytes: number; angle?: string }>;
      ai_scan?: {
        suggested_grade?: string;
        confirmed_grade?: string;
        confidence?: number;
        issues?: Array<{ label: string; angle: string; severity: string }>;
        angles_covered?: string[];
      } | null;
    }
  ).uploads;
  const aiScan = (offer as { ai_scan?: {
    suggested_grade?: string;
    confirmed_grade?: string;
    confidence?: number;
    issues?: Array<{ label: string; angle: string; severity: string }>;
    angles_covered?: string[];
  } | null }).ai_scan;

  return (
    <>
      <div className="admin-breadcrumb">
        <Link to="/admin/offers">Offer Management</Link> &gt; {offer.id}
      </div>
      <div className="admin-header-row">
        <h1 className="admin-page-title" style={{ margin: 0 }}>
          Offer {offer.id}
        </h1>
        <div className="admin-inline-actions">
          <button type="button" className="admin-btn admin-btn--ghost" onClick={() => void dispatchCrm()}>
            Sync CRM
          </button>
          <button type="button" className="admin-btn" disabled={saving} onClick={() => void save()}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {error ? <p className="admin-error">{error}</p> : null}
      {message ? <p className="admin-ok">{message}</p> : null}

      <div className="admin-kpis">
        <div className="admin-kpi">
          <div>
            <span>Customer</span>
            <strong>
              {offer.first_name} {offer.last_name}
            </strong>
          </div>
        </div>
        <div className="admin-kpi">
          <div>
            <span>Status</span>
            <strong style={{ fontSize: "1rem" }}>
              {PIPELINE_STAGES.find((s) => s.id === offer.status)?.label || offer.status}
            </strong>
          </div>
        </div>
        <div className="admin-kpi">
          <div>
            <span>Total Value</span>
            <strong>${Number(offer.total_value || 0).toLocaleString()}</strong>
          </div>
        </div>
        {invoice ? (
          <div className="admin-kpi">
            <div>
              <span>Invoice</span>
              <strong style={{ fontSize: "0.95rem" }}>
                {invoice.id} · {invoice.status}
              </strong>
            </div>
          </div>
        ) : null}
      </div>

      <h2 className="admin-section-title">Devices</h2>
      <div className="admin-offer-devices">
        {(offer.items || []).map((item) => (
          <div key={item.id} className="admin-offer-device">
            <DeviceThumb
              imageUrl={item.device_image_url}
              deviceId={item.device_id}
              name={item.device_name}
            />
            <div>
              <strong>{item.device_name}</strong>
              <div style={{ color: "#8b93a7", fontSize: "0.82rem" }}>
                {item.storage || "—"} · {item.condition_grade || "—"} · {item.carrier || "—"}
              </div>
            </div>
            <strong>${Number(item.quoted_price || 0).toLocaleString()}</strong>
          </div>
        ))}
      </div>

      <h2 className="admin-section-title">Shipping & payout</h2>
      <div className="admin-panel admin-form-grid">
        <label>
          Pipeline status
          <select className="admin-select" value={offer.status} onChange={(e) => void setStatus(e.target.value)}>
            {PIPELINE_STAGES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Payout method
          <input className="admin-input" value={payoutMethod} onChange={(e) => setPayoutMethod(e.target.value)} />
        </label>
        <label>
          Courier
          <input className="admin-input" value={courier} onChange={(e) => setCourier(e.target.value)} />
        </label>
        <label>
          Tracking number
          <input className="admin-input" value={tracking} onChange={(e) => setTracking(e.target.value)} />
        </label>
        <label>
          Shipping label URL
          <input className="admin-input" value={labelUrl} onChange={(e) => setLabelUrl(e.target.value)} />
        </label>
        <label>
          Notes
          <textarea className="admin-input" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>

      <div className="admin-inline-actions" style={{ marginTop: "0.75rem" }}>
        <button type="button" className="admin-btn" onClick={() => void generateLabel()}>
          Generate shipping label
        </button>
        {labelUrl ? (
          <button type="button" className="admin-btn admin-btn--ghost" onClick={() => void openLabel()}>
            Print label
          </button>
        ) : null}
      </div>

      <h2 className="admin-section-title">Vision condition scan</h2>
      {aiScan ? (
        <div className="admin-panel" style={{ marginBottom: "1rem" }}>
          <p style={{ margin: 0 }}>
            Suggested <strong>{aiScan.suggested_grade || "—"}</strong>
            {aiScan.confirmed_grade ? <> · confirmed <strong>{aiScan.confirmed_grade}</strong></> : null}
            {aiScan.confidence != null ? <> · {aiScan.confidence}% confidence</> : null}
          </p>
          {aiScan.angles_covered?.length ? (
            <p className="admin-section-lead" style={{ marginTop: "0.35rem" }}>
              Angles: {aiScan.angles_covered.join(", ")}
            </p>
          ) : null}
          {aiScan.issues?.length ? (
            <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.1rem" }}>
              {aiScan.issues.map((issue, i) => (
                <li key={`${issue.label}-${i}`}>
                  {issue.label} ({issue.angle} · {issue.severity})
                </li>
              ))}
            </ul>
          ) : (
            <p className="admin-section-lead">No structured issues recorded.</p>
          )}
        </div>
      ) : (
        <p className="admin-section-lead">No customer vision scan on this offer.</p>
      )}

      {/* Who touched this offer. A customer disputing a payout or a manager
          checking an operator needs the sequence, not just the current state. */}
      <h2 className="admin-section-title">History</h2>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>What changed</th>
            </tr>
          </thead>
          <tbody>
            {!history.length ? (
              <tr>
                <td colSpan={3}>
                  <div className="admin-empty">No changes recorded yet</div>
                </td>
              </tr>
            ) : (
              history.map((h) => (
                <tr key={h.id}>
                  <td className="admin-muted">{h.created_at}</td>
                  <td>
                    {h.actor || "system"}
                    {h.actor_role ? <span className="admin-muted"> · {h.actor_role}</span> : null}
                  </td>
                  <td>
                    <strong>{h.action.replace(/_/g, " ")}</strong>
                    {h.field ? (
                      <span className="admin-muted">
                        {" "}
                        {h.old_value ? `${h.old_value} → ` : ""}
                        {h.new_value ?? ""}
                      </span>
                    ) : null}
                    {h.note ? <div className="admin-muted">{h.note}</div> : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <h2 className="admin-section-title">Documents</h2>
      <div className="admin-toolbar">
        <input
          type="file"
          accept="image/*,application/pdf"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void uploadFile(f);
          }}
        />
      </div>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>File</th>
              <th>Angle</th>
              <th>Type</th>
              <th>Size</th>
            </tr>
          </thead>
          <tbody>
            {!uploads?.length ? (
              <tr>
                <td colSpan={4}>
                  <div className="admin-empty">No uploads yet</div>
                </td>
              </tr>
            ) : (
              uploads.map((u) => (
                <tr key={u.id}>
                  <td>{u.filename}</td>
                  <td>{u.angle || "—"}</td>
                  <td>{u.mime_type}</td>
                  <td>{Math.round(u.size_bytes / 1024)} KB</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
