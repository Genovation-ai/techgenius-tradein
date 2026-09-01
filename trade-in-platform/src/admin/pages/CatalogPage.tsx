import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { adminFetch, apiUrl, type CatalogDevice } from "../api";
import { DeviceThumb } from "../DeviceThumb";

const PAGE_SIZE = 48;
// The store's published sell/trade-in conditions. Internal keys are unchanged
// so these still line up with the scraped competitor tiers.
const GRADE_COLS = [
  { key: "flawless", label: "Like New" },
  { key: "good", label: "Good" },
  { key: "average", label: "Acceptable" },
  { key: "fair", label: "Unacceptable" },
  { key: "defective", label: "As-Is" },
] as const;

export function CatalogPage() {
  const [params] = useSearchParams();
  const [category, setCategory] = useState("");
  const [devices, setDevices] = useState<CatalogDevice[]>([]);
  const [q, setQ] = useState(params.get("q") || "");
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<CatalogDevice | null>(null);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [addMsg, setAddMsg] = useState<string | null>(null);
  const [addErr, setAddErr] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const next = params.get("q");
    if (next != null) setQ(next);
  }, [params]);

  useEffect(() => {
    setLoading(true);
    setVisible(PAGE_SIZE);
    const params = new URLSearchParams({
      include_prices: "true",
      limit: "2000",
      // Staff need to see devices the customer catalog hides for having no
      // price yet — that list is the to-do list for pricing them.
      include_unquotable: "1",
    });
    if (category) params.set("category_id", category);
    if (q.trim()) params.set("q", q.trim());
    // apiUrl, not a bare relative path: the dev server proxies /api, but a
    // deployed admin sits on a different origin from the API and would 404.
    fetch(apiUrl(`/api/catalog/devices?${params}`))
      .then((r) => r.json())
      .then((rows: CatalogDevice[]) => {
        const list = Array.isArray(rows) ? rows : [];
        setDevices(list);
        setSelected((prev) => (prev ? list.find((d) => d.id === prev.id) || null : null));
      })
      .finally(() => setLoading(false));
  }, [category, q, reloadToken]);

  const withImages = useMemo(() => devices.filter((d) => d.enabled !== 0), [devices]);
  const shown = withImages.slice(0, visible);

  const matrixStorages = useMemo(() => {
    if (!selected?.price_matrix) return selected?.storages || [];
    const keys = Object.keys(selected.price_matrix);
    return keys.length ? keys : selected.storages || [];
  }, [selected]);

  const addByName = async () => {
    const name = newName.trim();
    if (!name) return;
    setAdding(true);
    setAddMsg(null);
    setAddErr(null);
    try {
      const boot = await adminFetch<{
        created: boolean;
        device: CatalogDevice;
        image?: { method?: string } | null;
        pricesSeeded: number;
      }>("/api/catalog/devices/from-name", {
        method: "POST",
        body: JSON.stringify({
          name,
          category_id: category || undefined,
          rebuild_image: true,
        }),
      });
      setAddMsg(
        `${boot.created ? "Created" : "Updated"} ${boot.device.name} · image ${boot.image?.method || "ready"} · ${boot.pricesSeeded} prices`,
      );
      setNewName("");
      setQ(boot.device.name);
      setReloadToken((n) => n + 1);
    } catch (e) {
      setAddErr(e instanceof Error ? e.message : "Add failed");
    } finally {
      setAdding(false);
    }
  };

  return (
    <>
      <div className="admin-header-row">
        <h1 className="admin-page-title" style={{ margin: 0 }}>
          Catalog
        </h1>
        <span style={{ color: "#6b7280" }}>{withImages.length} devices</span>
      </div>
      <p className="admin-section-lead">
        Every device shows exact buyback prices by storage and condition. New phone releases can be
        added by name — the platform builds the product image and seeds starter prices.
      </p>

      <div className="admin-toolbar">
        <select className="admin-select" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          <option value="smartphone">Smartphones</option>
          <option value="tablet">Tablets</option>
          <option value="smartwatch">Smartwatches</option>
          <option value="laptop">Laptops</option>
          <option value="computer">Desktop / iMac</option>
          <option value="gaming-console">Gaming Consoles</option>
          <option value="vr">VR / Wearables</option>
          <option value="monitor">Monitors</option>
        </select>
        <input
          className="admin-input grow"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search devices…"
        />
      </div>

      <div className="admin-toolbar" style={{ marginTop: "0.5rem" }}>
        <input
          className="admin-input grow"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Add by name… e.g. iPhone 17 Pro Max"
          onKeyDown={(e) => {
            if (e.key === "Enter") void addByName();
          }}
        />
        <button type="button" className="admin-btn" disabled={adding || !newName.trim()} onClick={() => void addByName()}>
          {adding ? "Building…" : "Build image & add"}
        </button>
      </div>
      {addMsg ? <p className="admin-ok">{addMsg}</p> : null}
      {addErr ? <p className="admin-error">{addErr}</p> : null}

      {loading ? <p>Loading…</p> : null}

      <div className="admin-device-grid">
        {shown.map((d) => (
          <button
            key={d.id}
            type="button"
            className={`admin-device-card${selected?.id === d.id ? " selected" : ""}`}
            onClick={() => setSelected(d)}
          >
            <DeviceThumb imageUrl={d.image_url} deviceId={d.id} name={d.name} />
            <strong>{d.name}</strong>
            {/* An unpriced device is hidden from the customer catalog, so
                "Get quote" read as normal when it actually meant invisible.
                Staff need to see which rows need a price. */}
            <span className={d.max_price_flawless && d.max_price_flawless > 0 ? "" : "admin-needs-price"}>
              {d.max_price_flawless && d.max_price_flawless > 0
                ? `Up to $${d.max_price_flawless.toLocaleString()}`
                : "Needs pricing · hidden"}
            </span>
          </button>
        ))}
      </div>

      {!loading && visible < withImages.length ? (
        <div style={{ display: "flex", justifyContent: "center", marginTop: "1rem" }}>
          <button
            type="button"
            className="admin-btn admin-btn--ghost"
            onClick={() => setVisible((v) => v + PAGE_SIZE)}
          >
            Load more ({withImages.length - visible} remaining)
          </button>
        </div>
      ) : null}

      {withImages.length === 0 && !loading ? <div className="admin-empty">Nothing To Show</div> : null}

      {selected ? (
        <div className="admin-panel" style={{ marginTop: "1rem" }}>
          <div className="admin-offer-device">
            <DeviceThumb imageUrl={selected.image_url} deviceId={selected.id} name={selected.name} />
            <div>
              <strong>{selected.name}</strong>
              <div style={{ fontSize: "0.82rem", color: "#6b7280" }}>
                ID: {selected.id}
                <br />
                Storages: {(selected.storages || []).join(", ") || "—"}
              </div>
            </div>
            <strong>{selected.max_price_flawless ? `$${selected.max_price_flawless}` : "—"}</strong>
          </div>

          {matrixStorages.length > 0 ? (
            <div style={{ overflowX: "auto", marginTop: "1rem" }}>
              <table className="admin-table" style={{ width: "100%", fontSize: "0.85rem" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>Storage</th>
                    {GRADE_COLS.map((g) => (
                      <th key={g.key}>{g.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrixStorages.map((storage) => (
                    <tr key={storage}>
                      <td>
                        <strong>{storage}</strong>
                      </td>
                      {GRADE_COLS.map((g) => {
                        const price = selected.price_matrix?.[storage]?.[g.key];
                        return (
                          <td key={g.key}>
                            {price && price > 0 ? `$${price.toLocaleString()}` : "—"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p style={{ color: "#6b7280", marginTop: "0.75rem" }}>No per-storage prices yet — run catalog sync.</p>
          )}
        </div>
      ) : null}
    </>
  );
}
