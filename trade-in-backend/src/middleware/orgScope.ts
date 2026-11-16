import type { NextFunction, Request, Response } from "express";
import type { Database } from "better-sqlite3";
import { DEFAULT_ORG_ID } from "../services/tenancy.js";

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

/**
 * Ownership check for an offer addressed by id. Child records (labels,
 * invoices, payouts, history) inherit the offer's tenant, so every route that
 * takes an offer id goes through this before reading or writing.
 */
export function ownsOffer(db: Database, req: Request, offerId: string): boolean {
  const row = db.prepare("SELECT org_id FROM offers WHERE id = ?").get(offerId) as
    | { org_id: string | null }
    | undefined;
  return ownsRow(req, row);
}

/**
 * Pricing rules, the price table, shop settings, the catalogue and the
 * scrapers have no org_id: they belong to the home shop. Free signup hands any
 * visitor an admin session on their own tenant, and that session carried
 * pricing:write and settings:write, so a stranger could rewrite the live
 * pricing rule or the shop's ship-to address. Writes to those shared tables are
 * reserved for the home org (its staff sessions and the master key).
 */
export function requireHomeOrg(req: Request, res: Response, next: NextFunction) {
  if (req.tgAuth?.orgId === DEFAULT_ORG_ID) return next();
  return res.status(403).json({ error: "This setting is managed by the platform operator." });
}

/** requireHomeOrg for anything that is not a read. */
export function homeOrgForWrites(req: Request, res: Response, next: NextFunction) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  return requireHomeOrg(req, res, next);
}
