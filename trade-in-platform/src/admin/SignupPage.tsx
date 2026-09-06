import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { signupShop } from "./api";
import { TgMark } from "../components/BrandIcons";
import "./admin.css";

export function SignupPage() {
  const navigate = useNavigate();
  const [company, setCompany] = useState("");
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await signupShop({
        company_name: company.trim(),
        slug: slug.trim() || undefined,
        admin_name: name.trim() || "Owner",
        email: email.trim(),
        password,
        phone: phone.trim() || undefined,
      });
      setApiKey(res.api_key);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed");
    } finally {
      setLoading(false);
    }
  };

  if (apiKey) {
    return (
      <div className="admin-login">
        <section className="admin-login-left">
          <div className="admin-login-brand-row">
            <TgMark size={22} />
            Reclaim
          </div>
          <h1>Your shop is live</h1>
          <p className="admin-section-lead">
            Copy your widget API key now — it will not be shown again.
          </p>
          <code className="admin-input" style={{ display: "block", wordBreak: "break-all", padding: "0.75rem" }}>
            {apiKey}
          </code>
          <button type="button" className="admin-btn" style={{ marginTop: "1rem" }} onClick={() => navigate("/admin", { replace: true })}>
            Open admin
          </button>
        </section>
        <section className="admin-login-right">
          <h2>Sell trade-in as a service</h2>
          <p>Offers, intake, inventory, invoices, and a white-label widget — ready for your brand.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="admin-login">
      <section className="admin-login-left">
        <div className="admin-login-brand-row">
          <TgMark size={22} />
          Trade-In SaaS
        </div>
        <Link to="/" className="admin-login-back">Back to Reclaim</Link>
        <h1>Create your shop</h1>
        <p className="admin-section-lead">
          Take trade-ins on your own site in under a minute. No card needed to start.
        </p>
        <form onSubmit={(e) => void submit(e)}>
          <label>
            Company name
            <input
              value={company}
              onChange={(e) => {
                setCompany(e.target.value);
                if (!slug) setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
              }}
              placeholder="Acme Mobile"
              required
              autoFocus
            />
          </label>
          <label>
            Shop slug (widget URL key)
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
              placeholder="acme-mobile"
            />
          </label>
          <label>
            Your name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Alex Owner" />
          </label>
          <label>
            Work email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
          </label>
          <label>
            Phone
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 …" />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </label>
          {error ? <p className="admin-error">{error}</p> : null}
          <button type="submit" className="admin-btn" disabled={loading}>
            {loading ? "Creating…" : "Start free trial"}
          </button>
        </form>
        <p className="admin-login-hint">
          Already have a shop? <Link to="/admin/login">Sign in</Link>
        </p>
      </section>
      <section className="admin-login-right">
        <h2>Built to resell</h2>
        <div className="admin-login-preview" aria-hidden>
          <div className="admin-login-preview-top">
            <i /><i /><i />
          </div>
          <div className="admin-login-mini-grid">
            {["Org", "Stores", "Widget", "Keys", "Offers", "Inventory", "Invoices", "Team", "Brand"].map((t) => (
              <div key={t}>{t}</div>
            ))}
          </div>
        </div>
        <p>Multi-tenant isolation, white-label branding, and per-shop API keys — SaaS-ready.</p>
      </section>
    </div>
  );
}
