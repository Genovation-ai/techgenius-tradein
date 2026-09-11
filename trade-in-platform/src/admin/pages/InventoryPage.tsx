import { useCallback, useEffect, useMemo, useState } from "react";
import { adminFetch, onStoreChange, withStoreScope } from "../api";

interface InventoryRow {
  id: string;
  offer_item_id?: number | null;
  device_name: string;
  imei?: string | null;
  condition_grade?: string | null;
  cost?: number;
  sell_price?: number | null;
  status: string;
  created_at?: string;
}

type StatusFilter = "all" | "available" | "listed" | "sold";

export function InventoryPage() {
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sellPrice, setSellPrice] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    const params = withStoreScope(new URLSearchParams());
    if (status !== "all") params.set("status", status);
    if (q.trim()) params.set("q", q.trim());
    const suffix = params.toString() ? `?${params}` : "";
    adminFetch<InventoryRow[]>(`/api/inventory${suffix}`)
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [status, q]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => onStoreChange(load), [load]);

  const filtered = useMemo(() => rows, [rows]);

  const updateStatus = async (id: string, next: string) => {
    await adminFetch(`/api/inventory/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ status: next }),
    });
    load();
  };

  const sellNow = async (row: InventoryRow) => {
    const price = Number(sellPrice[row.id] || row.sell_price || Math.round((row.cost || 0) * 1.25));
    try {
      await adminFetch(`/api/inventory/${encodeURIComponent(row.id)}/sell`, {
        method: "POST",
        body: JSON.stringify({ sell_price: price, note: "Sell instantly" }),
      });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sell failed");
    }
  };

  return (
    <>
      <div className="admin-header-row">
        <h1 className="admin-page-title" style={{ margin: 0 }}>
          Inventory
        </h1>
        <div style={{ display: "flex", gap: "0.7rem", alignItems: "center" }}>
          <select className="admin-select" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
            <option value="all">All</option>
            <option value="available">Available</option>
            <option value="listed">Listed</option>
            <option value="sold">Sold</option>
          </select>
        </div>
      </div>

      <p className="admin-section-lead">
        Inventory from completed offers. Use Sell Instantly to close a unit with a real sale record.
      </p>

      <div className="admin-toolbar">
        <input
          className="admin-input grow"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search device name / IMEI / grade"
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
              <th>Device</th>
              <th>IMEI</th>
              <th>Grade</th>
              <th>Cost</th>
              <th>Sell price</th>
              <th>Status</th>
              <th>Sell instantly</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <div className="admin-empty">No stock yet. Devices land here once an offer completes</div>
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.id}>
                  <td>{r.device_name}</td>
                  <td>{r.imei ?? "—"}</td>
                  <td>{r.condition_grade ?? "—"}</td>
                  <td>{typeof r.cost === "number" ? `$${r.cost.toLocaleString()}` : "—"}</td>
                  <td>
                    {r.status === "sold" ? (
                      typeof r.sell_price === "number" ? `$${r.sell_price.toLocaleString()}` : "—"
                    ) : (
                      <input
                        className="admin-input"
                        style={{ width: 96 }}
                        value={sellPrice[r.id] ?? (r.sell_price != null ? String(r.sell_price) : "")}
                        onChange={(e) => setSellPrice((m) => ({ ...m, [r.id]: e.target.value }))}
                        placeholder="CAD"
                      />
                    )}
                  </td>
                  <td>
                    <select
                      className="admin-select"
                      value={r.status}
                      onChange={(e) => void updateStatus(r.id, e.target.value)}
                      disabled={r.status === "sold"}
                    >
                      <option value="available">Available</option>
                      <option value="listed">Listed</option>
                      <option value="sold">Sold</option>
                    </select>
                  </td>
                  <td>
                    {r.status !== "sold" ? (
                      <button type="button" className="admin-btn admin-btn--sm" onClick={() => void sellNow(r)}>
                        Sell
                      </button>
                    ) : (
                      "—"
                    )}
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
