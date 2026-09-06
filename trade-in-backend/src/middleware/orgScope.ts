import type { Request } from "express";

/**
 * Tenant scoping for raw SQL.
 *
 * Every table holding customer or commercial data carries an org_id, but the
 * filtering was applied query by query and several routes simply never got it —
 * one tenant could read another's customers, invoices, uploads and dashboard
 * totals with nothing more than their own API key.
 *
 * Doing it by hand in forty places is how that happened, so scoping goes
 * through here instead. `orgFilter` returns a fragment to append and the
 * parameter to bind, in that order, for the common `WHERE 1=1 …` shape.
 *
 * When there is no org on the request the filter is empty. That is deliberate
 * and applies to exactly one caller: the master API key used by the operator's
 * own tooling and the smoke suite. A tenant key always carries an org, so a
 * tenant can never reach the unfiltered path.
 */
export function orgIdOf(req: Request): string | null {
  return req.tgAuth?.orgId ?? null;
}

export interface OrgFilter {
  /** SQL to append, already prefixed with " AND " — empty when unscoped. */
  sql: string;
  /** Params to push, in order. Empty when unscoped. */
  params: string[];
}

/**
 * @param alias table alias used in the query, e.g. "o" for `offers o`.
 *              Omit for an unaliased single-table query.
 */
export function orgFilter(req: Request, alias?: string): OrgFilter {
  const orgId = orgIdOf(req);
  if (!orgId) return { sql: "", params: [] };
  const col = alias ? `${alias}.org_id` : "org_id";
  return { sql: ` AND ${col} = ?`, params: [orgId] };
}

/**
 * Guard for single-record reads and writes addressed by id.
 *
 * A list endpoint filters rows out; a `GET /:id` has to check the row it just
 * loaded actually belongs to the caller, or knowing an id is enough to read
 * another tenant's record. Returns true when the row may be served.
 */
export function ownsRow(req: Request, row: { org_id?: unknown } | undefined): boolean {
  if (!row) return false;
  const orgId = orgIdOf(req);
  if (!orgId) return true; // master key
  const rowOrg = row.org_id == null ? null : String(row.org_id);
  return rowOrg === orgId;
}
