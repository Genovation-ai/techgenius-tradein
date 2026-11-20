import { useEffect, useState } from "react";
import { adminFetch } from "../api";

type KeyRole = "viewer" | "operator" | "manager" | "admin";

interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  role: string | null;
  enabled: number;
  created_at: string;
  last_used_at: string | null;
}

interface AiConnection {
  client_id: string;
  user_id: string;
  email: string;
  name: string;
  level: string;
  client_name: string;
  connected_at: string;
  last_used_at: string | null;
}

interface ClientGuide {
  id: string;
  name: string;
  auth: "signin" | "key" | "either";
  steps: string[];
  config?: { file?: string; language: string; body: string };
}

/** One-click installers for the tools that support them. */
function installLink(id: string, mcpUrl: string, key: string): string | null {
  const headers = { "x-api-key": key };
  if (id === "cursor") {
    const cfg = btoa(JSON.stringify({ url: mcpUrl, headers }));
    return `cursor://anysphere.cursor-deeplink/mcp/install?name=gadget-swap&config=${encodeURIComponent(cfg)}`;
  }
  if (id === "vscode") {
    return `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: "gadget-swap", type: "http", url: mcpUrl, headers }))}`;
  }
  return null;
}

interface McpActivityRow {
  id: number;
  actor: string;
  role: string | null;
  tool: string;
  args: unknown;
  ok: boolean;
  error: string | null;
  duration_ms: number;
  created_at: string;
}

const ROLE_HELP: Record<KeyRole, string> = {
  viewer: "Read-only — can look at everything, change nothing. Safest for an AI assistant.",
  operator: "Day-to-day work: offers, labels, payouts, inventory. No pricing, catalogue or settings.",
  manager: "Everything except managing staff logins.",
  admin: "Full control, including pricing, catalogue, settings and staff.",
};

const ROLE_LABEL: Record<string, string> = {
  viewer: "Read-only",
  operator: "Operator",
  manager: "Manager",
  admin: "Admin",
  integration: "Manager",
};

/**
 * Keys for integrations and AI assistants (MCP), each with its own scope, plus
 * the audit trail of every tool an assistant called.
 */
export function AiAccessPanel() {
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [activity, setActivity] = useState<McpActivityRow[]>([]);
  const [connections, setConnections] = useState<AiConnection[]>([]);
  const [guides, setGuides] = useState<ClientGuide[]>([]);
  const [tool, setTool] = useState("claude-ai");
  const [name, setName] = useState("Claude assistant");
  const [role, setRole] = useState<KeyRole>("viewer");
  const [fresh, setFresh] = useState<{ key: string; role: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const mcpUrl = `${window.location.origin}/mcp`;

  const load = async () => {
    const [k, a, c] = await Promise.all([
      adminFetch<ApiKeyRow[]>("/api/saas/org/api-keys").catch(() => []),
      adminFetch<McpActivityRow[]>("/api/integrations/mcp-activity?limit=50").catch(() => []),
      adminFetch<AiConnection[]>("/api/integrations/ai-connections").catch(() => []),
    ]);
    setKeys(k);
    setActivity(a);
    setConnections(c);
  };

  useEffect(() => {
    void load();
    fetch("/connect.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { clients?: ClientGuide[] } | null) => setGuides(d?.clients ?? []))
      .catch(() => setGuides([]));
  }, []);

  const create = async () => {
    setErr(null);
    setMsg(null);
    if (role === "admin" && !window.confirm("An admin key can change prices, payouts and staff logins. Create it?")) return;
    try {
      const res = await adminFetch<{ api_key: string; role: string }>("/api/saas/org/api-keys", {
        method: "POST",
        body: JSON.stringify({ name: name.trim() || "API key", role }),
      });
      setFresh({ key: res.api_key, role: res.role });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not create key");
    }
  };

  const revoke = async (k: ApiKeyRow) => {
    if (!window.confirm(`Revoke "${k.name}"? Anything using it stops working immediately.`)) return;
    try {
      await adminFetch(`/api/saas/org/api-keys/${encodeURIComponent(k.id)}`, { method: "DELETE" });
      setMsg(`Revoked ${k.name}`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not revoke key");
    }
  };

  const disconnect = async (c: AiConnection) => {
    if (!window.confirm(`Disconnect ${c.client_name} for ${c.email}? It will need to sign in again.`)) return;
    try {
      await adminFetch(
        `/api/integrations/ai-connections/${encodeURIComponent(c.client_id)}/${encodeURIComponent(c.user_id)}`,
        { method: "DELETE" },
      );
      setMsg(`Disconnected ${c.client_name}`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not disconnect");
    }
  };

  const copy = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied(null);
    }
  };

  const sseUrl = `${window.location.origin}/sse`;
  const fill = (text: string) =>
    text
      .split("{{URL}}").join(mcpUrl)
      .split("{{SSE}}").join(sseUrl)
      .split("{{KEY}}").join(fresh?.key ?? "YOUR_API_KEY");
  const guide = guides.find((g) => g.id === tool);
  const configText = guide?.config ? fill(guide.config.body) : "";
  const oneClick = fresh && guide ? installLink(guide.id, mcpUrl, fresh.key) : null;

  return (
    <>
      <h2 className="admin-section-title" style={{ marginTop: "1.25rem" }}>
        API keys &amp; AI assistants
      </h2>
      <p className="admin-section-lead">
        Connect Claude, Cursor or any MCP-capable AI tool at <code>{mcpUrl}</code>, or use a key for an
        integration. Each key has its own access level and can be revoked at any time.
      </p>
      {msg ? <p className="admin-ok">{msg}</p> : null}
      {err ? <p className="admin-error">{err}</p> : null}

      <div className="admin-pricing-form" style={{ maxWidth: 720, display: "grid", gap: "0.5rem" }}>
        <strong>Connect an AI tool</strong>
        <div className="admin-toolbar">
          <code className="admin-input" style={{ flex: 1, wordBreak: "break-all" }}>{mcpUrl}</code>
          <button type="button" className="admin-btn admin-btn--sm" onClick={() => void copy("url", mcpUrl)}>
            {copied === "url" ? "Copied" : "Copy URL"}
          </button>
        </div>
        <label>
          Which tool?
          <select className="admin-input" value={tool} onChange={(e) => setTool(e.target.value)}>
            {guides.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        {guide ? (
          <>
            <p style={{ margin: 0, fontSize: "0.85rem", color: "#6b7280" }}>
              {guide.auth === "signin"
                ? "Sign in with your staff login — no key needed."
                : guide.auth === "either"
                  ? "Sign in, or use an API key (create one below and it is filled in here)."
                  : "Needs an API key — create one below and it is filled in here."}
            </p>
            <ol style={{ margin: 0, paddingLeft: "1.2rem" }}>
              {guide.steps.map((step, i) => (
                <li key={i}>{fill(step)}</li>
              ))}
            </ol>
            {guide.config ? (
              <>
                {guide.config.file ? <code style={{ fontSize: "0.8rem" }}>{guide.config.file}</code> : null}
                <pre className="admin-input" style={{ whiteSpace: "pre-wrap", fontSize: "0.8rem", margin: 0 }}>
                  {configText}
                </pre>
                <div className="admin-toolbar">
                  <button type="button" className="admin-btn admin-btn--sm" onClick={() => void copy("cfg", configText)}>
                    {copied === "cfg" ? "Copied" : "Copy"}
                  </button>
                  {oneClick ? (
                    <a className="admin-btn admin-btn--sm" href={oneClick}>
                      Install in {guide.id === "cursor" ? "Cursor" : "VS Code"}
                    </a>
                  ) : null}
                </div>
                {!fresh && guide.auth !== "signin" ? (
                  <p style={{ margin: 0, fontSize: "0.8rem", color: "#6b7280" }}>
                    Create a key below and this config fills in with it{guide.id === "cursor" || guide.id === "vscode" ? ", with a one-click install button" : ""}.
                  </p>
                ) : null}
              </>
            ) : null}
          </>
        ) : null}
        <a href="/connect" target="_blank" rel="noreferrer" style={{ fontSize: "0.85rem" }}>
          Open the full setup guide (shareable, no key on it)
        </a>
      </div>

      <h3 className="admin-section-title" style={{ marginTop: "1rem", fontSize: "1rem" }}>
        Connected assistants
      </h3>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Assistant</th>
              <th>Signed in as</th>
              <th>Access</th>
              <th>Last used (UTC)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {connections.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  <div className="admin-empty">No assistant has signed in yet</div>
                </td>
              </tr>
            ) : (
              connections.map((c) => (
                <tr key={`${c.client_id}:${c.user_id}`}>
                  <td>{c.client_name}</td>
                  <td>{c.email}</td>
                  <td>{ROLE_LABEL[c.level] ?? c.level}</td>
                  <td>{c.last_used_at ?? "not yet"}</td>
                  <td>
                    <button type="button" className="admin-btn admin-btn--sm" onClick={() => void disconnect(c)}>
                      Disconnect
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <h3 className="admin-section-title" style={{ marginTop: "1rem", fontSize: "1rem" }}>
        API keys (for tools that do not sign in, and integrations)
      </h3>
      <div className="admin-pricing-form" style={{ maxWidth: 720, display: "grid", gap: "0.5rem" }}>
        <label>
          Key name
          <input className="admin-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </label>
        <label>
          Access level
          <select className="admin-input" value={role} onChange={(e) => setRole(e.target.value as KeyRole)}>
            <option value="viewer">Read-only</option>
            <option value="operator">Operator</option>
            <option value="manager">Manager</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <p style={{ margin: 0, fontSize: "0.85rem", color: "#6b7280" }}>{ROLE_HELP[role]}</p>
        <div>
          <button type="button" className="admin-btn" onClick={() => void create()}>
            Create key
          </button>
        </div>
      </div>

      {fresh ? (
        <div className="admin-pricing-form" style={{ maxWidth: 720, marginTop: "0.75rem", display: "grid", gap: "0.5rem" }}>
          <strong>Copy this key now — it will not be shown again ({ROLE_LABEL[fresh.role] ?? fresh.role}).</strong>
          <code className="admin-input" style={{ display: "block", wordBreak: "break-all" }}>
            {fresh.key}
          </code>
          <div className="admin-toolbar">
            <button type="button" className="admin-btn admin-btn--sm" onClick={() => void copy("key", fresh.key)}>
              {copied === "key" ? "Copied" : "Copy key"}
            </button>
          </div>
          <p style={{ margin: 0, fontSize: "0.85rem" }}>
            The setup for <strong>{guide?.name ?? "your tool"}</strong> above now includes this key. Pick a different tool there to get its config.
          </p>
        </div>
      ) : null}

      <div className="admin-table-wrap" style={{ marginTop: "0.75rem" }}>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Access</th>
              <th>Prefix</th>
              <th>Last used</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {keys.length === 0 ? (
              <tr>
                <td colSpan={6}>
                  <div className="admin-empty">No keys yet</div>
                </td>
              </tr>
            ) : (
              keys.map((k) => (
                <tr key={k.id}>
                  <td>{k.name}</td>
                  <td>{ROLE_LABEL[k.role ?? ""] ?? k.role ?? "Manager"}</td>
                  <td>
                    <code>{k.key_prefix}…</code>
                  </td>
                  <td>{k.last_used_at ?? "never"}</td>
                  <td>{k.enabled ? "Active" : "Revoked"}</td>
                  <td>
                    {k.enabled ? (
                      <button type="button" className="admin-btn admin-btn--sm" onClick={() => void revoke(k)}>
                        Revoke
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <h3 className="admin-section-title" style={{ marginTop: "1rem", fontSize: "1rem" }}>
        AI assistant activity
      </h3>
      <p className="admin-section-lead">Every tool an assistant called, newest first. Passwords and keys are never stored here.</p>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>When (UTC)</th>
              <th>Who</th>
              <th>Tool</th>
              <th>Details</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {activity.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  <div className="admin-empty">No assistant activity yet</div>
                </td>
              </tr>
            ) : (
              activity.map((a) => (
                <tr key={a.id}>
                  <td>{a.created_at}</td>
                  <td>
                    {a.actor}
                    {a.role ? ` (${ROLE_LABEL[a.role] ?? a.role})` : ""}
                  </td>
                  <td>
                    <code>{a.tool}</code>
                  </td>
                  <td style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {a.args ? JSON.stringify(a.args) : ""}
                  </td>
                  <td title={a.error ?? ""}>{a.ok ? `ok · ${a.duration_ms} ms` : `failed: ${(a.error ?? "").slice(0, 60)}`}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
