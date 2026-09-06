import { Router } from "express";
import { getDb } from "../db/migrate.js";
import { nanoid } from "nanoid";
import { requireCapability } from "../middleware/auth.js";
import { orgFilter, orgIdOf, ownsRow } from "../middleware/orgScope.js";
import { DEFAULT_ORG_ID } from "../services/tenancy.js";

export const customersRouter = Router();

customersRouter.get("/", requireCapability("customers:read"), (req, res) => {
  const db = getDb();
  const { status, q } = req.query;
  let sql = "SELECT * FROM customers WHERE 1=1";
  const params: unknown[] = [];
  const scope = orgFilter(req);
  sql += scope.sql;
  params.push(...scope.params);
  if (status) {
    sql += " AND status = ?";
    params.push(status);
  }
  if (q) {
    sql += " AND (first_name LIKE ? OR last_name LIKE ? OR email LIKE ?)";
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  sql += " ORDER BY created_at DESC LIMIT 100";
  const rows = db.prepare(sql).all(...params);
  db.close();
  res.json(rows);
});

customersRouter.get("/:id", requireCapability("customers:read"), (req, res) => {
  const db = getDb();
  const row = db.prepare("SELECT * FROM customers WHERE id = ?").get(req.params.id) as
    | { org_id?: unknown }
    | undefined;
  db.close();
  // 404 rather than 403 on someone else's record: confirming it exists would
  // leak that this customer is a customer of another shop on the platform.
  if (!row || !ownsRow(req, row)) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

customersRouter.post("/", requireCapability("customers:write"), (req, res) => {
  const db = getDb();
  const { first_name, last_name, email, phone, company, notes } = req.body;
  const id = nanoid(12);
  db.prepare(
    "INSERT INTO customers (id, first_name, last_name, email, phone, company, notes, org_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    id,
    first_name,
    last_name,
    email || null,
    phone || null,
    company || null,
    notes || null,
    orgIdOf(req) ?? DEFAULT_ORG_ID,
  );
  db.close();
  res.status(201).json({ id, first_name, last_name });
});

customersRouter.patch("/:id", requireCapability("customers:write"), (req, res) => {
  const db = getDb();
  const existing = db.prepare("SELECT org_id FROM customers WHERE id = ?").get(req.params.id) as
    | { org_id?: unknown }
    | undefined;
  if (!existing || !ownsRow(req, existing)) {
    db.close();
    return res.status(404).json({ error: "Not found" });
  }
  const { first_name, last_name, email, phone, company, status, notes } = req.body;
  db.prepare(
    `UPDATE customers SET
      first_name = COALESCE(?, first_name), last_name = COALESCE(?, last_name),
      email = COALESCE(?, email), phone = COALESCE(?, phone),
      company = COALESCE(?, company), status = COALESCE(?, status), notes = COALESCE(?, notes)
    WHERE id = ?`,
  ).run(first_name, last_name, email, phone, company, status, notes, req.params.id);
  db.close();
  res.json({ ok: true });
});
