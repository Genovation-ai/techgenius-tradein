import { useEffect, useState } from "react";
import { HowThisWorks } from "../HowThisWorks";
import { adminFetch } from "../api";

/**
 * What the shop is on, what they have used, and what happens next.
 *
 * A shop that has to email us to add a store is not buying software, it is
 * retaining a consultant. This is the page that makes it a subscription: the
 * plan, the usage against the limits that will actually refuse them, and a
 * button that changes it without anybody being asked.
 */

interface Usage {
  plan: {
    id: string;
    name: string;
    price: number;
    status: string;
    trial_ends_at: string | null;
    region: string;
  };
  limits: {
    stores: { used: number; included: number; per_extra: number };
    offers_this_month: { used: number; included: number | null };
  };
  billing: { this_month: number };
  activity: { offers_7d: number; offers_30d: number; offer_value_this_month: number };
}

interface PlanRow {
  id: string;
  name: string;
  price: number;
  pitch: string;
  stores: number;
  per_extra_store: number;
  offers_per_month: number | null;
  features: string[];
}

const FEATURE_LABEL: Record<string, string> = {
  repairs: "Repair quoting",
  own_branding: "Your name, not ours",
  promo_codes: "Promo codes",
  market_pricing: "Live competitor pricing",
  reports: "Reports",
  api_access: "API and webhooks",
  bulk_quote: "Bulk quoting",
  ai_scan: "Photo condition scan",
};

/** Plain words for a state the shop did not choose. */
const STATUS_TEXT: Record<string, { label: string; tone: string; line: string }> = {
  trialing: { label: "Trial", tone: "warn", line: "Your trial is running. Add a card any time to keep going." },
  active: { label: "Active", tone: "ok", line: "Everything is running normally." },
  past_due: {
    label: "Payment failed",
    tone: "bad",
    line: "New offers are paused. Everything you already have is still here — update your card and it starts again straight away.",
  },
  cancelled: {
    label: "Cancelled",
    tone: "bad",
    line: "Your subscription has ended. Your data is kept for 90 days, so resubscribing restores it exactly as it was.",
  },
};

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso.replace(" ", "T") + "Z").getTime() - Date.now();
  return Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / 86_400_000)) : null;
}

export function BillingPage() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    adminFetch<Usage>("/api/saas/usage")
      .then(setUsage)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load your plan"));
    adminFetch<{ plans: PlanRow[] }>("/api/saas/plans")
      .then((d) => setPlans(d.plans || []))
      .catch(() => setPlans([]));
  }, []);

  const go = async (plan: string) => {
    setBusy(plan);
    setError(null);
    try {
      const out = await adminFetch<{ url: string }>("/api/saas/billing/checkout", {
        method: "POST",
        body: JSON.stringify({ plan }),
      });
      window.location.href = out.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start checkout");
      setBusy(null);
    }
  };

  const portal = async () => {
    setBusy("portal");
    setError(null);
    try {
      const out = await adminFetch<{ url: string }>("/api/saas/billing/portal", { method: "POST" });
      window.location.href = out.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open the billing portal");
      setBusy(null);
    }
  };

  const status = usage ? (STATUS_TEXT[usage.plan.status] ?? STATUS_TEXT.active) : null;
  const trialDays = daysUntil(usage?.plan.trial_ends_at ?? null);
  const offers = usage?.limits.offers_this_month;
  const offerPct =
    offers?.included && offers.included > 0
      ? Math.min(100, Math.round((offers.used / offers.included) * 100))
      : null;

  return (
    <>
      <div className="admin-header-row">
        <h1 className="admin-page-title" style={{ margin: 0 }}>
          Plan &amp; billing
        </h1>
      </div>

      <HowThisWorks
        label="What this page is for"
        steps={[
          "Your plan, what you have used this month, and what the next invoice comes to.",
          "Changing plan takes effect immediately. A downgrade applies at the end of the period you have paid for.",
          "We never see your card. The card details are entered on your payment provider's own page.",
        ]}
      />

      {error ? <div className="admin-error">{error}</div> : null}

      {usage ? (
        <>
          <section className="admin-card" style={{ marginBottom: 16 }}>
            <div
              style={{
                display: "flex",
                gap: 16,
                alignItems: "baseline",
                flexWrap: "wrap",
                justifyContent: "space-between",
              }}
            >
              <div>
                <div style={{ fontSize: "1.4rem", fontWeight: 700 }}>
                  {usage.plan.name}
                  <span style={{ fontWeight: 400, opacity: 0.7 }}> · ${usage.plan.price}/month</span>
                </div>
                <div style={{ marginTop: 4, opacity: 0.8 }}>
                  {status?.line}
                  {usage.plan.status === "trialing" && trialDays !== null
                    ? ` ${trialDays} ${trialDays === 1 ? "day" : "days"} left.`
                    : ""}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: "0.8rem", opacity: 0.7 }}>This month</div>
                <div style={{ fontSize: "1.6rem", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                  ${usage.billing.this_month}
                </div>
              </div>
            </div>
          </section>

          <section className="admin-card" style={{ marginBottom: 16 }}>
            <h2 style={{ marginTop: 0, fontSize: "1rem" }}>What you have used</h2>
            <div style={{ display: "grid", gap: 14 }}>
              <UsageBar
                label="Stores"
                used={usage.limits.stores.used}
                included={usage.limits.stores.included}
                note={`Each extra store is $${usage.limits.stores.per_extra} a month.`}
              />
              <UsageBar
                label="Offers this month"
                used={offers?.used ?? 0}
                included={offers?.included ?? null}
                pct={offerPct}
                note={offers?.included ? "Resets on the 1st." : "No limit on your plan."}
              />
            </div>
            <div style={{ marginTop: 14, display: "flex", gap: 24, flexWrap: "wrap", opacity: 0.85 }}>
              <span>
                <strong>{usage.activity.offers_7d}</strong> offers in 7 days
              </span>
              <span>
                <strong>{usage.activity.offers_30d}</strong> in 30 days
              </span>
              <span>
                <strong>${Math.round(usage.activity.offer_value_this_month).toLocaleString()}</strong>{" "}
                quoted this month
              </span>
            </div>
          </section>

          <section className="admin-card">
            <h2 style={{ marginTop: 0, fontSize: "1rem" }}>Change plan</h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
                gap: 12,
                marginTop: 10,
              }}
            >
              {plans.map((p) => {
                const current = p.id === usage.plan.id;
                return (
                  <div
                    key={p.id}
                    className="admin-card"
                    style={{ margin: 0, outline: current ? "2px solid var(--brand-primary)" : undefined }}
                  >
                    <div style={{ fontWeight: 700 }}>{p.name}</div>
                    <div style={{ fontSize: "1.5rem", fontWeight: 700, margin: "4px 0" }}>
                      ${p.price}
                      <span style={{ fontSize: "0.85rem", fontWeight: 400, opacity: 0.7 }}>/month</span>
                    </div>
                    <div style={{ fontSize: "0.85rem", opacity: 0.8, minHeight: "2.6em" }}>{p.pitch}</div>
                    <ul style={{ fontSize: "0.85rem", paddingLeft: "1.1rem", margin: "8px 0" }}>
                      <li>
                        {p.stores} {p.stores === 1 ? "store" : "stores"}
                      </li>
                      <li>{p.offers_per_month ? `${p.offers_per_month} offers a month` : "Unlimited offers"}</li>
                      {p.features.map((f) => (
                        <li key={f}>{FEATURE_LABEL[f] ?? f}</li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ width: "100%" }}
                      disabled={current || busy !== null}
                      onClick={() => void go(p.id)}
                    >
                      {current ? "Your plan" : busy === p.id ? "Opening…" : `Switch to ${p.name}`}
                    </button>
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: 14 }}>
              <button type="button" className="btn" disabled={busy !== null} onClick={() => void portal()}>
                {busy === "portal" ? "Opening…" : "Update card or cancel"}
              </button>
            </div>
          </section>
        </>
      ) : !error ? (
        <p>Loading your plan…</p>
      ) : null}
    </>
  );
}

/** Used against included, as a bar, because a number alone does not say "nearly". */
function UsageBar({
  label,
  used,
  included,
  note,
  pct,
}: {
  label: string;
  used: number;
  included: number | null;
  note?: string;
  pct?: number | null;
}) {
  const ratio = pct ?? (included && included > 0 ? Math.min(100, Math.round((used / included) * 100)) : null);
  const tight = ratio !== null && ratio >= 80;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.9rem" }}>
        <span>{label}</span>
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          {used}
          {included !== null ? ` / ${included}` : ""}
        </span>
      </div>
      {ratio !== null ? (
        <div
          style={{
            height: 6,
            borderRadius: 999,
            background: "var(--bg-surface-muted, #EEE)",
            marginTop: 6,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${ratio}%`,
              height: "100%",
              background: tight ? "var(--color-warning, #B8860B)" : "var(--brand-primary, #AF5424)",
            }}
          />
        </div>
      ) : null}
      {note ? <div style={{ fontSize: "0.8rem", opacity: 0.7, marginTop: 4 }}>{note}</div> : null}
    </div>
  );
}
