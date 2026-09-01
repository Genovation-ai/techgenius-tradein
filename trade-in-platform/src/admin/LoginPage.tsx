import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { loginAdmin } from "./api";
import { TgMark } from "../components/BrandIcons";
import "./admin.css";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await loginAdmin(email.trim(), password);
      navigate("/admin", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid email or password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-login">
      <section className="admin-login-left">
        <div className="admin-login-brand-row">
          <TgMark size={22} />
          Trade-In SaaS
        </div>
        <h1>Sign in</h1>
        <form onSubmit={(e) => void login(e)}>
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@yourshop.com"
              autoComplete="username"
              required
              autoFocus
            />
          </label>
          <label>
            Password
            <div className="admin-login-pw">
              <input
                type={showPw ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Your password"
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                className="admin-pw-toggle"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? "Hide password" : "Show password"}
              >
                {showPw ? "Hide" : "Show"}
              </button>
            </div>
          </label>
          <div className="admin-login-row">
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 400 }}>
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              Remember me
            </label>
          </div>
          {error ? <p className="admin-error">{error}</p> : null}
          <button type="submit" className="admin-btn" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="admin-login-hint">
          New shop? <Link to="/admin/signup">Start a free trial</Link>
        </p>
      </section>

      <section className="admin-login-right">
        <h2>Trade-in ops for every shop</h2>
        <div className="admin-login-preview" aria-hidden>
          <div className="admin-login-preview-top">
            <i /><i /><i />
          </div>
          <div className="admin-login-mini-grid">
            {[
              "Active Leads",
              "In Transit",
              "Delivered",
              "Inspected",
              "Hold",
              "Payout",
              "Completed",
              "Revised",
              "Returned",
            ].map((t) => (
              <div key={t}>{t}</div>
            ))}
          </div>
        </div>
        <p>Offers, intake, and payouts in one place — multi-tenant and ready to white-label.</p>
      </section>
    </div>
  );
}
