/**
 * Selectable frontend templates for the customer widget.
 *
 * Mirrors the `frontend_price_source` pattern: a value lives in `settings`,
 * admin picks it, and the widget reads it and applies `data-template`.
 *
 * These are FIRST-PARTY presets. Each one is a layout/density/palette choice
 * expressed in our own tokens — no competitor CSS, markup, fonts or branding
 * is shipped. The ids keep the names used in the original spec so existing
 * notes still line up; the labels describe the layout, which is what a store
 * owner is actually choosing between.
 */
import type { Database } from "better-sqlite3";
import { getDb } from "../db/migrate.js";

export interface WidgetTemplate {
  id: string;
  label: string;
  description: string;
}

export const WIDGET_TEMPLATES: WidgetTemplate[] = [
  {
    id: "classic",
    label: "Classic (default)",
    description: "Warm local-shop styling: display headings, roomy cards, image-first device picker.",
  },
  {
    id: "guided",
    label: "Guided steps",
    description: "One question per screen with a prominent progress bar. Highest completion on mobile.",
  },
  {
    id: "dense",
    label: "Dense catalog",
    description: "Tighter grid and smaller tiles so more models fit above the fold.",
  },
  {
    id: "carrier",
    label: "Carrier blue",
    description: "Cool, corporate palette with flat cards and a fixed price bar.",
  },
  {
    id: "rounded",
    label: "Rounded friendly",
    description: "Soft radii, generous white space and large tap targets.",
  },
  {
    id: "console",
    label: "Ops console",
    description: "Neutral, data-forward styling that matches the staff admin console.",
  },
  {
    id: "minimal",
    label: "Minimal",
    description: "Near-unstyled: inherits the host page's type and colours. Best for tight brand control.",
  },
];

/**
 * Old ids named after the competitors whose layouts inspired them. They shipped
 * into the DOM as data-template="reusely_ops", which is not something to hand a
 * shop evaluating this product. Renamed to describe the look; these aliases keep
 * any tenant who already chose one on the same template.
 */
export const TEMPLATE_ALIASES: Record<string, string> = {
  techgenius: "classic",
  gorecell_step: "guided",
  univercell_sell: "dense",
  bell_trade: "carrier",
  telus_trade: "rounded",
  reusely_ops: "console",
};

export function canonicalTemplate(id: string | null | undefined): string {
  const raw = String(id || "").trim();
  if (!raw) return DEFAULT_TEMPLATE;
  return TEMPLATE_ALIASES[raw] ?? raw;
}

export const DEFAULT_TEMPLATE = "classic";

const SETTING_KEY = "frontend_template";

export function isWidgetTemplate(id: unknown): id is string {
  return typeof id === "string" && WIDGET_TEMPLATES.some((t) => t.id === id);
}

/** Global (single-tenant) template, falling back to the default. */
export function getWidgetTemplate(): string {
  const db = getDb();
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(SETTING_KEY) as
      | { value: string }
      | undefined;
    const resolved = canonicalTemplate(row?.value);
    return isWidgetTemplate(resolved) ? resolved : DEFAULT_TEMPLATE;
  } finally {
    db.close();
  }
}

export function setWidgetTemplate(id: string): string {
  if (!isWidgetTemplate(id)) {
    throw new Error(`Unknown template '${id}'`);
  }
  const db = getDb();
  try {
    db.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    ).run(SETTING_KEY, id);
    return id;
  } finally {
    db.close();
  }
}

/**
 * Template for a specific org, falling back to the global setting.
 * Takes an open db handle because tenancy callers already hold one.
 */
export function orgWidgetTemplate(db: Database, orgId: string): string {
  const row = db.prepare("SELECT widget_template FROM org_settings WHERE org_id = ?").get(orgId) as
    | { widget_template: string | null }
    | undefined;
  if (isWidgetTemplate(row?.widget_template)) return row!.widget_template as string;

  const global = db.prepare("SELECT value FROM settings WHERE key = ?").get(SETTING_KEY) as
    | { value: string }
    | undefined;
  const resolvedGlobal = canonicalTemplate(global?.value);
  return isWidgetTemplate(resolvedGlobal) ? resolvedGlobal : DEFAULT_TEMPLATE;
}
