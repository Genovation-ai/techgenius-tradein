import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { resetPassword } from "./api";
import "../marketing/reclaim.css";
import "./admin.css";

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      await resetPassword(token, password);
      setDone(true);
      setTimeout(() => navigate("/admin/login", { replace: true }), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset password.");
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
        <h1>Set a new password</h1>
        {!token ? (
          <p style={{ lineHeight: 1.6 }}>
            This link is missing its reset token. Please use the link from your email, or{" "}
            <Link to="/admin/forgot">request a new one</Link>.
          </p>
        ) : done ? (
          <p style={{ lineHeight: 1.6 }}>
            Your password has been changed. Taking you to sign in…
          </p>
        ) : (
          <form onSubmit={(e) => void submit(e)}>
            <label>
              New password
              <div className="admin-login-pw">
                <input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                  required
                  autoFocus
                />
                <button type="button" className="admin-login-pw-toggle" onClick={() => setShowPw((v) => !v)}>
                  {showPw ? "Hide" : "Show"}
                </button>
              </div>
            </label>
            <label>
              Confirm password
              <input
                type={showPw ? "text" : "password"}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Re-enter it"
                autoComplete="new-password"
                required
              />
            </label>
            {error ? <p style={{ color: "#c0392b", fontSize: "0.9rem" }}>{error}</p> : null}
            <button type="submit" className="admin-btn" disabled={loading} style={{ marginTop: "0.75rem" }}>
              {loading ? "Saving…" : "Set new password"}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
