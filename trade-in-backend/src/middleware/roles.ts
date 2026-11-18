export type StaffRole = "admin" | "manager" | "operator";

export const STAFF_ROLES: StaffRole[] = ["admin", "manager", "operator"];

/** Capability keys used by requireCapability middleware. */
export type Capability =
  | "dashboard:read"
  | "offers:read"
  | "offers:write"
  | "offers:handoff"
  | "customers:read"
  | "customers:write"
  | "inventory:read"
  | "inventory:write"
  | "inventory:sell"
  | "catalog:read"
  | "catalog:write"
  | "pricing:read"
  | "pricing:write"
  | "reports:read"
  | "settings:read"
  | "settings:write"
  | "team:read"
  | "team:write"
  | "invoices:read"
  | "invoices:write"
  | "payouts:read"
  | "payouts:write"
  | "shipping:write"
  | "uploads:write"
  | "bulk:quote"
  | "scraper:run"
  | "notifications:read"
  | "search:read"
  | "crm:dispatch";

const ALL: Capability[] = [
  "dashboard:read",
  "offers:read",
  "offers:write",
  "offers:handoff",
  "customers:read",
  "customers:write",
  "inventory:read",
  "inventory:write",
  "inventory:sell",
  "catalog:read",
  "catalog:write",
  "pricing:read",
  "pricing:write",
  "reports:read",
  "settings:read",
  "settings:write",
  "team:read",
  "team:write",
  "invoices:read",
  "invoices:write",
  "payouts:read",
  "payouts:write",
  "shipping:write",
  "uploads:write",
  "bulk:quote",
  "scraper:run",
  "notifications:read",
  "search:read",
  "crm:dispatch",
];

const ROLE_CAPS: Record<StaffRole, Set<Capability>> = {
  admin: new Set(ALL),
  manager: new Set(
    ALL.filter((c) => c !== "team:write"), // managers cannot create/disable admins
  ),
  operator: new Set([
    "dashboard:read",
    "offers:read",
    "offers:write",
    "offers:handoff",
    "customers:read",
    "customers:write",
    "inventory:read",
    "inventory:write",
    "inventory:sell",
    "catalog:read",
    "reports:read",
    "invoices:read",
    "payouts:read",
    "payouts:write",
    "shipping:write",
    "uploads:write",
    "bulk:quote",
    "notifications:read",
    "search:read",
    "settings:read",
  ]),
};

/**
 * Read-only access for API keys handed to analysts and AI assistants: every
 * *:read capability and nothing that changes data. Checked before
 * normalizeRole, which maps unknown roles to admin for legacy staff rows.
 */
const VIEWER_CAPS = new Set<Capability>(ALL.filter((c) => c.endsWith(":read")));

export function normalizeRole(role: string | undefined | null): StaffRole {
  if (role === "manager" || role === "operator" || role === "admin") return role;
  return "admin";
}

export function roleHasCapability(role: string | undefined | null, cap: Capability): boolean {
  // Master API key / legacy keys act as admin
  if (role === "master") return true;
  if (role === "viewer") return VIEWER_CAPS.has(cap);
  const r = normalizeRole(role);
  return ROLE_CAPS[r].has(cap);
}

export function capabilitiesForRole(role: string | undefined | null): Capability[] {
  if (role === "master") return [...ALL];
  if (role === "viewer") return [...VIEWER_CAPS];
  return [...ROLE_CAPS[normalizeRole(role)]];
}
