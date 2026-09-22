import { useCallback, useEffect, useMemo, useState } from "react";
import { adminFetch } from "../api";
import { HowThisWorks } from "../HowThisWorks";

/**
 * Repairs, in the same workspace as trade-ins.
 *
 * A repair is priced from a part, not from what other buyers pay, so it gets
 * its own list, its own stages and its own price table — but the same sidebar,
 * the same customers, and the same habit of moving a job along with one
 * control per row. The pricing knobs are on this page rather than buried in
 * Pricing because the person setting a part cost is the person on the bench,
 * and they should not have to go looking.
 */

type Stage = { id: string; label: string };
type Problem = { id: string; label: string; enabled?: boolean };
type Repair = {
  id: string;
  device_name: string;
  problem_label: string;
  quoted_price: number | null;
  price_source: string;
  fulfilment: string;
  status: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  created_at: string;
};
type Part = {
  device_id: string;
  device_name: string | null;
  problem: string;
  part_cost: number | null;
  override_price: number | null;
};
type Market = {
  device_id: string;
  device_name: string | null;
  problem: string;
  product_title: string;
  price: number;
  currency: string;
  price_cad: number;
  fx_rate: number;
  source_url: string;
  scraped_at: string;
};

const STAGE_TONE: Record<string, string> = {
  booked: "neutral",
  received: "transit",
  diagnosing: "working",
  awaiting_parts: "blocked",
  in_progress: "working",
  ready: "money",
  completed: "done",
  cancelled: "neutral",
};

export function RepairsPage() {
  const [tab, setTab] = useState<"jobs" | "pricing" | "customer">("jobs");
  const [repairs, setRepairs] = useState<Repair[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [status, setStatus] = useState("all");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await adminFetch<{ repairs: Repair[]; stages: Stage[] }>("/api/repairs");
      setRepairs(d.repairs);
      setStages(d.stages);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load repairs");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of repairs) m.set(r.status, (m.get(r.status) || 0) + 1);
    return m;
  }, [repairs]);
  const shown = status === "all" ? repairs : repairs.filter((r) => r.status === status);

  const move = async (id: string, next: string) => {
    await adminFetch(`/api/repairs/${encodeURIComponent(id)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: next }),
    });
    void load();
  };

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <h1>Repairs</h1>
      </div>
      <p className="admin-section-lead">
        Every repair a customer books lands here. Move it along as the bench works it.
      </p>
      <HowThisWorks
        steps={[
          "A customer picks their device and what's wrong with it on your sell page; the price comes from the part cost plus your markup and labour.",
          "If there's no part cost on file yet, they're told you'll quote it — the booking still comes through, and you set the price here.",
          "Move it from Booked through Received, Being repaired and Ready to collect; the customer sees each step on their tracker.",
          "Set part costs and your markup under Pricing on this page. An override price ignores the formula for that one repair.",
        ]}
      />

      <div className="admin-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "jobs"} className={tab === "jobs" ? "active" : ""} onClick={() => setTab("jobs")}>
          Jobs
        </button>
        <button type="button" role="tab" aria-selected={tab === "pricing"} className={tab === "pricing" ? "active" : ""} onClick={() => setTab("pricing")}>
          Pricing
        </button>
        <button type="button" role="tab" aria-selected={tab === "customer"} className={tab === "customer" ? "active" : ""} onClick={() => setTab("customer")}>
          What customers see
        </button>
      </div>

      {error ? <p className="admin-error">{error}</p> : null}

      {tab === "jobs" ? (
        <>
          <div className="admin-status-filters">
            <button type="button" className={status === "all" ? "active" : ""} onClick={() => setStatus("all")}>
              <span className="admin-count-badge">{repairs.length}</span> All
            </button>
            {stages.map((s) => (
              <button key={s.id} type="button" className={status === s.id ? "active" : ""} onClick={() => setStatus(s.id)}>
                <span className="admin-count-badge">{counts.get(s.id) || 0}</span> {s.label}
              </button>
            ))}
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Repair ID</th>
                  <th>Customer</th>
                  <th>Device</th>
                  <th>Problem</th>
                  <th>Price</th>
                  <th>Status</th>
                  <th>Change stage</th>
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <div className="admin-empty">No repairs yet. They appear here when a customer books one.</div>
                    </td>
                  </tr>
                ) : (
                  shown.map((r) => (
                    <tr key={r.id}>
                      <td>{r.id}</td>
                      <td>
                        {r.first_name} {r.last_name}
                        <div className="admin-sub">{r.phone || r.email || "—"}</div>
                      </td>
                      <td>{r.device_name}</td>
                      <td>{r.problem_label}</td>
                      <td>
                        {r.quoted_price != null ? `$${r.quoted_price}` : <span className="admin-status-pill" data-tone="blocked">Needs a quote</span>}
                      </td>
                      <td>
                        <span className="admin-status-pill" data-tone={STAGE_TONE[r.status] || "neutral"}>
                          {stages.find((s) => s.id === r.status)?.label || r.status}
                        </span>
                      </td>
                      <td>
                        <select className="admin-select" value={r.status} onChange={(e) => void move(r.id, e.target.value)}>
                          {stages.map((s) => (
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
      ) : tab === "pricing" ? (
        <RepairPricing />
      ) : (
        <CustomerView />
      )}
    </div>
  );
}

/**
 * The list a customer is offered as "what's wrong", edited here.
 *
 * The shop reads exactly what its customers read, changes the words, switches
 * off a repair it does not take, adds one it does, and can open the widget to
 * see the result as a customer would. The whole list is saved as one thing,
 * in the order shown, so what is on this screen is what is on theirs.
 */
function CustomerView() {
  const [rows, setRows] = useState<Problem[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const d = await adminFetch<{ problems: Problem[] }>("/api/repairs/pricing");
    setRows(d.problems.map((p) => ({ ...p, enabled: p.enabled !== false })));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const update = (i: number, patch: Partial<Problem>) =>
    setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  const moveRow = (i: number, dir: -1 | 1) =>
    setRows((r) => {
      const j = i + dir;
      if (j < 0 || j >= r.length) return r;
      const copy = [...r];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  const add = () => setRows((r) => [...r, { id: "", label: "", enabled: true }]);
  const remove = (i: number) => setRows((r) => r.filter((_, j) => j !== i));

  const save = async () => {
    setErr(null);
    setMsg(null);
    const cleaned = rows
      .map((r) => ({
        id: (r.id || r.label).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""),
        label: r.label.trim(),
        enabled: r.enabled !== false,
      }))
      .filter((r) => r.label);
    try {
      const d = await adminFetch<{ problems: Problem[] }>("/api/repairs/pricing/problems", {
        method: "PUT",
        body: JSON.stringify({ problems: cleaned }),
      });
      setRows(d.problems.map((p) => ({ ...p, enabled: p.enabled !== false })));
      setMsg("Saved. Customers see this list now.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save");
    }
  };

  return (
    <section className="admin-pricing-form" style={{ maxWidth: 760 }}>
      <h2>What's wrong with it?</h2>
      <p className="admin-sub">
        This is the list a customer picks from after choosing their device, in this order. Reword anything,
        switch off a repair you don't take, or add one you do.{" "}
        <a href="/preview#repair" target="_blank" rel="noreferrer">
          Open the repair page as a customer
        </a>
      </p>
      <div className="admin-table-wrap">
        <table className="admin-table admin-table--edit">
          <thead>
            <tr>
              <th style={{ width: 40 }}>On</th>
              <th>What the customer reads</th>
              <th style={{ width: 120 }}>Order</th>
              <th style={{ width: 70 }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={r.enabled ? "" : "is-off"}>
                <td>
                  <input type="checkbox" checked={r.enabled !== false} onChange={(e) => update(i, { enabled: e.target.checked })} aria-label="Shown to customers" />
                </td>
                <td>
                  <input className="admin-input" value={r.label} onChange={(e) => update(i, { label: e.target.value })} placeholder="e.g. Cracked screen" />
                </td>
                <td>
                  <div className="admin-inline-actions">
                    <button type="button" className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => moveRow(i, -1)} aria-label="Move up">↑</button>
                    <button type="button" className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => moveRow(i, 1)} aria-label="Move down">↓</button>
                  </div>
                </td>
                <td>
                  <button type="button" className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => remove(i)}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="admin-inline-actions" style={{ marginTop: "0.75rem" }}>
        <button type="button" className="admin-btn admin-btn--ghost" onClick={add}>Add a problem</button>
        <button type="button" className="admin-btn" onClick={() => void save()}>Save what customers see</button>
      </div>
      {msg ? <p className="admin-ok">{msg}</p> : null}
      {err ? <p className="admin-error">{err}</p> : null}
    </section>
  );
}

function RepairPricing() {
  const [markup, setMarkup] = useState("10");
  const [labour, setLabour] = useState("100");
  const [parts, setParts] = useState<Part[]>([]);
  const [market, setMarket] = useState<Market[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [problem, setProblem] = useState("screen");
  const [partCost, setPartCost] = useState("");
  const [override, setOverride] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const d = await adminFetch<{
      settings: { markupPercent: number; labourFee: number };
      parts: Part[];
      problems: Problem[];
      market: Market[];
    }>("/api/repairs/pricing");
    setMarkup(String(d.settings.markupPercent));
    setLabour(String(d.settings.labourFee));
    setParts(d.parts);
    setMarket(d.market || []);
    setProblems(d.problems);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const saveSettings = async () => {
    await adminFetch("/api/repairs/pricing/settings", {
      method: "PUT",
      body: JSON.stringify({ markup_percent: Number(markup), labour_fee: Number(labour) }),
    });
    setMsg("Saved. Applies to the next quote.");
  };

  const savePart = async () => {
    if (!deviceId.trim()) return;
    const r = await adminFetch<{ quote: { price: number | null } }>("/api/repairs/pricing/parts", {
      method: "PUT",
      body: JSON.stringify({
        device_id: deviceId.trim(),
        problem,
        part_cost: partCost ? Number(partCost) : null,
        override_price: override ? Number(override) : null,
      }),
    });
    setMsg(r.quote.price != null ? `Saved — customers will be quoted $${r.quote.price}.` : "Saved.");
    setPartCost("");
    setOverride("");
    void load();
  };

  const refreshMarket = async () => {
    setRefreshing(true);
    try {
      await adminFetch("/api/repairs/pricing/market/refresh", { method: "POST" });
      setMsg("Reading published part prices — a few minutes. Reload this tab when it's done.");
    } finally {
      setRefreshing(false);
    }
  };

  // One row per device and part, whether the shop set a cost, a price was
  // published, or both — so the table is the whole picture, not just the
  // rows someone typed.
  const rows = (() => {
    const key = (d: string, p: string) => `${d}:${p}`;
    const map = new Map<string, { device_id: string; device_name: string | null; problem: string; part?: Part; mkt?: Market }>();
    for (const p of parts) map.set(key(p.device_id, p.problem), { device_id: p.device_id, device_name: p.device_name, problem: p.problem, part: p });
    for (const m of market) {
      const k = key(m.device_id, m.problem);
      const ex = map.get(k);
      if (ex) ex.mkt = m;
      else map.set(k, { device_id: m.device_id, device_name: m.device_name, problem: m.problem, mkt: m });
    }
    return [...map.values()].sort((a, b) => (a.device_name || a.device_id).localeCompare(b.device_name || b.device_id) || a.problem.localeCompare(b.problem));
  })();

  const preview = (() => {
    const pc = Number(partCost);
    if (override) return `$${Number(override)} (override)`;
    if (!pc) return "—";
    return `$${Math.round(pc * (1 + Number(markup) / 100) + Number(labour))}`;
  })();

  return (
    <section className="admin-pricing-grid">
      <div className="admin-pricing-form">
        <h2>How a repair is priced</h2>
        <p className="admin-sub">Part cost, plus your markup, plus labour. Change either and every repair follows.</p>
        <label>
          Markup on the part (%)
          <input type="number" step="1" value={markup} onChange={(e) => setMarkup(e.target.value)} />
        </label>
        <label>
          Labour per repair (CAD)
          <input type="number" step="1" value={labour} onChange={(e) => setLabour(e.target.value)} />
        </label>
        <button type="button" className="admin-btn" onClick={() => void saveSettings()}>
          Save
        </button>
      </div>

      <div className="admin-pricing-form">
        <h2>Part costs</h2>
        <p className="admin-sub">
          What the part costs you — from Mobile Centrics or your supplier. Leave the override blank unless you want a fixed price
          that ignores the formula.
        </p>
        <label>
          Device id
          <input value={deviceId} onChange={(e) => setDeviceId(e.target.value)} placeholder="iphone-15" />
        </label>
        <label>
          Problem
          <select value={problem} onChange={(e) => setProblem(e.target.value)}>
            {problems.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Part cost (CAD)
          <input type="number" step="1" value={partCost} onChange={(e) => setPartCost(e.target.value)} />
        </label>
        <label>
          Override price (CAD, optional)
          <input type="number" step="1" value={override} onChange={(e) => setOverride(e.target.value)} />
        </label>
        <p className="admin-sub">Customer would be quoted: <strong>{preview}</strong></p>
        <button type="button" className="admin-btn" onClick={() => void savePart()}>
          Save part cost
        </button>
        {msg ? <p className="admin-ok">{msg}</p> : null}
      </div>

      <div className="admin-table-wrap" style={{ gridColumn: "1 / -1" }}>
        <div className="admin-toolbar" style={{ justifyContent: "space-between" }}>
          <p className="admin-sub" style={{ margin: 0 }}>
            <strong>Market part price</strong> is what the part sells for at a published source, converted to CAD at the
            Bank of Canada rate on the day it was read. It is used only when you have not set your own cost.
            {market.length ? ` ${market.length} prices on file.` : " None on file yet."}
          </p>
          <button type="button" className="admin-btn admin-btn--ghost" disabled={refreshing} onClick={() => void refreshMarket()}>
            {refreshing ? "Starting…" : "Refresh published prices"}
          </button>
        </div>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Device</th>
              <th>Problem</th>
              <th>Your part cost</th>
              <th>Market part price</th>
              <th>Override</th>
              <th>Customer price</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6}>
                  <div className="admin-empty">No part costs yet — add one above, or refresh published prices to fill the market column.</div>
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const cost = r.part?.part_cost ?? r.mkt?.price_cad ?? null;
                const price =
                  r.part?.override_price != null
                    ? r.part.override_price
                    : cost != null
                      ? Math.round(cost * (1 + Number(markup) / 100) + Number(labour))
                      : null;
                const via = r.part?.override_price != null ? "override" : r.part?.part_cost != null ? "your cost" : r.mkt ? "market" : null;
                return (
                  <tr key={`${r.device_id}:${r.problem}`}>
                    <td>{r.device_name || r.device_id}</td>
                    <td>{problems.find((x) => x.id === r.problem)?.label || r.problem}</td>
                    <td>{r.part?.part_cost != null ? `$${r.part.part_cost}` : "—"}</td>
                    <td>
                      {r.mkt ? (
                        <>
                          ${r.mkt.price_cad.toFixed(2)}
                          <div className="admin-sub">
                            <a href={r.mkt.source_url} target="_blank" rel="noreferrer">{r.mkt.product_title.slice(0, 40)}</a>
                            {" · "}{r.mkt.price} {r.mkt.currency} × {r.mkt.fx_rate} · {r.mkt.scraped_at.slice(0, 10)}
                          </div>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{r.part?.override_price != null ? `$${r.part.override_price}` : "—"}</td>
                    <td>
                      {price != null ? `$${price}` : "—"}
                      {via ? <div className="admin-sub">{via}</div> : null}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
