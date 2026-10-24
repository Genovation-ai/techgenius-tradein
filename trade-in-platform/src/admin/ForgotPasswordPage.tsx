import { useState } from "react";
import { Link } from "react-router-dom";
import { forgotPassword } from "./api";
import "../marketing/reclaim.css";
import "./admin.css";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await forgotPassword(email.trim());
      // Always show success — the server never reveals whether the email exists.
      setSent(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-login">
      <section className="admin-login-left">
        <div className="admin-login-brand-row">
          <span className="rc-auth-mark" aria-hidden />
          Gadget Swap
        </div>
        <Link to="/admin/login" className="admin-login-back">Back to sign in</Link>
        <h1>Reset your password</h1>
        {sent ? (
          <p style={{ lineHeight: 1.6 }}>
            If that email has an account, a reset link is on its way. It expires in an hour —
            check your inbox (and spam). You can close this page.
          </p>
        ) : (
          <form onSubmit={(e) => void submit(e)}>
            <p style={{ color: "#6b7280", marginTop: 0 }}>
              Enter your account email and we'll send you a link to set a new password.
            </p>
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
            <button type="submit" className="admin-btn" disabled={loading} style={{ marginTop: "0.75rem" }}>
              {loading ? "Sending…" : "Send reset link"}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
