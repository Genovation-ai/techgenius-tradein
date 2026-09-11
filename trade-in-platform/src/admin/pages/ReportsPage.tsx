import { useEffect, useState } from "react";
import { HowThisWorks } from "../HowThisWorks";
import { adminFetch } from "../api";

type ByStatusRow = { status: string; count: number; total: number };
type ByMonthRow = { month: string; count: number; total: number };
type TopDeviceRow = { device_name: string; count: number; total: number };
type PromoRow = { code: string; uses: number; discount_percent: number; discount_amount: number; active: number };
type CustomerRow = { status: string; count: number };

interface ReportSummary {
  byStatus: ByStatusRow[];
  byMonth: ByMonthRow[];
  topDevices: TopDeviceRow[];
  promos: PromoRow[];
  customers: CustomerRow[];
}

export function ReportsPage() {
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminFetch<ReportSummary>("/api/reports/summary")
      .then(setSummary)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);

  const totals = (() => {
    if (!summary) return { totalOffers: 0, totalRevenue: 0, completedCount: 0 };
    const totalOffers = summary.byStatus.reduce((s, r) => s + (r.count || 0), 0);
    const totalRevenue = summary.byStatus.reduce((s, r) => s + (r.total || 0), 0);
    const completedCount = summary.byStatus.find((r) => r.status === "completed")?.count ?? 0;
    return { totalOffers, totalRevenue, completedCount };
  })();

  return (
    <>
      <div className="admin-header-row">
        <h1 className="admin-page-title" style={{ margin: 0 }}>
          Reports
        </h1>
      <p className="admin-section-lead">What you have bought, what it cost, and what is still owed.</p>
      <HowThisWorks
        steps={[
        "Pick a date range; every figure below is recalculated for it.",
        "Totals count only completed offers, so quotes a customer never sent do not inflate them.",
        "Use the store filter in the sidebar to read one location on its own.",
      ]}
      />
        <span style={{ color: "#8b93a7" }}>Overview & insights</span>
      </div>

      {error ? <p className="admin-error">{error}</p> : null}
      {!summary && !error ? <p>Loading…</p> : null}

      {summary ? (
        <>
          <div className="admin-kpis">
            <div className="admin-kpi">
              <div className="admin-kpi-ico">📦</div>
              <div>
                <span>Total Offers</span>
                <strong>{totals.totalOffers}</strong>
              </div>
            </div>
            <div className="admin-kpi">
              <div className="admin-kpi-ico">💰</div>
              <div>
                <span>Total Value</span>
                <strong>${totals.totalRevenue.toLocaleString()}</strong>
              </div>
            </div>
            <div className="admin-kpi">
              <div className="admin-kpi-ico">✅</div>
              <div>
                <span>Completed</span>
                <strong>{totals.completedCount}</strong>
              </div>
            </div>
          </div>

          <div className="admin-header-row" style={{ marginTop: "1.25rem" }}>
            <h2 className="admin-section-title" style={{ margin: 0 }}>
              Top devices
            </h2>
          </div>

          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Device</th>
                  <th>Count</th>
                  <th>Total Value</th>
                </tr>
              </thead>
              <tbody>
                {summary.topDevices.length === 0 ? (
                  <tr>
                    <td colSpan={3}>
                      <div className="admin-empty">No devices priced yet</div>
                    </td>
                  </tr>
                ) : (
                  summary.topDevices.map((d, idx) => (
                    <tr key={`${d.device_name}-${idx}`}>
                      <td>{d.device_name}</td>
                      <td>{d.count}</td>
                      <td>${(d.total || 0).toLocaleString()}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="admin-header-row" style={{ marginTop: "1.25rem" }}>
            <h2 className="admin-section-title" style={{ margin: 0 }}>
              Promotions
            </h2>
          </div>

          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Uses</th>
                  <th>Discount %</th>
                  <th>Discount $</th>
                  <th>Active</th>
                </tr>
              </thead>
              <tbody>
                {summary.promos.length === 0 ? (
                  <tr>
                    <td colSpan={5}>
                      <div className="admin-empty">No promotions have been used yet</div>
                    </td>
                  </tr>
                ) : (
                  summary.promos.slice(0, 20).map((p) => (
                    <tr key={p.code}>
                      <td>{p.code}</td>
                      <td>{p.uses}</td>
                      <td>{p.discount_percent}</td>
                      <td>${(p.discount_amount || 0).toLocaleString()}</td>
                      <td>{p.active ? "Yes" : "No"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="admin-header-row" style={{ marginTop: "1.25rem" }}>
            <h2 className="admin-section-title" style={{ margin: 0 }}>
              Customer status
            </h2>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Customers</th>
                </tr>
              </thead>
              <tbody>
                {summary.customers.map((c, idx) => (
                  <tr key={`${c.status}-${idx}`}>
                    <td>{c.status}</td>
                    <td>{c.count}</td>
                  </tr>
                ))}
                {summary.customers.length === 0 ? (
                  <tr>
                    <td colSpan={2}>
                      <div className="admin-empty">Nothing to report until a customer trades in</div>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </>
  );
}

