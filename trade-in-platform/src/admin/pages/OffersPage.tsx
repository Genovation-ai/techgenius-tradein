import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  adminFetch,
  getAdminChannelPreference,
  onStoreChange,
  PIPELINE_STAGES,
  withStoreScope,
  payoutLabel,
  stageLabel,
  stageTone,
  type OfferRow,
} from "../api";

export function OffersPage() {
  const [params] = useSearchParams();
  const initialType = (params.get("type") || getAdminChannelPreference() || "all") as
    | "all"
    | "mail-in"
    | "drop-off";
  const [offers, setOffers] = useState<OfferRow[]>([]);
  const [tab, setTab] = useState<"all" | "mail-in" | "drop-off">(
    initialType === "mail-in" || initialType === "drop-off" || initialType === "all" ? initialType : "all",
  );
  const [status, setStatus] = useState<string>("all");
  const [q, setQ] = useState(params.get("q") || "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const nextQ = params.get("q");
    if (nextQ != null) setQ(nextQ);
    const nextType = params.get("type");
    if (nextType === "mail-in" || nextType === "drop-off" || nextType === "all") setTab(nextType);
  }, [params]);

  const load = useCallback(() => {
    const params = withStoreScope(new URLSearchParams({ limit: "300" }));
    if (q.trim()) params.set("q", q.trim());
    if (tab !== "all") params.set("offer_type", tab);
    adminFetch<OfferRow[]>(`/api/offers?${params}`)
      .then(setOffers)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, [q, tab]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => onStoreChange(load), [load]);

  const filtered = useMemo(() => {
    return offers.filter((o) => {
      if (status !== "all" && o.status !== status) return false;
      return true;
    });
  }, [offers, status]);

  const totalValue = filtered.reduce((s, o) => s + Number(o.total_value || 0), 0);
  const avg = filtered.length ? totalValue / filtered.length : 0;

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of PIPELINE_STAGES) m.set(s.id, 0);
    for (const o of offers) m.set(o.status, (m.get(o.status) || 0) + 1);
    return m;
  }, [offers]);

  const move = async (id: string, next: string) => {
    await adminFetch(`/api/offers/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: next }),
    });
    load();
  };

  return (
    <>
      <h1 className="admin-page-title">Offer Management</h1>

      <div className="admin-tabs">
        {(
          [
            ["all", "All"],
            ["mail-in", "Mail-In"],
            ["drop-off", "Drop-Off"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      <div className="admin-kpis">
        <div className="admin-kpi">
          <div>
            <span>Offers</span>
            <strong>{filtered.length}</strong>
          </div>
        </div>
        <div className="admin-kpi">
          <div>
            <span>Average offer</span>
            <strong>${avg.toFixed(2)}</strong>
          </div>
        </div>
        <div className="admin-kpi">
          <div>
            <span>Total value</span>
            <strong>${totalValue.toLocaleString()}</strong>
          </div>
        </div>
      </div>

      <div className="admin-status-filters">
        <button type="button" className={status === "all" ? "active" : ""} onClick={() => setStatus("all")}>
          <span className="admin-count-badge">{offers.length}</span> All
        </button>
        {PIPELINE_STAGES.map((s) => (
          <button
            key={s.id}
            type="button"
            className={status === s.id ? "active" : ""}
            onClick={() => setStatus(s.id)}
          >
            <span className="admin-count-badge">{counts.get(s.id) || 0}</span> {s.label}
          </button>
        ))}
      </div>

      <div className="admin-toolbar">
        <input
          className="admin-input grow"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter these offers — id, customer, or email"
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
              <th>Offer ID</th>
              <th>Customer</th>
              <th>Email</th>
              <th>Status</th>
              <th>Payout</th>
              <th>Value</th>
              <th>Change stage</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <div className="admin-empty">No offers match this filter.</div>
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
                  <td>{o.email || "—"}</td>
                  <td>
                    <span
                      className="admin-status-pill"
                      data-tone={stageTone(o.status)}
                    >
                      {stageLabel(o.status)}
                    </span>
                  </td>
                  <td>{payoutLabel(o.payout_method)}</td>
                  <td>${Number(o.total_value || 0).toLocaleString()}</td>
                  <td>
                    <select
                      className="admin-select"
                      value={o.status}
                      onChange={(e) => void move(o.id, e.target.value)}
                    >
                      {PIPELINE_STAGES.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
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
