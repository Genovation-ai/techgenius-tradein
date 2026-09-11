import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { adminFetch, onStoreChange, withStoreScope } from "../api";

interface PayoutRow {
  id: string;
  offer_status: string;
  total_value: number;
  payout_method?: string;
  payout_status?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
}

export function PayoutsPage() {
  const [rows, setRows] = useState<PayoutRow[]>([]);
  const [summary, setSummary] = useState<Array<{ payout_status: string; count: number; total: number }>>([]);
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const params = withStoreScope(new URLSearchParams());
    if (filter !== "all") params.set("status", filter);
    const suffix = params.toString() ? `?${params}` : "";
    adminFetch<{ rows: PayoutRow[]; summary: typeof summary }>(`/api/payouts${suffix}`)
      .then((data) => {
        setRows(data.rows);
        setSummary(data.summary);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => onStoreChange(load), [load]);

  const setStatus = async (id: string, payout_status: string) => {
    await adminFetch(`/api/payouts/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ payout_status }),
    });
    load();
  };

  return (
    <>
      <h1 className="admin-page-title">Payouts</h1>
      <p className="admin-section-lead">
        Track payout readiness and mark e-Transfer / cash / store-credit payouts as paid.
      </p>
      {error ? <p className="admin-error">{error}</p> : null}

      <div className="admin-kpis">
        {summary.map((s) => (
          <div className="admin-kpi" key={s.payout_status || "none"}>
            <div>
              <span>{s.payout_status || "unset"}</span>
              <strong>
                {s.count} · ${Number(s.total || 0).toLocaleString()}
              </strong>
            </div>
          </div>
        ))}
      </div>

      <div className="admin-toolbar">
        <select className="admin-select" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="ready">Ready</option>
          <option value="processing">Processing</option>
          <option value="paid">Paid</option>
          <option value="failed">Failed</option>
        </select>
        <button type="button" className="admin-btn admin-btn--ghost" onClick={load}>
          Refresh
        </button>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Offer</th>
              <th>Customer</th>
              <th>Method</th>
              <th>Value</th>
              <th>Payout status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  <div className="admin-empty">No payouts are due</div>
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link to={`/admin/offers/${encodeURIComponent(r.id)}`}>{r.id}</Link>
                    <div className="admin-muted">{r.offer_status}</div>
                  </td>
                  <td>
                    {r.first_name} {r.last_name}
                    <div className="admin-muted">{r.email}</div>
                  </td>
                  <td>{r.payout_method || "—"}</td>
                  <td>${Number(r.total_value || 0).toLocaleString()}</td>
                  <td>
                    <select
                      className="admin-select"
                      value={r.payout_status || "pending"}
                      onChange={(e) => void setStatus(r.id, e.target.value)}
                    >
                      <option value="pending">Pending</option>
                      <option value="ready">Ready</option>
                      <option value="processing">Processing</option>
                      <option value="paid">Paid</option>
                      <option value="failed">Failed</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
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
