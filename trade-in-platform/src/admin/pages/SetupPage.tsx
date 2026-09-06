import { useEffect, useMemo, useState } from "react";
import { adminFetch, getAdminOrg } from "../api";
import { resolveApiBase } from "../../lib/tradeInApi";

interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  role: string;
  enabled: number;
  created_at: string;
  last_used_at?: string | null;
}

/**
 * Connect — how a shop gets Reclaim onto their own website.
 *
 * Everything here is pre-filled with this shop's own values. A setup page that
 * shows a generic snippet and leaves the reader to substitute their identifier
 * is where most integrations stall, so the code below is copy-and-paste final:
 * their org, their server, nothing to edit.
 */
export function SetupPage() {
  const org = getAdminOrg();
  const base = resolveApiBase();
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [issued, setIssued] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [probe, setProbe] = useState<null | { ok: boolean; detail: string }>(null);

  const slug = org?.slug ?? "your-shop";

  const snippet = useMemo(
    () =>
      `<link rel="stylesheet" href="${base}/embed/tg-trade-in.css">

<div id="tg-trade-in-root"
     data-api="${base}"
     data-org="${slug}"></div>

<script src="${base}/embed/tg-trade-in.js" defer></script>`,
    [base, slug],
  );

  useEffect(() => {
    void loadKeys();
  }, []);

  /**
   * The endpoint returns a bare array. Reading `.keys` off it yielded
   * Array.prototype.keys — a function — which React then ran as a state updater
   * and blew up inside its reducer. Normalise the shape here instead of
   * trusting it.
   */
  async function loadKeys() {
    try {
      const d = await adminFetch<ApiKeyRow[] | { keys?: ApiKeyRow[] }>("/api/saas/org/api-keys");
      setKeys(Array.isArray(d) ? d : (d?.keys ?? []));
    } catch {
      setKeys([]);
    }
  }

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      setCopied(null);
    }
  }

  async function createKey() {
    setBusy(true);
    try {
      const res = await adminFetch<{ api_key?: string; key?: string }>(
        "/api/saas/org/api-keys",
        {
          method: "POST",
          body: JSON.stringify({ name: "Website key" }),
        },
      );
      setIssued(res.api_key ?? res.key ?? null);
      await loadKeys();
    } finally {
      setBusy(false);
    }
  }

  /** Confirms the shop's own storefront can actually reach the quote engine. */
  async function testConnection() {
    setProbe(null);
    try {
      const res = await fetch(`${base}/api/saas/widget-config?org=${encodeURIComponent(slug)}`);
      const body = (await res.json()) as { company_name?: string; error?: string };
      if (!res.ok || body.error) {
        setProbe({ ok: false, detail: body.error ?? `HTTP ${res.status}` });
        return;
      }
      setProbe({
        ok: true,
        detail: `Answering as “${body.company_name ?? slug}”. Your widget will show that name.`,
      });
    } catch (e) {
      setProbe({ ok: false, detail: e instanceof Error ? e.message : "Could not reach the server" });
    }
  }

  return (
    <div className="admin-page">
      <header className="admin-page-head">
        <h1>Connect your site</h1>
        <p className="admin-section-lead">
          Paste one block into your website and customers can price a device without
          leaving it. The code below already has your shop's details in it.
        </p>
      </header>

      <section className="admin-card">
        <h2>1. Add this to the page where you want the quote form</h2>
        <p className="admin-muted">
          Works on Framer, Shopify, WordPress, Webflow or plain HTML. On Framer, insert an
          Embed element and switch it to HTML.
        </p>
        <pre className="admin-code">{snippet}</pre>
        <div className="admin-row">
          <button type="button" className="admin-btn" onClick={() => void copy(snippet, "snippet")}>
            {copied === "snippet" ? "Copied" : "Copy code"}
          </button>
          <span className="admin-muted">
            Give the element room — the form grows as the customer answers. Minimum height
            900px, and don't hide overflow.
          </span>
        </div>
      </section>

      <section className="admin-card">
        <h2>2. Check it can reach us</h2>
        <p className="admin-muted">
          This asks the server for your shop's settings, exactly as the widget will.
        </p>
        <div className="admin-row">
          <button type="button" className="admin-btn" onClick={() => void testConnection()}>
            Test connection
          </button>
          {probe ? (
            <span className={probe.ok ? "admin-ok" : "admin-danger"}>
              {probe.ok ? "Connected. " : "Failed. "}
              {probe.detail}
            </span>
          ) : null}
        </div>
      </section>

      <section className="admin-card">
        <h2>3. Keys, if you are building your own integration</h2>
        <p className="admin-muted">
          The widget above needs no key. You only need one to call the API directly — to
          pull offers into your own system, for example.
        </p>

        {issued ? (
          <div className="admin-callout">
            <strong>Copy this now.</strong> It is shown once and never again.
            <pre className="admin-code">{issued}</pre>
            <button type="button" className="admin-btn" onClick={() => void copy(issued, "key")}>
              {copied === "key" ? "Copied" : "Copy key"}
            </button>
          </div>
        ) : null}

        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Key</th>
              <th>Role</th>
              <th>Last used</th>
            </tr>
          </thead>
          <tbody>
            {keys.length ? (
              keys.map((k) => (
                <tr key={k.id}>
                  <td>{k.name}</td>
                  <td className="admin-mono">{k.key_prefix}…</td>
                  <td>{k.role}</td>
                  <td className="admin-muted">{k.last_used_at ?? "never"}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} className="admin-muted">
                  No keys yet. You don't need one for the widget.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <button type="button" className="admin-btn" disabled={busy} onClick={() => void createKey()}>
          {busy ? "Creating…" : "Create a key"}
        </button>
      </section>

      <section className="admin-card">
        <h2>Your details</h2>
        <table className="admin-table">
          <tbody>
            <tr>
              <td>Shop ID</td>
              <td className="admin-mono">{slug}</td>
            </tr>
            <tr>
              <td>Server</td>
              <td className="admin-mono">{base}</td>
            </tr>
            <tr>
              <td>Plan</td>
              <td>{org?.plan ?? "—"}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  );
}
