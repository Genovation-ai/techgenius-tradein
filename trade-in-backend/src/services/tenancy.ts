/**
 * SaaS tenancy: orgs (paying shops) own stores, users, offers, and branding.
 * Platform catalog remains shared; ops data is org-scoped.
 */
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { nanoid } from "nanoid";
import type { Database } from "better-sqlite3";
import { getDb } from "../db/migrate.js";
import { orgWidgetTemplate } from "./widgetTemplate.js";

export const DEFAULT_ORG_ID = "org-tech-genius";
export const DEFAULT_ORG_SLUG = "tech-genius";

export interface OrgRow {
  id: string;
  slug: string;
  name: string;
  status: string;
  plan: string;
  created_at: string;
}

export interface OrgSettingsRow {
  org_id: string;
  company_name: string | null;
  company_phone: string | null;
  company_email: string | null;
  widget_brand_color: string | null;
  widget_cta_color: string | null;
  logo_url: string | null;
  payout_methods: string | null;
  offer_types: string | null;
}

export interface OrgStoreRow {
  id: string;
  org_id: string;
  name: string;
  address: string | null;
  phone: string | null;
  enabled: number;
}

export function slugifyOrg(raw: string): string {
  return (
    raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || `shop-${nanoid(6).toLowerCase()}`
  );
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString("hex");
}

export function makePasswordRecord(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${hashPassword(password, salt)}`;
}

export function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function generateApiKey(): { raw: string; prefix: string; hash: string } {
  const raw = `tg_live_${randomBytes(24).toString("base64url")}`;
  return { raw, prefix: raw.slice(0, 12), hash: hashApiKey(raw) };
}

/** Ensure SaaS tables exist and bootstrap Tech Genius as the first org. */
export function ensureSaasSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS orgs (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      plan TEXT NOT NULL DEFAULT 'starter',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS org_stores (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      name TEXT NOT NULL,
      address TEXT,
      phone TEXT,
      enabled INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS org_settings (
      org_id TEXT PRIMARY KEY REFERENCES orgs(id),
      company_name TEXT,
      company_phone TEXT,
      company_email TEXT,
      widget_brand_color TEXT,
      widget_cta_color TEXT,
      logo_url TEXT,
      payout_methods TEXT,
      offer_types TEXT
    );

    CREATE TABLE IF NOT EXISTS org_api_keys (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      name TEXT NOT NULL,
      key_prefix TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      role TEXT DEFAULT 'integration',
      enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      last_used_at TEXT
    );

    CREATE TABLE IF NOT EXISTS org_price_adjustments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      scope TEXT DEFAULT 'global',
      scope_id TEXT,
      adjust_percent REAL DEFAULT 0,
      adjust_amount REAL DEFAULT 0,
      condition_grade TEXT,
      enabled INTEGER DEFAULT 1
    );
  `);

  const userCols = new Set(
    (db.prepare("PRAGMA table_info(admin_users)").all() as Array<{ name: string }>).map((c) => c.name),
  );
  if (!userCols.has("org_id")) {
    db.exec("ALTER TABLE admin_users ADD COLUMN org_id TEXT");
  }

  // Per-org override for the widget template. NULL means "use the global
  // `frontend_template` setting" (see services/widgetTemplate.ts).
  const orgSettingCols = new Set(
    (db.prepare("PRAGMA table_info(org_settings)").all() as Array<{ name: string }>).map((c) => c.name),
  );
  if (orgSettingCols.size && !orgSettingCols.has("widget_template")) {
    db.exec("ALTER TABLE org_settings ADD COLUMN widget_template TEXT");
  }

  for (const table of ["offers", "inventory", "invoices", "customers", "uploads", "sales", "promo_codes", "notifications"] as const) {
    try {
      const cols = new Set(
        (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name),
      );
      if (cols.size && !cols.has("org_id")) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN org_id TEXT`);
      }
    } catch {
      /* table may not exist yet */
    }
  }

  bootstrapDefaultOrg(db);
}

function bootstrapDefaultOrg(db: Database): void {
  const existing = db.prepare("SELECT id FROM orgs WHERE id = ?").get(DEFAULT_ORG_ID) as
    | { id: string }
    | undefined;
  if (!existing) {
    db.prepare(
      `INSERT INTO orgs (id, slug, name, status, plan) VALUES (?, ?, ?, 'active', 'growth')`,
    ).run(DEFAULT_ORG_ID, DEFAULT_ORG_SLUG, "Tech Genius");
  }

  db.prepare(
    `INSERT OR IGNORE INTO org_settings (
      org_id, company_name, company_phone, company_email,
      widget_brand_color, widget_cta_color, payout_methods, offer_types
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    DEFAULT_ORG_ID,
    "Tech Genius",
    "+1 (289) 455-5556",
    "hello@techgenius.ca",
    "#0B3D2E",
    "#C45C26",
    JSON.stringify(["etransfer", "store-credit", "cash", "paypal"]),
    JSON.stringify(["mail-in", "drop-off"]),
  );

  const storeCount = db
    .prepare("SELECT COUNT(*) AS c FROM org_stores WHERE org_id = ?")
    .get(DEFAULT_ORG_ID) as { c: number };
  if (!storeCount.c) {
    const insert = db.prepare(
      `INSERT OR IGNORE INTO org_stores (id, org_id, name, address, phone, enabled)
       VALUES (?, ?, ?, ?, ?, 1)`,
    );
    insert.run("tg-burlington", DEFAULT_ORG_ID, "Tech Genius Burlington", "Burlington, Ontario", "+1 (289) 455-5556");
    insert.run("tg-shop", DEFAULT_ORG_ID, "Shop Tech Genius", "Ontario", null);
  }

  // Attach legacy rows to default org
  db.prepare("UPDATE admin_users SET org_id = ? WHERE org_id IS NULL").run(DEFAULT_ORG_ID);
  for (const table of ["offers", "inventory", "invoices", "customers", "uploads", "sales", "promo_codes", "notifications"]) {
    try {
      db.prepare(`UPDATE ${table} SET org_id = ? WHERE org_id IS NULL`).run(DEFAULT_ORG_ID);
    } catch {
      /* ignore */
    }
  }
}

export function getOrgById(db: Database, orgId: string): OrgRow | undefined {
  return db.prepare("SELECT * FROM orgs WHERE id = ?").get(orgId) as OrgRow | undefined;
}

export function getOrgBySlug(db: Database, slug: string): OrgRow | undefined {
  return db
    .prepare("SELECT * FROM orgs WHERE LOWER(slug) = LOWER(?) AND status != 'suspended'")
    .get(slug) as OrgRow | undefined;
}

export function getOrgSettings(db: Database, orgId: string): OrgSettingsRow | undefined {
  return db.prepare("SELECT * FROM org_settings WHERE org_id = ?").get(orgId) as
    | OrgSettingsRow
    | undefined;
}

export function listOrgStores(db: Database, orgId: string, enabledOnly = false): OrgStoreRow[] {
  if (enabledOnly) {
    return db
      .prepare("SELECT * FROM org_stores WHERE org_id = ? AND enabled = 1 ORDER BY name")
      .all(orgId) as OrgStoreRow[];
  }
  return db
    .prepare("SELECT * FROM org_stores WHERE org_id = ? ORDER BY name")
    .all(orgId) as OrgStoreRow[];
}

export function createOrganization(input: {
  companyName: string;
  slug?: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
  phone?: string;
  plan?: string;
}): {
  org: OrgRow;
  store: OrgStoreRow;
  admin: { id: string; email: string; name: string; role: string };
  apiKey: string;
} {
  const db = getDb();
  try {
    const companyName = input.companyName.trim();
    const email = input.adminEmail.trim().toLowerCase();
    if (!companyName || companyName.length < 2) throw new Error("Company name is required");
    if (!email.includes("@")) throw new Error("Valid admin email is required");
    if (input.adminPassword.length < 8) throw new Error("Password must be at least 8 characters");

    let slug = slugifyOrg(input.slug || companyName);
    const clash = db.prepare("SELECT id FROM orgs WHERE slug = ?").get(slug);
    if (clash) slug = `${slug}-${nanoid(4).toLowerCase()}`;

    const userClash = db.prepare("SELECT id FROM admin_users WHERE email = ?").get(email);
    if (userClash) throw new Error("An account with that email already exists");

    const orgId = `org-${nanoid(10)}`;
    const storeId = `store-${nanoid(8)}`;
    const userId = nanoid(12);
    const key = generateApiKey();

    db.prepare(
      `INSERT INTO orgs (id, slug, name, status, plan) VALUES (?, ?, ?, 'trial', ?)`,
    ).run(orgId, slug, companyName, input.plan || "starter");

    db.prepare(
      `INSERT INTO org_settings (
        org_id, company_name, company_phone, company_email,
        widget_brand_color, widget_cta_color, payout_methods, offer_types
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      orgId,
      companyName,
      input.phone || null,
      email,
      "#0B3D2E",
      "#C45C26",
      JSON.stringify(["etransfer", "store-credit", "cash"]),
      JSON.stringify(["mail-in", "drop-off"]),
    );

    db.prepare(
      `INSERT INTO org_stores (id, org_id, name, address, phone, enabled) VALUES (?, ?, ?, NULL, ?, 1)`,
    ).run(storeId, orgId, `${companyName} Main`, input.phone || null);

    db.prepare(
      `INSERT INTO admin_users (id, email, password_hash, name, role, org_id, enabled)
       VALUES (?, ?, ?, ?, 'admin', ?, 1)`,
    ).run(userId, email, makePasswordRecord(input.adminPassword), input.adminName.trim() || "Owner", orgId);

    db.prepare(
      `INSERT INTO org_api_keys (id, org_id, name, key_prefix, key_hash, role, enabled)
       VALUES (?, ?, ?, ?, ?, 'integration', 1)`,
    ).run(nanoid(12), orgId, "Default widget key", key.prefix, key.hash);

    // Starter promo for the new shop
    try {
      db.prepare(
        `INSERT INTO promo_codes (id, code, discount_percent, discount_amount, active, org_id)
         VALUES (?, 'WELCOME10', 10, 0, 1, ?)`,
      ).run(nanoid(10), orgId);
    } catch {
      /* promo table shape may differ */
    }

    const org = getOrgById(db, orgId)!;
    const store = listOrgStores(db, orgId)[0];
    return {
      org,
      store,
      admin: { id: userId, email, name: input.adminName.trim() || "Owner", role: "admin" },
      apiKey: key.raw,
    };
  } finally {
    db.close();
  }
}

export function findOrgApiKey(
  db: Database,
  rawKey: string,
): { org_id: string; id: string; role: string; name: string } | undefined {
  const hash = hashApiKey(rawKey);
  const row = db
    .prepare(
      `SELECT id, org_id, role, name FROM org_api_keys WHERE key_hash = ? AND enabled = 1`,
    )
    .get(hash) as { id: string; org_id: string; role: string; name: string } | undefined;
  if (row) {
    db.prepare("UPDATE org_api_keys SET last_used_at = datetime('now') WHERE id = ?").run(row.id);
  }
  return row;
}

export function publicWidgetConfig(orgSlug: string) {
  const db = getDb();
  try {
    const org = getOrgBySlug(db, orgSlug);
    if (!org) return null;
    const settings = getOrgSettings(db, org.id);
    const stores = listOrgStores(db, org.id, true).map((s) => ({
      id: s.id,
      name: s.name,
      address: s.address,
      phone: s.phone,
    }));
    return {
      org_id: org.id,
      slug: org.slug,
      plan: org.plan,
      status: org.status,
      company_name: settings?.company_name || org.name,
      company_phone: settings?.company_phone || null,
      company_email: settings?.company_email || null,
      brand_color: settings?.widget_brand_color || "#0B3D2E",
      cta_color: settings?.widget_cta_color || "#C45C26",
      logo_url: settings?.logo_url || null,
      template: orgWidgetTemplate(db, org.id),
      payout_methods: safeJson(settings?.payout_methods, ["etransfer", "store-credit", "cash"]),
      offer_types: safeJson(settings?.offer_types, ["mail-in", "drop-off"]),
      stores,
      embed: {
        script_hint: `<script src="https://YOUR_HOST/embed.js" data-org="${org.slug}"></script>`,
        api_org_header: "x-org-slug",
      },
    };
  } finally {
    db.close();
  }
}

function safeJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Constant-time compare helper exported for API key checks */
export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) {
    timingSafeEqual(ba, ba);
    return false;
  }
  return timingSafeEqual(ba, bb);
}
