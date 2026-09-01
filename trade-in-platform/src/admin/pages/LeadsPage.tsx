import { useCallback, useEffect, useState } from "react";
import { adminFetch, onStoreChange, withStoreScope } from "../api";

interface LeadItem {
  device_name?: string;
  storage?: string;
  condition_grade?: string;
  quoted_price?: number;
}

interface Lead {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  offer_type?: string | null;
  payout_method?: string | null;
  quoted_total: number;
  furthest_step?: string | null;
  status: string;
  updated_at?: string;
  items: LeadItem[];
}

const STATUSES = [
  { id: "open", label: "To follow up" },
  { id: "contacted", label: "Contacted" },
  { id: "converted", label: "Recovered" },
  { id: "dismissed", label: "Dismissed" },
];

/**
 * Abandoned buybacks — people who priced a device and left contact details but
 * never submitted. Every one is a customer who nearly sold to us, and before
 * this page they were discarded silently.
 */
export function LeadsPage() {
  const [rows, setRows] = useState<Lead[]>([]);
  const [totals, setTotals] = useState<Array<{ status: string; count: number; value: number }>>([]);
  const [status, setStatus] = useState("open");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    const params = withStoreScope(new URLSearchParams({ status }));
    adminFetch<{ rows: Lead[]; totals: typeof totals }>(`/api/offers/leads?${params}`)
      .then((d) => {
        setRows(d.rows || []);
        setTotals(d.totals || []);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load leads"))
      .finally(() => setLoading(false));
  }, [status]);

  useEffect(() => load(), [load]);
  useEffect(() => onStoreChange(load), [load]);

  const setLeadStatus = async (id: string, next: string) => {
    await adminFetch(`/api/offers/leads/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ status: next }),
    });
    load();
  };

  const open = totals.find((t) => t.status === "open");

  return (
    <>
      <div className="admin-header-row">
        <h1 className="admin-page-title" style={{ margin: 0 }}>
          Follow-ups
        </h1>
        <button type="button" className="admin-btn admin-btn--ghost" onClick={load} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>
      <p className="admin-section-lead">
        People who priced a device and gave us a way to reach them, but never submitted. Calling
        these back is usually the cheapest stock you can buy.
      </p>

      {error ? <p className="admin-error">{error}</p> : null}

      <div className="admin-kpis">
        <div className="admin-kpi">
          <div>
            <span>Waiting on a call</span>
            <strong>{open?.count ?? 0}</strong>
          </div>
        </div>
        <div className="admin-kpi">
          <div>
            <span>Value left on the table</span>
            <strong>${Math.round(open?.value ?? 0).toLocaleString()}</strong>
          </div>
        </div>
        {STATUSES.filter((s) => s.id !== "open").map((s) => (
          <div className="admin-kpi" key={s.id}>
            <div>
              <span>{s.label}</span>
              <strong>{totals.find((t) => t.status === s.id)?.count ?? 0}</strong>
            </div>
          </div>
        ))}
      </div>

      <div className="admin-toolbar">
        <select className="admin-select" value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUSES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Contact</th>
              <th>Devices</th>
              <th>Quoted</th>
              <th>Got as far as</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {!rows.length ? (
              <tr>
                <td colSpan={6}>
                  <div className="admin-empty">
                    {status === "open" ? "Nobody waiting — every lead has been handled." : "Nothing here."}
                  </div>
                </td>
              </tr>
            ) : (
              rows.map((l) => (
                <tr key={l.id}>
                  <td>{[l.first_name, l.last_name].filter(Boolean).join(" ") || "—"}</td>
                  <td>
                    {l.email ? <div>{l.email}</div> : null}
                    {l.phone ? <div className="admin-muted">{l.phone}</div> : null}
                  </td>
                  <td>
                    {l.items.length
                      ? l.items
                          .map((i) => [i.device_name, i.storage, i.condition_grade].filter(Boolean).join(" · "))
                          .join(", ")
                      : "—"}
                  </td>
                  <td>${Math.round(l.quoted_total || 0).toLocaleString()}</td>
                  <td className="admin-muted">{l.furthest_step || "—"}</td>
                  <td>
                    <div className="admin-inline-actions">
                      {l.email ? (
                        <a
                          className="admin-btn admin-btn--ghost"
                          href={`mailto:${l.email}?subject=Your%20Tech%20Genius%20trade-in%20quote`}
                        >
                          Email
                        </a>
                      ) : null}
                      {l.status !== "contacted" ? (
                        <button type="button" className="admin-btn admin-btn--ghost" onClick={() => void setLeadStatus(l.id, "contacted")}>
                          Mark contacted
                        </button>
                      ) : null}
                      <button type="button" className="admin-btn admin-btn--ghost" onClick={() => void setLeadStatus(l.id, "dismissed")}>
                        Dismiss
                      </button>
                    </div>
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
