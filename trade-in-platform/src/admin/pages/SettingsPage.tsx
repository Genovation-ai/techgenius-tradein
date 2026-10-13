import { useEffect, useState } from "react";
import { HowThisWorks } from "../HowThisWorks";
import { adminFetch } from "../api";

interface PromoCodeRow {
  id: string;
  code: string;
  discount_percent: number;
  discount_amount: number;
  active: number;
  uses?: number;
  max_uses?: number | null;
  expires_at?: string | null;
}

interface WorkflowStageRow {
  id: string;
  name: string;
  label: string;
  sort_order: number;
  send_email: number;
  email_template?: string | null;
}

interface WidgetTemplateRow {
  id: string;
  label: string;
  description: string;
}

/**
 * Frontend template picker — the visual counterpart of the Pricing page's
 * "which competitor do quotes reflect" control. One setting, applied by the
 * widget as `data-template`; markup and pricing are identical across all of
 * them, only presentation changes.
 */
function WidgetTemplatePanel() {
  const [templates, setTemplates] = useState<WidgetTemplateRow[]>([]);
  const [current, setCurrent] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void adminFetch<{ template: string; templates: WidgetTemplateRow[] }>("/api/settings/widget-template")
      .then((r) => {
        setTemplates(r.templates);
        setCurrent(r.template);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "Failed to load templates"));
  }, []);

  const save = async (template: string) => {
    const previous = current;
    setCurrent(template);
    setSaving(true);
    setMsg(null);
    setErr(null);
    try {
      await adminFetch("/api/settings/widget-template", {
        method: "PUT",
        body: JSON.stringify({ template }),
      });
      setMsg("Saved — the widget picks this up on its next load.");
    } catch (e) {
      setCurrent(previous);
      setErr(e instanceof Error ? e.message : "Failed to save template");
    } finally {
      setSaving(false);
    }
  };

  const selected = templates.find((t) => t.id === current);

  return (
    <>
      <h2 className="admin-section-title" style={{ marginTop: "1.25rem" }}>
        Storefront template
      </h2>
      {err ? <p className="admin-error">{err}</p> : null}
      {msg ? <p className="admin-ok">{msg}</p> : null}
      <p className="admin-section-lead">
        How the customer sell widget looks. Same steps and the same
        server-authoritative pricing in every template — presentation only.
      </p>
      <HowThisWorks
        steps={[
        "Your shop's name, logo and colours — these appear on the sell page customers see.",
        "Set the payout methods you actually offer; the customer only sees those.",
        "Changes apply to the next quote, not to offers already made.",
      ]}
      />
      <div className="admin-pricing-form" style={{ maxWidth: 720, display: "grid", gap: "0.5rem" }}>
        <label>
          Template
          <select
            className="admin-input"
            value={current}
            disabled={saving || !templates.length}
            onChange={(e) => void save(e.target.value)}
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        {selected ? <p className="admin-muted">{selected.description}</p> : null}
        {current ? (
          <p className="admin-muted">
            Preview one without switching the live store: add <code>?tg_template={current}</code> to
            the sell page URL.
          </p>
        ) : null}
      </div>
    </>
  );
}

function OrgSaasPanel() {
  const [companyName, setCompanyName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [brand, setBrand] = useState("#0B3D2E");
  const [cta, setCta] = useState("#C45C26");
  const [slug, setSlug] = useState("");
  const [stores, setStores] = useState<Array<{ id: string; name: string; phone?: string | null }>>([]);
  const [newStore, setNewStore] = useState("");
  const [keys, setKeys] = useState<Array<{ id: string; name: string; key_prefix: string; enabled: number }>>([]);
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  /** How this shop will take devices in, and where parcels go back to. */
  const [takesMail, setTakesMail] = useState(true);
  const [takesDrop, setTakesDrop] = useState(true);
  const [shipStreet, setShipStreet] = useState("");
  const [shipCity, setShipCity] = useState("");
  const [shipState, setShipState] = useState("");
  const [shipZip, setShipZip] = useState("");
  const [lookup, setLookup] = useState("");
  const [found, setFound] = useState<Array<{ label: string; street1: string; city: string; state: string; zip: string }>>([]);

  const load = async () => {
    const org = await adminFetch<{
      org: { slug: string };
      settings: {
        company_name?: string;
        company_phone?: string;
        company_email?: string;
        widget_brand_color?: string;
        widget_cta_color?: string;
        offer_types?: string[] | string;
        ship_street1?: string;
        ship_city?: string;
        ship_state?: string;
        ship_zip?: string;
      } | null;
      stores: Array<{ id: string; name: string; phone?: string | null }>;
    }>("/api/saas/org");
    setSlug(org.org.slug);
    setCompanyName(org.settings?.company_name || "");
    setPhone(org.settings?.company_phone || "");
    setEmail(org.settings?.company_email || "");
    setBrand(org.settings?.widget_brand_color || "#0B3D2E");
    setCta(org.settings?.widget_cta_color || "#C45C26");
    setStores(org.stores || []);

    const raw = org.settings?.offer_types;
    const types: string[] = Array.isArray(raw)
      ? raw
      : typeof raw === "string"
        ? (() => {
            try {
              return JSON.parse(raw) as string[];
            } catch {
              return ["mail-in", "drop-off"];
            }
          })()
        : ["mail-in", "drop-off"];
    setTakesMail(types.includes("mail-in"));
    setTakesDrop(types.includes("drop-off"));
    setShipStreet(org.settings?.ship_street1 || "");
    setShipCity(org.settings?.ship_city || "");
    setShipState(org.settings?.ship_state || "");
    setShipZip(org.settings?.ship_zip || "");
    const keyRows = await adminFetch<Array<{ id: string; name: string; key_prefix: string; enabled: number }>>(
      "/api/saas/org/api-keys",
    ).catch(() => []);
    setKeys(keyRows);
  };

  useEffect(() => {
    void load().catch((e) => setErr(e instanceof Error ? e.message : "Failed to load org"));
  }, []);

  const saveBranding = async () => {
    setErr(null);
    await adminFetch("/api/saas/org/settings", {
      method: "PUT",
      body: JSON.stringify({
        company_name: companyName,
        company_phone: phone,
        company_email: email,
        widget_brand_color: brand,
        widget_cta_color: cta,
      }),
    });
    setMsg("Branding saved");
    document.documentElement.style.setProperty("--admin-brand", brand);
  };

  const saveHandoff = async () => {
    setErr(null);
    const offer_types = [
      ...(takesMail ? ["mail-in"] : []),
      ...(takesDrop ? ["drop-off"] : []),
    ];
    if (!offer_types.length) {
      setErr("Keep at least one way of taking a device in, or customers cannot finish.");
      return;
    }
    await adminFetch("/api/saas/org/settings", {
      method: "PUT",
      body: JSON.stringify({
        offer_types,
        ship_street1: shipStreet,
        ship_city: shipCity,
        ship_state: shipState,
        ship_zip: shipZip,
      }),
    });
    setMsg("Handoff settings saved");
  };

  /** Find a real address rather than trusting what was typed. */
  const findAddress = async () => {
    setFound([]);
    if (lookup.trim().length < 3) return;
    try {
      const r = await adminFetch<{ results: typeof found }>(
        `/api/geo/suggest?q=${encodeURIComponent(lookup.trim())}`,
      );
      setFound(r.results || []);
    } catch {
      // Typing it by hand still works; the lookup is help, not a gate.
    }
  };

  const addStore = async () => {
    if (!newStore.trim()) return;
    await adminFetch("/api/saas/org/stores", {
      method: "POST",
      body: JSON.stringify({ name: newStore.trim() }),
    });
    setNewStore("");
    await load();
  };

  const createKey = async () => {
    const res = await adminFetch<{ api_key: string }>("/api/saas/org/api-keys", {
      method: "POST",
      body: JSON.stringify({ name: "Widget key" }),
    });
    setFreshKey(res.api_key);
    await load();
  };

  return (
    <>
      <h2 className="admin-section-title">Organization (SaaS)</h2>
      {err ? <p className="admin-error">{err}</p> : null}
      {msg ? <p className="admin-ok">{msg}</p> : null}
      <p className="admin-section-lead">
        Widget config: <code>/api/saas/widget-config?org={slug || "…"}</code>
      </p>
      <div className="admin-pricing-form" style={{ maxWidth: 720, display: "grid", gap: "0.5rem" }}>
        <input className="admin-input" value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Company name" />
        <input className="admin-input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" />
        <input className="admin-input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Support email" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
          <label>
            Brand color
            <input className="admin-input" type="color" value={brand} onChange={(e) => setBrand(e.target.value)} />
          </label>
          <label>
            CTA color
            <input className="admin-input" type="color" value={cta} onChange={(e) => setCta(e.target.value)} />
          </label>
        </div>
        <button type="button" className="admin-btn" onClick={() => void saveBranding()}>
          Save branding
        </button>
      </div>

      <h2 className="admin-section-title" style={{ marginTop: "1.25rem" }}>
        Locations
      </h2>
      <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
        {stores.map((s) => (
          <li key={s.id}>
            {s.name} <span className="admin-muted">({s.id})</span>
          </li>
        ))}
      </ul>
      <div className="admin-toolbar" style={{ marginTop: "0.5rem" }}>
        <input className="admin-input grow" value={newStore} onChange={(e) => setNewStore(e.target.value)} placeholder="New location name" />
        <button type="button" className="admin-btn" onClick={() => void addStore()}>
          Add store
        </button>
      </div>

      <h2 className="admin-section-title" style={{ marginTop: "1.25rem" }}>
        How you take devices in
      </h2>
      <p className="admin-muted" style={{ marginTop: 0 }}>
        Turn off anything you do not do. A customer is only shown the ways you
        have left on, so a walk-in shop never promises a shipping label.
      </p>
      <div style={{ display: "grid", gap: "0.4rem", marginBottom: "0.75rem" }}>
        <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <input
            type="checkbox"
            checked={takesMail}
            onChange={(e) => setTakesMail(e.target.checked)}
          />
          <span>
            <strong>Mail-in.</strong> Customers post the device to you.
          </span>
        </label>
        <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <input
            type="checkbox"
            checked={takesDrop}
            onChange={(e) => setTakesDrop(e.target.checked)}
          />
          <span>
            <strong>Drop-off.</strong> Customers bring it to a store.
          </span>
        </label>
      </div>

      {takesMail ? (
        <>
          <h3 style={{ fontSize: "0.95rem", margin: "0.75rem 0 0.25rem" }}>
            Where parcels come back to
          </h3>
          <p className="admin-muted" style={{ marginTop: 0 }}>
            Needed before a carrier label can be bought. Search for it rather
            than typing it — a wrong postcode is a parcel that never arrives.
          </p>
          <div className="admin-toolbar">
            <input
              className="admin-input grow"
              value={lookup}
              onChange={(e) => setLookup(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void findAddress();
              }}
              placeholder="Search an address, e.g. 796 Brant St Burlington"
            />
            <button type="button" className="admin-btn" onClick={() => void findAddress()}>
              Search
            </button>
          </div>
          {found.length ? (
            <ul style={{ margin: "0.5rem 0", paddingLeft: "1.1rem" }}>
              {found.map((f) => (
                <li key={f.label} style={{ marginBottom: "0.2rem" }}>
                  <button
                    type="button"
                    className="admin-btn admin-btn--quiet"
                    onClick={() => {
                      setShipStreet(f.street1);
                      setShipCity(f.city);
                      setShipState(f.state);
                      setShipZip(f.zip);
                      setFound([]);
                      setLookup("");
                    }}
                  >
                    {f.label}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="admin-toolbar" style={{ marginTop: "0.4rem", flexWrap: "wrap" }}>
            <input className="admin-input grow" value={shipStreet} onChange={(e) => setShipStreet(e.target.value)} placeholder="Street" />
            <input className="admin-input" value={shipCity} onChange={(e) => setShipCity(e.target.value)} placeholder="City" />
            <input className="admin-input" value={shipState} onChange={(e) => setShipState(e.target.value)} placeholder="Province" />
            <input className="admin-input" value={shipZip} onChange={(e) => setShipZip(e.target.value)} placeholder="Postal code" />
          </div>
        </>
      ) : null}

      <div className="admin-toolbar" style={{ marginTop: "0.5rem" }}>
        <button type="button" className="admin-btn" onClick={() => void saveHandoff()}>
          Save handoff settings
        </button>
      </div>

      <h2 className="admin-section-title" style={{ marginTop: "1.25rem" }}>
        API keys
      </h2>
      <p className="admin-section-lead">Per-shop keys for embeds and integrations (`tg_live_…`).</p>
      {freshKey ? (
        <code className="admin-input" style={{ display: "block", wordBreak: "break-all", marginBottom: "0.5rem" }}>
          {freshKey}
        </code>
      ) : null}
      <button type="button" className="admin-btn admin-btn--ghost" onClick={() => void createKey()}>
        Create API key
      </button>
      <div className="admin-table-wrap" style={{ marginTop: "0.75rem" }}>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Prefix</th>
              <th>Active</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id}>
                <td>{k.name}</td>
                <td>
                  <code>{k.key_prefix}…</code>
                </td>
                <td>{k.enabled ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function SettingsPage() {
  const [promos, setPromos] = useState<PromoCodeRow[]>([]);
  const [workflow, setWorkflow] = useState<WorkflowStageRow[]>([]);
  const [integrations, setIntegrations] = useState<{
    email: { configured: boolean; blocked: number; sent: number; failed: number };
    crm: { configured: boolean; blocked: number; sent: number };
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [p, w, integ] = await Promise.all([
        adminFetch<PromoCodeRow[]>("/api/settings/promos"),
        adminFetch<WorkflowStageRow[]>("/api/settings/workflow"),
        adminFetch<{
          email: { configured: boolean; blocked: number; sent: number; failed: number };
          crm: { configured: boolean; blocked: number; sent: number };
        }>("/api/integrations/status").catch(() => null),
      ]);
      setPromos(p);
      setWorkflow(w);
      setIntegrations(integ);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const togglePromoActive = async (promo: PromoCodeRow) => {
    await adminFetch(`/api/settings/promos/${encodeURIComponent(promo.id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        active: promo.active ? 0 : 1,
        discount_percent: promo.discount_percent,
        discount_amount: promo.discount_amount,
      }),
    });
    await load();
  };

  const saveWorkflowRow = async (row: WorkflowStageRow) => {
    await adminFetch(`/api/settings/workflow/${encodeURIComponent(row.id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        send_email: row.send_email,
        label: row.label,
        email_template: row.email_template || null,
      }),
    });
    await load();
  };

  return (
    <>
      <div className="admin-header-row">
        <h1 className="admin-page-title" style={{ margin: 0 }}>
          Settings
        </h1>
        <button type="button" className="admin-btn admin-btn--ghost" onClick={() => void load()} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      <p className="admin-section-lead">
        Organization branding, stores, API keys, promos, and workflow — everything you need to sell this desk to other shops.
      </p>

      {error ? <p className="admin-error">{error}</p> : null}

      <OrgSaasPanel />

      <WidgetTemplatePanel />

      {integrations ? (
        <>
          <h2 className="admin-section-title">Integrations</h2>
          <div className="admin-kpis">
            <div className="admin-kpi">
              <div>
                <span>Email webhook</span>
                <strong style={{ fontSize: "0.95rem" }}>
                  {integrations.email.configured ? "Configured" : "Not set (queued/blocked)"}
                </strong>
                <div className="admin-muted">
                  sent {integrations.email.sent} · blocked {integrations.email.blocked} · failed{" "}
                  {integrations.email.failed}
                </div>
              </div>
            </div>
            <div className="admin-kpi">
              <div>
                <span>CRM webhook</span>
                <strong style={{ fontSize: "0.95rem" }}>
                  {integrations.crm.configured ? "Configured" : "Not set (outbox blocked)"}
                </strong>
                <div className="admin-muted">
                  sent {integrations.crm.sent} · blocked {integrations.crm.blocked}
                </div>
              </div>
            </div>
          </div>
          <p className="admin-section-lead">
            Set <code>TG_EMAIL_WEBHOOK</code> and <code>TG_CRM_WEBHOOK_URL</code> on the API host to deliver
            live. Until then events are persisted as blocked — not fake successes.
          </p>
        </>
      ) : null}

      <div className="admin-header-row" style={{ marginTop: "1.25rem" }}>
        <h2 className="admin-section-title" style={{ margin: 0 }}>
          Promo codes
        </h2>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Active</th>
              <th>Discount %</th>
              <th>Discount $</th>
              <th>Toggle</th>
            </tr>
          </thead>
          <tbody>
            {promos.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  <div className="admin-empty">No promo codes yet — create one to run an offer</div>
                </td>
              </tr>
            ) : (
              promos.map((p) => (
                <tr key={p.id}>
                  <td>{p.code}</td>
                  <td>{p.active ? "Yes" : "No"}</td>
                  <td>{p.discount_percent}</td>
                  <td>${(p.discount_amount || 0).toLocaleString()}</td>
                  <td>
                    <button type="button" className="admin-btn admin-btn--orange" onClick={() => void togglePromoActive(p)}>
                      {p.active ? "Disable" : "Enable"}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="admin-header-row" style={{ marginTop: "1.25rem" }}>
        <h2 className="admin-section-title" style={{ margin: 0 }}>
          Workflow stages
        </h2>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Stage</th>
              <th>Label</th>
              <th>Send email</th>
              <th>Save</th>
            </tr>
          </thead>
          <tbody>
            {workflow.length === 0 ? (
              <tr>
                <td colSpan={4}>
                  <div className="admin-empty">No stages set up yet — add one to start routing offers</div>
                </td>
              </tr>
            ) : (
              workflow.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td>
                    <input
                      className="admin-input"
                      value={s.label}
                      onChange={(e) => setWorkflow((prev) => prev.map((x) => (x.id === s.id ? { ...x, label: e.target.value } : x)))}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className={`admin-btn ${s.send_email ? "admin-btn--green" : "admin-btn--ghost"}`}
                      onClick={() =>
                        setWorkflow((prev) => prev.map((x) => (x.id === s.id ? { ...x, send_email: s.send_email ? 0 : 1 } : x)))
                      }
                    >
                      {s.send_email ? "On" : "Off"}
                    </button>
                  </td>
                  <td>
                    <button type="button" className="admin-btn" onClick={() => void saveWorkflowRow(s)}>
                      Save
                    </button>
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

