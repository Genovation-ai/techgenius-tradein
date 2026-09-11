import { useCallback, useEffect, useMemo, useState } from "react";
import { HowThisWorks } from "../HowThisWorks";
import { adminFetch } from "../api";

interface Adjustment {
  id: number;
  scope: string;
  adjust_percent: number;
  adjust_amount: number;
  condition_grade?: string | null;
}

interface CompetitorSource {
  id: string;
  label: string;
  notes: string;
}

interface CompetitorRow {
  competitor_name: string;
  product_id: string | null;
  make: string;
  model: string;
  variant: string;
  condition: string;
  trade_in_price: number | null;
  sell_price: number | null;
  currency: string;
  source_url: string | null;
  scraped_at: string;
  engine: string | null;
}

interface FrontendConfig {
  source: string;
  mode: "match" | "beat";
  beatPercent: number;
}

interface CompetitorsPayload {
  sources: CompetitorSource[];
  frontend: FrontendConfig;
  rows: CompetitorRow[];
}

interface MatrixPayload {
  product_id: string;
  variant: string;
  matrix: Record<string, Partial<Record<string, number>>>;
  frontend: FrontendConfig;
  preview: {
    basePrice: number;
    source: string;
    mode: string;
    competitorPrice: number | null;
    scaled: boolean;
  };
}

const SOURCE_OPTIONS: Array<{ id: string; label: string }> = [
  { id: "manual", label: "Manual / Tech Genius table" },
  { id: "univercell", label: "UniverCell" },
  { id: "bell", label: "Bell" },
  { id: "telus", label: "TELUS" },
  { id: "gorecell", label: "GoRecell" },
  { id: "best", label: "Best of all competitors" },
];

const CONDITIONS = ["excellent", "good", "fair", "broken"] as const;

// The table printed the raw grade ids as headers, so two capitalised columns
// sat beside four lowercase ones.
const CONDITION_LABELS: Record<(typeof CONDITIONS)[number], string> = {
  excellent: "Excellent",
  good: "Good",
  fair: "Fair",
  broken: "Broken",
};

export function PricingPage() {
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [competitors, setCompetitors] = useState<CompetitorsPayload | null>(null);
  const [matrix, setMatrix] = useState<MatrixPayload | null>(null);
  const [percent, setPercent] = useState("0");
  const [amount, setAmount] = useState("0");
  const [source, setSource] = useState("manual");
  const [mode, setMode] = useState<"match" | "beat">("match");
  const [beatPercent, setBeatPercent] = useState("2");
  const [deviceFilter, setDeviceFilter] = useState("iphone-15");
  const [variant, setVariant] = useState("128GB");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadAdjustments = useCallback(() => {
    adminFetch<Adjustment[]>("/api/pricing/adjustments")
      .then(setAdjustments)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load adjustments"));
  }, []);

  const loadCompetitors = useCallback(async () => {
    try {
      const data = await adminFetch<CompetitorsPayload>(
        `/api/pricing/competitors?q=${encodeURIComponent(deviceFilter || "")}`,
      );
      setCompetitors(data);
      setSource(data.frontend.source);
      setMode(data.frontend.mode);
      setBeatPercent(String(data.frontend.beatPercent));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load competitor prices");
    }
  }, [deviceFilter]);

  const loadMatrix = useCallback(async () => {
    if (!deviceFilter.trim()) {
      setMatrix(null);
      return;
    }
    try {
      const data = await adminFetch<MatrixPayload>(
        `/api/pricing/competitors/matrix?product_id=${encodeURIComponent(deviceFilter.trim())}&variant=${encodeURIComponent(variant)}&condition=flawless`,
      );
      setMatrix(data);
    } catch {
      setMatrix(null);
    }
  }, [deviceFilter, variant]);

  useEffect(() => {
    loadAdjustments();
  }, [loadAdjustments]);

  useEffect(() => {
    void loadCompetitors();
    void loadMatrix();
  }, [loadCompetitors, loadMatrix]);

  const addAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setError(null);
    try {
      await adminFetch("/api/pricing/adjustments", {
        method: "POST",
        body: JSON.stringify({
          scope: "global",
          adjust_percent: parseFloat(percent) || 0,
          adjust_amount: parseFloat(amount) || 0,
        }),
      });
      setMessage("Adjustment saved");
      setPercent("0");
      setAmount("0");
      loadAdjustments();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    }
  };

  const saveFrontendSource = async () => {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const res = await adminFetch<FrontendConfig & { ok: boolean }>("/api/pricing/frontend-source", {
        method: "PUT",
        body: JSON.stringify({
          source,
          mode,
          beat_percent: parseFloat(beatPercent) || 0,
        }),
      });
      setMessage(
        `Frontend will now reflect: ${res.source} (${res.mode}${res.mode === "beat" ? ` −${res.beatPercent}%` : ""})`,
      );
      await loadCompetitors();
      await loadMatrix();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save source");
    } finally {
      setBusy(false);
    }
  };

  const applySourceToCatalog = async (competitor: string) => {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const res = await adminFetch<{ ok: boolean; upserted: number; frontend: FrontendConfig }>(
        "/api/pricing/apply-source",
        { method: "POST", body: JSON.stringify({ competitor }) },
      );
      setSource(competitor);
      setMessage(
        `Applied ${competitor} → catalog prices (${res.upserted} rows). Frontend source set to ${competitor}.`,
      );
      await loadCompetitors();
      await loadMatrix();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Apply failed");
    } finally {
      setBusy(false);
    }
  };

  const runLiveScraper = async () => {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const res = await adminFetch<{
        message?: string;
        rowsPersisted?: number;
        errors?: string[];
      }>("/api/scraper/run-live", {
        method: "POST",
        body: JSON.stringify({}),
      });
      setMessage(
        res.message ??
          `Live scrape done (${res.rowsPersisted ?? 0} rows)${res.errors?.length ? ` · ${res.errors.length} warnings` : ""}`,
      );
      await loadCompetitors();
      await loadMatrix();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Live scrape failed");
    } finally {
      setBusy(false);
    }
  };

  const runCatalogSync = async () => {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const res = await adminFetch<{
        message?: string;
        devicesOk?: number;
        devicesAttempted?: number;
        scrapedRows?: number;
        errors?: string[];
      }>("/api/scraper/sync-catalog", {
        method: "POST",
        body: JSON.stringify({ applyBeat: true, beatPercent: parseFloat(beatPercent) || 2 }),
      });
      setMessage(
        res.message ??
          `Catalog sync: ${res.devicesOk ?? 0}/${res.devicesAttempted ?? 0} devices, ${res.scrapedRows ?? 0} rows`,
      );
      if (res.errors?.length) {
        setError(`${res.errors.length} device warnings (see server log)`);
      }
      await loadCompetitors();
      await loadMatrix();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Catalog sync failed");
    } finally {
      setBusy(false);
    }
  };

  const filteredRows = useMemo(() => {
    const rows = competitors?.rows ?? [];
    if (!deviceFilter.trim()) return rows;
    const q = deviceFilter.toLowerCase();
    return rows.filter(
      (r) =>
        (r.product_id || "").toLowerCase().includes(q) ||
        r.model.toLowerCase().includes(q) ||
        r.make.toLowerCase().includes(q),
    );
  }, [competitors, deviceFilter]);

  const sourceLabels = useMemo(() => {
    const map: Record<string, string> = Object.fromEntries(
      (competitors?.sources ?? []).map((s) => [s.id, s.label]),
    );
    map.manual = "Manual";
    map.best = "Best of all";
    return map;
  }, [competitors]);

  return (
    <>
      <div className="admin-header-row">
        <h1 className="admin-page-title" style={{ margin: 0 }}>
          Pricing
        </h1>
        <div className="admin-header-actions">
          <button
            type="button"
            className="admin-btn admin-btn--ghost"
            disabled={busy}
            onClick={() => void runCatalogSync()}
            title="Read today's competitor prices for every storage size"
          >
            {busy ? "Working…" : "Sync full catalog prices"}
          </button>
          <button
            type="button"
            className="admin-btn admin-btn--orange"
            disabled={busy}
            onClick={() => void runLiveScraper()}
          >
            {busy ? "Checking…" : "Check competitor prices"}
          </button>
        </div>
      </div>
      <p className="admin-section-lead">
        Choose whose prices your quotes follow, and by how much you beat them.
      </p>
      <HowThisWorks
        steps={[
        "Choose whose prices you follow — GoRecell, a carrier, or your own manual list.",
        "Pick a mode: match them, or beat them by a percentage so your quote is the better one.",
        "Use Adjust every quote for a promotion or to protect margin without re-pricing the catalogue.",
        "Check the preview before saving — it shows a real device at the price a customer would be quoted.",
      ]}
      />
      {message ? <p className="admin-ok">{message}</p> : null}
      {error ? <p className="admin-error">{error}</p> : null}

      <section className="admin-pricing-grid">
        <form className="admin-pricing-form" onSubmit={(e) => void addAdjustment(e)}>
          <h2>Adjust every quote</h2>
          <p style={{ margin: 0, fontSize: "0.85rem", color: "#6b7280" }}>
            Applied after the rule above, to every device. Use it to run a promotion
            or to protect margin without re-pricing the catalogue.
          </p>
          <label>
            Percent (%)
            <input value={percent} onChange={(e) => setPercent(e.target.value)} type="number" step="0.1" />
          </label>
          <label>
            Amount (CAD)
            <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" step="1" />
          </label>
          <button type="submit" className="admin-btn">
            Save adjustment
          </button>
        </form>

        <div className="admin-pricing-form">
          <h2>What customers are quoted</h2>
          <p style={{ margin: 0, fontSize: "0.85rem", color: "#6b7280" }}>
            Every quote on your sell page is worked out from this. Changes take effect
            on the next quote — nothing already offered to a customer moves.
          </p>
          <label>
            Follow these prices
            <select value={source} onChange={(e) => setSource(e.target.value)}>
              {SOURCE_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Mode
            <select value={mode} onChange={(e) => setMode(e.target.value as "match" | "beat")}>
              <option value="match">Match competitor price</option>
              <option value="beat">Beat competitor (undercut %)</option>
            </select>
          </label>
          {mode === "beat" ? (
            <label>
              Undercut percent
              <input
                value={beatPercent}
                onChange={(e) => setBeatPercent(e.target.value)}
                type="number"
                min={0}
                max={25}
                step="0.5"
              />
            </label>
          ) : null}
          <button type="button" className="admin-btn" disabled={busy} onClick={() => void saveFrontendSource()}>
            Save quoting rule
          </button>
          {matrix?.preview ? (
            <div className="admin-price-preview">
              <strong>Preview ({deviceFilter} · {variant} · flawless)</strong>
              <span>
                ${matrix.preview.basePrice.toLocaleString()} CAD via {sourceLabels[matrix.preview.source] || matrix.preview.source}
                {matrix.preview.scaled ? " (scaled from excellent)" : ""}
              </span>
            </div>
          ) : null}
        </div>
      </section>

      <h2 className="admin-section-title">Competitor comparison</h2>
      <div className="admin-pricing-filters">
        <label>
          Device
          <input
            value={deviceFilter}
            onChange={(e) => setDeviceFilter(e.target.value)}
            placeholder="iphone-15"
          />
        </label>
        <label>
          Storage
          <select value={variant} onChange={(e) => setVariant(e.target.value)}>
            {["128GB", "256GB", "512GB", "1TB"].map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>

      {matrix ? (
        <div className="admin-table-wrap" style={{ marginBottom: "1.25rem" }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Source</th>
                {CONDITIONS.map((c) => (
                  <th key={c}>{CONDITION_LABELS[c]}</th>
                ))}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {SOURCE_OPTIONS.filter((s) => s.id !== "manual" && s.id !== "best").map((s) => {
                const row = matrix.matrix[s.id] || {};
                const active = competitors?.frontend.source === s.id;
                return (
                  <tr key={s.id} className={active ? "admin-row-active" : undefined}>
                    <td>
                      <strong>{s.label}</strong>
                      {active ? <span className="admin-badge admin-badge--green"> Live</span> : null}
                    </td>
                    {CONDITIONS.map((c) => (
                      <td key={c}>{row[c] != null ? `$${row[c]}` : "—"}</td>
                    ))}
                    <td>
                      <div className="admin-inline-actions">
                        <button
                          type="button"
                          className="admin-btn admin-btn--sm"
                          disabled={busy}
                          onClick={() => {
                            setSource(s.id);
                            void (async () => {
                              setSource(s.id);
                              setBusy(true);
                              try {
                                await adminFetch("/api/pricing/frontend-source", {
                                  method: "PUT",
                                  body: JSON.stringify({ source: s.id, mode, beat_percent: parseFloat(beatPercent) || 0 }),
                                });
                                setMessage(`Frontend now reflects ${s.label}`);
                                await loadCompetitors();
                                await loadMatrix();
                              } catch (err) {
                                setError(err instanceof Error ? err.message : "Failed");
                              } finally {
                                setBusy(false);
                              }
                            })();
                          }}
                        >
                          Quote from this
                        </button>
                        <button
                          type="button"
                          className="admin-btn admin-btn--sm admin-btn--ghost"
                          disabled={busy}
                          onClick={() => void applySourceToCatalog(s.id)}
                        >
                          Apply to catalog
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="admin-section-lead">Run a live scrape to populate competitor prices for this device.</p>
      )}

      <h2 className="admin-section-title">Latest scraped price detail</h2>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Source</th>
              <th>Device</th>
              <th>Storage</th>
              <th>Condition</th>
              <th>Trade-in</th>
              <th>Scraped</th>
              <th>Engine</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <div className="admin-empty">No competitor prices yet — choose Check competitor prices above</div>
                </td>
              </tr>
            ) : (
              filteredRows.map((r, i) => (
                <tr key={`${r.competitor_name}-${r.product_id}-${r.variant}-${r.condition}-${i}`}>
                  <td>{sourceLabels[r.competitor_name] || r.competitor_name}</td>
                  <td>
                    {r.make} {r.model}
                    {r.product_id ? <div className="admin-muted">{r.product_id}</div> : null}
                  </td>
                  <td>{r.variant}</td>
                  <td>{r.condition}</td>
                  <td>
                    {r.trade_in_price != null ? `$${r.trade_in_price}` : r.sell_price != null ? `$${r.sell_price}` : "—"}
                  </td>
                  <td>{r.scraped_at ? new Date(r.scraped_at).toLocaleString() : "—"}</td>
                  <td>{r.engine || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <h2 className="admin-section-title">Active adjustments</h2>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Scope</th>
              <th>Percent</th>
              <th>Amount</th>
              <th>Grade</th>
            </tr>
          </thead>
          <tbody>
            {adjustments.length === 0 ? (
              <tr>
                <td colSpan={4}>
                  <div className="admin-empty">No adjustments yet — every quote uses the rule above</div>
                </td>
              </tr>
            ) : (
              adjustments.map((a) => (
                <tr key={a.id}>
                  <td>{a.scope}</td>
                  <td>{a.adjust_percent}%</td>
                  <td>${a.adjust_amount}</td>
                  <td>{a.condition_grade ?? "all"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
