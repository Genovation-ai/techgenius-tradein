import { useCallback, useEffect, useState } from "react";
import { adminFetch, getAdminUser } from "../api";

interface TeamUser {
  id: string;
  email: string;
  name: string;
  role: string;
  enabled: number;
  created_at?: string;
}

export function TeamPage() {
  const me = getAdminUser();
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ email: "", name: "", password: "", role: "operator" });

  const load = useCallback(() => {
    adminFetch<{ users: TeamUser[]; roles: string[] }>("/api/team")
      .then((data) => {
        setUsers(data.users);
        setRoles(data.roles);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await adminFetch("/api/team", { method: "POST", body: JSON.stringify(form) });
      setForm({ email: "", name: "", password: "", role: "operator" });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    }
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    try {
      await adminFetch(`/api/team/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    }
  };

  return (
    <>
      <h1 className="admin-page-title">Team & permissions</h1>
      <p className="admin-section-lead">
        Admin, Manager, and Operator roles control access to pricing, settings, and team management.
        Signed in as {me?.email} ({me?.role}).
      </p>
      {error ? <p className="admin-error">{error}</p> : null}

      <form className="admin-pricing-form" onSubmit={(e) => void create(e)} style={{ maxWidth: 640 }}>
        <h2 className="admin-section-title">Add staff user</h2>
        <input
          className="admin-input"
          placeholder="Name"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          required
        />
        <input
          className="admin-input"
          placeholder="Email"
          type="email"
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          required
        />
        <input
          className="admin-input"
          placeholder="Password (min 8)"
          type="password"
          value={form.password}
          onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
          required
          minLength={8}
        />
        <select
          className="admin-select"
          value={form.role}
          onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
        >
          {(roles.length ? roles : ["admin", "manager", "operator"]).map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <button type="submit" className="admin-btn">
          Create user
        </button>
      </form>

      <div className="admin-table-wrap" style={{ marginTop: "1.25rem" }}>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>
                  <select
                    className="admin-select"
                    value={u.role}
                    onChange={(e) => void patch(u.id, { role: e.target.value })}
                  >
                    {(roles.length ? roles : ["admin", "manager", "operator"]).map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <span className={`admin-status-pill ${u.enabled ? "is-active" : "is-muted"}`}>
                    {u.enabled ? "Enabled" : "Disabled"}
                  </span>
                </td>
                <td>
                  <button
                    type="button"
                    className="admin-btn admin-btn--ghost admin-btn--sm"
                    onClick={() => void patch(u.id, { enabled: u.enabled ? 0 : 1 })}
                  >
                    {u.enabled ? "Disable" : "Enable"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
