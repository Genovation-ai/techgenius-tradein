import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { adminFetch, apiUrl, getAdminApiKey, onStoreChange, withStoreScope } from "../api";

interface InvoiceRow {
  id: string;
  offer_id: string;
  amount: number;
  status: string;
  issued_at?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
}

export function InvoicesPage() {
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [offerId, setOfferId] = useState("");

  const load = useCallback(() => {
    const params = withStoreScope(new URLSearchParams());
    const suffix = params.toString() ? `?${params}` : "";
    adminFetch<InvoiceRow[]>(`/api/invoices${suffix}`)
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => onStoreChange(load), [load]);

  const createFromOffer = async () => {
    if (!offerId.trim()) return;
    try {
      await adminFetch(`/api/invoices/from-offer/${encodeURIComponent(offerId.trim())}`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setOfferId("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    }
  };

  const markPaid = async (id: string) => {
    await adminFetch(`/api/invoices/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "paid" }),
    });
    load();
  };

  // Printing goes through openPrint: the endpoint authenticates on the
  // x-api-key header, so there is no URL a plain window.open could use.
  const openPrint = async (id: string) => {
    const key = getAdminApiKey();
    const res = await fetch(apiUrl(`/api/invoices/${encodeURIComponent(id)}/print`), {
      headers: { "x-api-key": key },
    });
    const html = await res.text();
    const w = window.open("", "_blank");
    if (w) {
      w.document.write(html);
      w.document.close();
    }
  };

  return (
    <>
      <h1 className="admin-page-title">Invoices</h1>
      <p className="admin-section-lead">
        Invoices are auto-issued when an offer is completed. You can also generate one manually.
      </p>
      {error ? <p className="admin-error">{error}</p> : null}

      <div className="admin-toolbar">
        <input
          className="admin-input grow"
          value={offerId}
          onChange={(e) => setOfferId(e.target.value)}
          placeholder="Offer ID to invoice…"
        />
        <button type="button" className="admin-btn" onClick={() => void createFromOffer()}>
          Issue invoice
        </button>
        <button type="button" className="admin-btn admin-btn--ghost" onClick={load}>
          Refresh
        </button>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Offer</th>
              <th>Customer</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6}>
                  <div className="admin-empty">No invoices yet. One is created when an offer completes</div>
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td>
                    <Link to={`/admin/offers/${encodeURIComponent(r.offer_id)}`}>{r.offer_id}</Link>
                  </td>
                  <td>
                    {r.first_name} {r.last_name}
                  </td>
                  <td>${Number(r.amount || 0).toLocaleString()}</td>
                  <td>
                    <span className={`admin-status-pill ${r.status === "paid" ? "is-active" : "is-muted"}`}>
                      {r.status}
                    </span>
                  </td>
                  <td>
                    <div className="admin-inline-actions">
                      <button type="button" className="admin-btn admin-btn--sm" onClick={() => void openPrint(r.id)}>
                        Print
                      </button>
                      {r.status !== "paid" ? (
                        <button
                          type="button"
                          className="admin-btn admin-btn--sm admin-btn--ghost"
                          onClick={() => void markPaid(r.id)}
                        >
                          Mark paid
                        </button>
                      ) : null}
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
