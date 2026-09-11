import { useCallback, useEffect, useState } from "react";
import { HowThisWorks } from "../HowThisWorks";
import { useSearchParams } from "react-router-dom";
import { adminFetch } from "../api";

interface Customer {
  id: string;
  first_name: string;
  last_name: string;
  email?: string;
  phone?: string;
  status?: string;
  created_at?: string;
}

export function CustomersPage() {
  const [params] = useSearchParams();
  const [rows, setRows] = useState<Customer[]>([]);
  const [q, setQ] = useState(params.get("q") || "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const next = params.get("q");
    if (next != null) setQ(next);
  }, [params]);

  const load = useCallback(() => {
    const params = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
    adminFetch<Customer[]>(`/api/customers${params}`)
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, [q]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <div className="admin-header-row">
        <h1 className="admin-page-title" style={{ margin: 0 }}>
          Customers
        </h1>
        <button type="button" className="admin-btn admin-btn--ghost" onClick={load}>
          Refresh
        </button>
      </div>
      <p className="admin-section-lead">Search and manage customers who submitted trade-in offers.</p>
      <HowThisWorks
        steps={[
        "Everyone who has completed a trade-in with you, added automatically.",
        "Open a customer to see every offer they have made and what you paid.",
        "Use it before agreeing a price with someone who has traded with you before.",
      ]}
      />

      <div className="admin-toolbar">
        <input
          className="admin-input grow"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name or email…"
        />
        <button type="button" className="admin-btn" onClick={load}>
          Search
        </button>
      </div>

      {error ? <p className="admin-error">{error}</p> : null}

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4}>
                  <div className="admin-empty">No customers yet. The first trade-in adds one</div>
                </td>
              </tr>
            ) : (
              rows.map((c) => (
                <tr key={c.id}>
                  <td>
                    {c.first_name} {c.last_name}
                  </td>
                  <td>{c.email ?? "—"}</td>
                  <td>{c.phone ?? "—"}</td>
                  <td>
                    <span className="admin-status-pill is-active">{c.status ?? "active"}</span>
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
