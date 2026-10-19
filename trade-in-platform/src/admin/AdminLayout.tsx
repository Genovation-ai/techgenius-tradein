import { NavLink, Navigate, Outlet, useNavigate } from "react-router-dom";
import { openAdminTour, WelcomeTour } from "./WelcomeTour";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { adminFetch, clearAdminSession, getAdminApiKey, getAdminOrg, getAdminUser, logoutAdmin, setAdminChannelPreference } from "./api";
import {
  NavBell,
  NavBulk,
  NavCatalog,
  NavClose,
  NavCollapse,
  NavCustomers,
  NavDashboard,
  NavExpand,
  NavInventory,
  NavInvoice,
  NavMenu,
  NavOffers,
  NavPayout,
  NavPricing,
  NavReports,
  NavSearch,
  NavSettings,
  NavShip,
  NavTeam,
  TgMark,
} from "../components/BrandIcons";
import "./admin.css";

type NavItem = { to: string; icon: ReactNode; text: string; end?: boolean; cap?: string };
type NavGroup = { label: string; items: NavItem[] };

const CHANNEL_KEY = "tg-admin-channel";
/** Versioned with api.ts — see the note there. */
const STORE_KEY = "tg-admin-store-v2";

const nav: NavGroup[] = [
  {
    label: "Main",
    items: [
      { to: "/admin", end: true, icon: <NavDashboard />, text: "Dashboard", cap: "dashboard:read" },
      { to: "/admin/setup", icon: <NavSettings />, text: "Connect your site" },
    ],
  },
  {
    label: "Operations",
    items: [
      { to: "/admin/offers", icon: <NavOffers />, text: "Offer Management", cap: "offers:read" },
      { to: "/admin/repairs", icon: <NavOffers />, text: "Repairs", cap: "offers:read" },
      { to: "/admin/leads", icon: <NavOffers />, text: "Follow-ups", cap: "offers:read" },
      { to: "/admin/shipping", icon: <NavShip />, text: "Shipping", cap: "shipping:write" },
      { to: "/admin/payouts", icon: <NavPayout />, text: "Payouts", cap: "payouts:read" },
      { to: "/admin/bulk", icon: <NavBulk />, text: "Bulk / Hand-off", cap: "bulk:quote" },
    ],
  },
  {
    label: "Management",
    items: [
      { to: "/admin/inventory", icon: <NavInventory />, text: "Inventory", cap: "inventory:read" },
      { to: "/admin/invoices", icon: <NavInvoice />, text: "Invoices", cap: "invoices:read" },
      { to: "/admin/catalog", icon: <NavCatalog />, text: "Catalog", cap: "catalog:read" },
      { to: "/admin/pricing", icon: <NavPricing />, text: "Pricing", cap: "pricing:read" },
      { to: "/admin/customers", icon: <NavCustomers />, text: "Customers", cap: "customers:read" },
      { to: "/admin/reports", icon: <NavReports />, text: "Reports", cap: "reports:read" },
      { to: "/admin/team", icon: <NavTeam />, text: "Team", cap: "team:read" },
    ],
  },
  {
    label: "Support",
    items: [
      { to: "/admin/billing", icon: <NavSettings />, text: "Plan & billing", cap: "settings:read" },
      { to: "/admin/settings", icon: <NavSettings />, text: "Settings", cap: "settings:read" },
    ],
  },
];

type SearchHit = {
  q: string;
  offers: Array<{ id: string; status: string; total_value: number; first_name?: string; last_name?: string; email?: string }>;
  customers: Array<{ id: string; first_name: string; last_name: string; email?: string }>;
  inventory: Array<{ id: string; device_name: string; status: string }>;
  devices: Array<{ id: string; name: string }>;
};

type NotifSummary = {
  total: number;
  recent: Array<{ id: number; offer_id: string; subject: string; sent_at: string; channel: string }>;
};

export function AdminLayout() {
  const key = getAdminApiKey();
  const user = getAdminUser();
  const cachedOrg = getAdminOrg();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [channel, setChannel] = useState(() => localStorage.getItem(CHANNEL_KEY) || "mail-in");
  /**
   * "" means every location.
   *
   * This defaulted to the literal id "tg-burlington". Offers are filed by the
   * backend under the org's first store, which on this account is "tg-shop", so
   * the owner opened Offer Management filtered to a location no offer had ever
   * been written to and saw an empty board — while offers were arriving fine.
   * Any other tenant fared worse: "tg-burlington" is not one of their stores at
   * all. Showing everything until someone chooses a location cannot hide work.
   */
  const [store, setStore] = useState(() => localStorage.getItem(STORE_KEY) ?? "");
  const [stores, setStores] = useState<Array<{ id: string; name: string }>>([]);
  const [orgName, setOrgName] = useState(cachedOrg?.name || "Gadget Swap");
  const [orgPlan, setOrgPlan] = useState(cachedOrg?.plan || "starter");
  const [searchQ, setSearchQ] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchHits, setSearchHits] = useState<SearchHit | null>(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifs, setNotifs] = useState<NotifSummary | null>(null);
  const [caps, setCaps] = useState<string[] | null>(null);
  const searchTimer = useRef<number | null>(null);
  const searchWrap = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth > 960) setMobileOpen(false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    setAdminChannelPreference(channel);
    window.dispatchEvent(new CustomEvent("tg-admin-channel", { detail: channel }));
  }, [channel]);

  useEffect(() => {
    localStorage.setItem(STORE_KEY, store);
    window.dispatchEvent(new CustomEvent("tg-admin-store", { detail: store }));
  }, [store]);

  useEffect(() => {
    adminFetch<{
      org: { name: string; plan: string; slug: string };
      branding: { company_name?: string; brand_color?: string };
      stores: Array<{ id: string; name: string }>;
    }>("/api/saas/org")
      .then((data) => {
        setOrgName(data.branding?.company_name || data.org.name);
        setOrgPlan(data.org.plan);
        setStores(data.stores || []);
        // Functional update: reads the current store without making it a
        // dependency, so this stays a mount-once fetch instead of re-running
        // (and re-fetching the org) every time staff switch location.
        // Only correct a stored choice that no longer exists; "" is a valid
        // choice meaning all locations, so it is left alone.
        setStore((current) =>
          current && data.stores?.length && !data.stores.some((s) => s.id === current)
            ? ""
            : current,
        );
        document.documentElement.style.setProperty("--admin-brand", data.branding?.brand_color || "#0B3D2E");
      })
      .catch(() => {
        // No invented locations: a tenant whose org call failed should see the
        // all-locations view, not another shop's store names.
        setStores([]);
      });
  }, []);

  const loadNotifs = useCallback(() => {
    adminFetch<NotifSummary>("/api/notifications/summary")
      .then(setNotifs)
      .catch(() => setNotifs(null));
  }, []);

  useEffect(() => {
    loadNotifs();
    const t = window.setInterval(loadNotifs, 30000);
    return () => window.clearInterval(t);
  }, [loadNotifs]);

  useEffect(() => {
    adminFetch<{ capabilities: string[]; role: string }>("/api/team/me/capabilities")
      .then((data) => setCaps(data.capabilities))
      .catch(() => setCaps(null));
  }, []);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!searchWrap.current?.contains(e.target as Node)) setSearchOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const runSearch = useCallback((q: string) => {
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    if (q.trim().length < 2) {
      setSearchHits(null);
      return;
    }
    searchTimer.current = window.setTimeout(() => {
      adminFetch<SearchHit>(`/api/search?q=${encodeURIComponent(q.trim())}`)
        .then((hits) => {
          setSearchHits(hits);
          setSearchOpen(true);
        })
        .catch(() => setSearchHits(null));
    }, 220);
  }, []);

  if (!key) return <Navigate to="/admin/login" replace />;

  const initials = (user?.name || user?.email || "TG")
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const signOut = async () => {
    try {
      await logoutAdmin();
    } catch {
      clearAdminSession();
    }
    navigate("/admin/login", { replace: true });
  };

  const shellClass = [
    "admin-shell",
    collapsed ? "is-collapsed" : "",
    mobileOpen ? "is-mobile-open" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const hitCount =
    (searchHits?.offers.length || 0) +
    (searchHits?.customers.length || 0) +
    (searchHits?.inventory.length || 0) +
    (searchHits?.devices.length || 0);

  return (
    <div className={shellClass}>
      {mobileOpen ? (
        <button
          type="button"
          className="admin-backdrop"
          aria-label="Close menu"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      <aside className="admin-sidebar" aria-label="Admin navigation">
        <div className="admin-menu-head">
          <div className="admin-brand-mark">
            <TgMark size={22} className="admin-brand-mark-icon" />
            <strong>{orgName}</strong>
          </div>
          <button
            type="button"
            className="admin-icon-btn admin-desktop-only"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? "Expand menu" : "Collapse menu"}
          >
            {collapsed ? <NavExpand /> : <NavCollapse />}
          </button>
          <button
            type="button"
            className="admin-icon-btn admin-mobile-only"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
          >
            <NavClose />
          </button>
        </div>

        <div className="admin-sidebar-controls">
          <label className="admin-field-label" htmlFor="tg-store">
            Store
          </label>
          <select
            id="tg-store"
            className="admin-store-select"
            value={store}
            onChange={(e) => setStore(e.target.value)}
            aria-label="Store"
          >
            <option value="">All locations</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <div className="admin-field-label" style={{ marginTop: "0.35rem", opacity: 0.75 }}>
            {/* The plan name arrives lowercase from the API and used to be hidden
                behind a text-transform. With labels in sentence case it has to be
                capitalised properly rather than shouted. */}
            Plan · {orgPlan ? orgPlan.charAt(0).toUpperCase() + orgPlan.slice(1) : "—"}
          </div>

          <label className="admin-field-label" htmlFor="tg-channel">
            Channel
          </label>
          <select
            id="tg-channel"
            className="admin-mailin-select"
            value={channel}
            onChange={(e) => {
              setChannel(e.target.value);
              navigate(`/admin/offers?type=${encodeURIComponent(e.target.value)}`);
            }}
            aria-label="Channel"
          >
            <option value="mail-in">Mail-In</option>
            <option value="drop-off">Drop-Off</option>
            <option value="all">All channels</option>
          </select>

          <button type="button" className="admin-tradein-btn" onClick={() => navigate("/")}>
            Trade-In Widget
          </button>
        </div>

        <WelcomeTour />
        {nav.map((group) => {
          const items = group.items.filter((item) => !item.cap || !caps || caps.includes(item.cap));
          if (!items.length) return null;
          return (
          <div key={group.label} className="admin-nav-group">
            <div className="admin-nav-label">{group.label}</div>
            <nav className="admin-nav">
              {items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  title={item.text}
                  onClick={() => setMobileOpen(false)}
                >
                  <span className="nav-ico" aria-hidden>
                    {item.icon}
                  </span>
                  <span className="nav-text">{item.text}</span>
                </NavLink>
              ))}
            </nav>
          </div>
          );
        })}

        <div className="admin-sidebar-foot">
          {user ? (
            <div className="admin-user-chip">
              <strong>{user.name}</strong>
              <span>
                {user.email} · {user.role}
              </span>
            </div>
          ) : null}
          {/* The tour used to be a first-run event and nothing else. Whoever
              actually wants the walkthrough — a new member of staff, an owner
              back after a month — arrives long after that moment has passed. */}
          <button type="button" className="admin-signout" onClick={openAdminTour}>
            Take the tour
          </button>
          <button type="button" className="admin-signout" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </aside>

      <div className="admin-column">
        <header className="admin-topbar">
          <button
            type="button"
            className="admin-icon-btn admin-mobile-only"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <NavMenu />
          </button>
          <div className="admin-search" ref={searchWrap}>
            <NavSearch />
            <input
              placeholder="Search offers, devices, customers…"
              aria-label="Search"
              value={searchQ}
              onChange={(e) => {
                setSearchQ(e.target.value);
                runSearch(e.target.value);
              }}
              onFocus={() => {
                if (searchHits) setSearchOpen(true);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && searchQ.trim().length >= 2) {
                  navigate(`/admin/offers?q=${encodeURIComponent(searchQ.trim())}`);
                  setSearchOpen(false);
                }
              }}
            />
            {searchOpen && searchHits ? (
              <div className="admin-search-panel" role="listbox">
                {hitCount === 0 ? (
                  <p className="admin-search-empty">No matches for “{searchHits.q}”</p>
                ) : (
                  <>
                    {searchHits.offers.length ? (
                      <div className="admin-search-group">
                        <div className="admin-search-group-label">Offers</div>
                        {searchHits.offers.map((o) => (
                          <button
                            key={o.id}
                            type="button"
                            className="admin-search-hit"
                            onClick={() => {
                              navigate(`/admin/offers/${encodeURIComponent(o.id)}`);
                              setSearchOpen(false);
                            }}
                          >
                            <strong>{o.id}</strong>
                            <span>
                              {o.first_name} {o.last_name} · ${Number(o.total_value || 0)}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {searchHits.customers.length ? (
                      <div className="admin-search-group">
                        <div className="admin-search-group-label">Customers</div>
                        {searchHits.customers.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            className="admin-search-hit"
                            onClick={() => {
                              navigate(`/admin/customers?q=${encodeURIComponent(c.email || c.first_name)}`);
                              setSearchOpen(false);
                            }}
                          >
                            <strong>
                              {c.first_name} {c.last_name}
                            </strong>
                            <span>{c.email || c.id}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {searchHits.inventory.length ? (
                      <div className="admin-search-group">
                        <div className="admin-search-group-label">Inventory</div>
                        {searchHits.inventory.map((i) => (
                          <button
                            key={i.id}
                            type="button"
                            className="admin-search-hit"
                            onClick={() => {
                              navigate("/admin/inventory");
                              setSearchOpen(false);
                            }}
                          >
                            <strong>{i.device_name}</strong>
                            <span>{i.status}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {searchHits.devices.length ? (
                      <div className="admin-search-group">
                        <div className="admin-search-group-label">Catalog</div>
                        {searchHits.devices.map((d) => (
                          <button
                            key={d.id}
                            type="button"
                            className="admin-search-hit"
                            onClick={() => {
                              navigate(`/admin/catalog?q=${encodeURIComponent(d.name)}`);
                              setSearchOpen(false);
                            }}
                          >
                            <strong>{d.name}</strong>
                            <span>{d.id}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}
          </div>
          <div className="admin-top-actions">
            <div className="admin-notif-wrap">
              <button
                type="button"
                className="admin-icon-btn"
                aria-label="Notifications"
                onClick={() => {
                  setNotifOpen((v) => !v);
                  loadNotifs();
                }}
              >
                <NavBell />
                {notifs && notifs.total > 0 ? (
                  <span className="admin-notif-dot" aria-hidden>
                    {Math.min(notifs.total, 99)}
                  </span>
                ) : null}
              </button>
              {notifOpen ? (
                <div className="admin-notif-panel">
                  <div className="admin-notif-head">Notifications</div>
                  {!notifs?.recent?.length ? (
                    <p className="admin-search-empty">No events yet</p>
                  ) : (
                    notifs.recent.map((n) => (
                      <button
                        key={n.id}
                        type="button"
                        className="admin-search-hit"
                        onClick={() => {
                          navigate(`/admin/offers/${encodeURIComponent(n.offer_id)}`);
                          setNotifOpen(false);
                        }}
                      >
                        <strong>{n.subject}</strong>
                        <span>
                          {n.channel} · {n.sent_at}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </div>
            <div className="admin-avatar" title={user?.email || "Admin"}>
              {initials}
            </div>
          </div>
        </header>
        <main className="admin-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

