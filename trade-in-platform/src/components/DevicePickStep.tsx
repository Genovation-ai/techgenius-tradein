import { useDeferredValue, useMemo, useState } from "react";
import {
  categories,
  type Brand,
  type DeviceCategory,
  type DeviceModel,
} from "../data/catalog";
import { brandImages, deviceImage } from "../data/deviceImages";
import { assetUrl, deviceImageUrl, ensureDeviceFromName, mapApiDevice } from "../lib/tradeInApi";
import "./ChoiceGrid.css";
import "./FormSteps.css";

interface Props {
  category: DeviceCategory;
  brandFilter: Brand | "All";
  query: string;
  devices: DeviceModel[];
  brands: Brand[];
  loading?: boolean;
  error?: string | null;
  apiOnline?: boolean | null;
  onBrandFilter: (b: Brand | "All") => void;
  onQuery: (q: string) => void;
  onSelect: (device: DeviceModel) => void;
}

/** After category: search OR browse image devices — mirrors GoRecell/UniverCell */
export function DevicePickStep({
  category,
  brandFilter,
  query,
  devices,
  brands,
  loading,
  error,
  apiOnline,
  onBrandFilter,
  onQuery,
  onSelect,
}: Props) {
  const deferredQuery = useDeferredValue(query);
  const catLabel = categories.find((c) => c.id === category)?.label ?? "devices";

  const list = useMemo(() => {
    if (apiOnline !== false) return devices;
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return devices;
    return devices.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        d.brand.toLowerCase().includes(q) ||
        d.id.toLowerCase().includes(q),
    );
  }, [devices, deferredQuery, apiOnline]);

  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const resolveImage = (device: DeviceModel & { imageUrl?: string | null }) => {
    const remote = deviceImageUrl(device);
    if (remote && !failed[device.id]) return remote;
    return assetUrl(deviceImage(device.id, device));
  };

  const canBootstrap =
    apiOnline !== false &&
    !loading &&
    list.length === 0 &&
    query.trim().length >= 5 &&
    (/\d/.test(query) || /iphone|galaxy|pixel|ipad|macbook|watch|oneplus|moto/i.test(query));

  const addMissingDevice = async () => {
    setAdding(true);
    setAddError(null);
    try {
      const result = await ensureDeviceFromName({
        name: query.trim(),
        categoryId: category,
      });
      const mapped = mapApiDevice(result.device, []);
      onSelect(mapped);
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "Could not add this device");
    } finally {
      setAdding(false);
    }
  };

  return (
    <section className="flow-panel">
      <header className="flow-header">
        <p className="flow-kicker">Your model</p>
        <h1>Search or select your {catLabel.toLowerCase()}</h1>
        <p className="flow-lead">
          Type a model name or tap a device photo — powered by Tech Genius catalog
          {apiOnline === false ? " (offline fallback)" : ""}.
        </p>
      </header>

      <label className="field">
        <span>Search your model here…</span>
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={`Search ${catLabel.toLowerCase()}… e.g. iPhone 15 Pro`}
          autoComplete="off"
          autoFocus
        />
      </label>

      <div className="brand-chip-row" role="tablist" aria-label="Filter by brand">
        <button
          type="button"
          role="tab"
          aria-selected={brandFilter === "All"}
          className={`chip ${brandFilter === "All" ? "chip--on" : ""}`}
          onClick={() => onBrandFilter("All")}
        >
          All brands
        </button>
        {brands.map((b) => (
          <button
            key={b}
            type="button"
            role="tab"
            aria-selected={brandFilter === b}
            className={`chip chip-brand ${brandFilter === b ? "chip--on" : ""}`}
            onClick={() => onBrandFilter(b)}
          >
            {/* Brands without a bundled thumbnail (LG, TCL, Nothing…) render
                the name alone rather than an empty image box. */}
            {brandImages[b] ? <img src={assetUrl(brandImages[b])} alt="" width={22} height={26} /> : null}
            {b}
          </button>
        ))}
      </div>

      {loading ? <p className="field-hint">Loading devices…</p> : null}
      {error ? <p className="form-error">{error}</p> : null}

      {!loading && list.length === 0 ? (
        <div className="device-miss">
          <p className="form-error" style={{ marginBottom: "0.75rem" }}>
            No models match “{query.trim() || "…"}”.
            {canBootstrap
              ? " New releases can be added by name — we’ll build the product image and catalog entry."
              : " Clear search or try another brand — or type a full model name like iPhone 17 Pro."}
          </p>
          {canBootstrap ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={adding}
              onClick={() => void addMissingDevice()}
            >
              {adding ? "Building image & adding…" : `Add “${query.trim()}” to catalog`}
            </button>
          ) : null}
          {addError ? <p className="form-error">{addError}</p> : null}
        </div>
      ) : (
        <div className="device-grid">
          {list.map((device) => (
            <button
              key={device.id}
              type="button"
              className="device-card"
              onClick={() => onSelect(device)}
            >
              <span className="device-card-media">
                {(() => {
                  const src = failed[device.id]
                    ? ""
                    : resolveImage(device as DeviceModel & { imageUrl?: string | null });
                  // No photo of THIS model: show the initial rather than a
                  // stand-in handset the shopper might mistake for theirs.
                  return src ? (
                    <img
                      src={src}
                      alt=""
                      width={160}
                      height={192}
                      loading="lazy"
                      decoding="async"
                      onError={() => setFailed((f) => ({ ...f, [device.id]: true }))}
                    />
                  ) : (
                    <span className="device-card-fallback">{device.name.slice(0, 1)}</span>
                  );
                })()}
              </span>
              <span className="device-card-name">{device.name}</span>
              <span className="device-card-price">
                {device.basePrice > 0
                  ? `Up to $${device.basePrice.toLocaleString()} CAD`
                  : "Get instant quote"}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
