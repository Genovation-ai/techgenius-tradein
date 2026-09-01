import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { adminFetch, PIPELINE_STAGES, type OfferRow } from "../api";

const SHIPPING_STATUSES = new Set<string>(["in_transit", "being_inspected", "delivered", "completed"]);

export function ShippingPage() {
  const [offers, setOffers] = useState<OfferRow[]>([]);
  const [status, setStatus] = useState<string>("completed");
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    adminFetch<OfferRow[]>("/api/offers?limit=300")
      .then(setOffers)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return offers.filter((o) => {
      if (!SHIPPING_STATUSES.has(o.status)) return false;
      if (status !== "all" && o.status !== status) return false;
      if (!term) return true;
      const hay = `${o.id} ${o.first_name || ""} ${o.last_name || ""} ${o.email || ""}`.toLowerCase();
      return hay.includes(term);
    });
  }, [offers, status, q]);

  const move = async (id: string, next: string) => {
    await adminFetch(`/api/offers/${encodeURIComponent(id)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: next }),
    });
    load();
  };

  return (
    <>
      <div className="admin-header-row">
        <h1 className="admin-page-title" style={{ margin: 0 }}>
          Shipping
        </h1>
        <div style={{ display: "flex", gap: "0.7rem", alignItems: "center" }}>
          <select className="admin-select" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All shipping</option>
            {PIPELINE_STAGES.filter((s) => SHIPPING_STATUSES.has(s.id)).map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className="admin-section-lead">Quick shipping status management (edit details in Offer Detail).</p>

      <div className="admin-toolbar">
        <input
          className="admin-input grow"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by offer id / customer / email"
        />
        <button type="button" className="admin-btn admin-btn--ghost" onClick={load}>
          Refresh
        </button>
      </div>

      {error ? <p className="admin-error">{error}</p> : null}

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Offer</th>
              <th>Customer</th>
              <th>Status</th>
              <th>Move</th>
              <th>Open</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  <div className="admin-empty">No shipping offers found</div>
                </td>
              </tr>
            ) : (
              filtered.map((o) => (
                <tr key={o.id}>
                  <td>
                    <Link to={`/admin/offers/${encodeURIComponent(o.id)}`}>{o.id}</Link>
                  </td>
                  <td>
                    {o.first_name} {o.last_name}
                  </td>
                  <td>{PIPELINE_STAGES.find((s) => s.id === o.status)?.label || o.status}</td>
                  <td>
                    <select className="admin-select" value={o.status} onChange={(e) => void move(o.id, e.target.value)}>
                      {PIPELINE_STAGES.filter((s) => SHIPPING_STATUSES.has(s.id)).map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <Link className="admin-btn admin-btn--ghost" to={`/admin/offers/${encodeURIComponent(o.id)}`}>
                      Details
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

