import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { adminFetch, PIPELINE_STAGES, type DashboardData, type OfferRow } from "../api";

export function DashboardPage() {
  const [offers, setOffers] = useState<OfferRow[]>([]);
  const [stats, setStats] = useState<DashboardData["stats"] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([
      adminFetch<OfferRow[]>("/api/offers?limit=200"),
      adminFetch<DashboardData>("/api/dashboard"),
    ])
      .then(([rows, dash]) => {
        setOffers(rows);
        setStats(dash.stats);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const byStatus = useMemo(() => {
    const map = new Map<string, OfferRow[]>();
    for (const s of PIPELINE_STAGES) map.set(s.id, []);
    for (const o of offers) {
      const list = map.get(o.status) ?? [];
      list.push(o);
      map.set(o.status, list);
    }
    return map;
  }, [offers]);

  return (
    <>
      <h1 className="admin-page-title">Dashboard</h1>
      {error ? <p className="admin-error">{error}</p> : null}

      {stats ? (
        <div className="admin-kpis">
          <div className="admin-kpi">
            <div>
              <span>Total offers</span>
              <strong>{stats.total_offers}</strong>
            </div>
          </div>
          <div className="admin-kpi">
            <div>
              <span>Active customers</span>
              <strong>{stats.total_customers}</strong>
            </div>
          </div>
          <div className="admin-kpi">
            <div>
              <span>Available inventory</span>
              <strong>{stats.available_inventory}</strong>
            </div>
          </div>
          <div className="admin-kpi">
            <div>
              <span>Completed buyback value</span>
              <strong>${Number(stats.completed_revenue || 0).toLocaleString()}</strong>
            </div>
          </div>
        </div>
      ) : null}

      <div className="admin-stage-grid">
        {PIPELINE_STAGES.map((stage) => {
          const rows = byStatus.get(stage.id) ?? [];
          return (
            <article key={stage.id} className="admin-stage-card">
              <div className="admin-stage-card-head">
                <h3>{stage.label}</h3>
                <span className="admin-count-badge">{rows.length}</span>
              </div>
              {rows.length === 0 ? (
                <p className="admin-stage-empty">Nothing at this stage</p>
              ) : (
                <ul className="admin-stage-list">
                  {rows.slice(0, 5).map((o) => (
                    <li key={o.id}>
                      <Link to={`/admin/offers/${encodeURIComponent(o.id)}`}>
                        {o.first_name || o.id}
                      </Link>
                      <span>${Number(o.total_value || 0).toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          );
        })}
      </div>

      <div className="admin-header-row" style={{ marginTop: "1.5rem" }}>
        <h2 className="admin-section-title" style={{ margin: 0 }}>
          Real-time widget preview
        </h2>
        <Link className="admin-btn" to="/">
          Open Trade-In Widget
        </Link>
      </div>
      <p className="admin-section-lead">
        Customer-facing sell flow with device photos, live catalog pricing, and offer pipeline sync.
      </p>
    </>
  );
}
