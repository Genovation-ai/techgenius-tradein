import { Router } from "express";
import { nanoid } from "nanoid";
import { getDb } from "../db/migrate.js";
import { requireCapability } from "../middleware/auth.js";

export const invoicesRouter = Router();

function buildInvoiceFromOffer(db: ReturnType<typeof getDb>, offerId: string) {
  const offer = db
    .prepare(
      `SELECT o.*, c.first_name, c.last_name, c.email, c.phone
       FROM offers o LEFT JOIN customers c ON c.id = o.customer_id
       WHERE o.id = ?`,
    )
    .get(offerId) as Record<string, unknown> | undefined;
  if (!offer) return null;
  const items = db
    .prepare(
      `SELECT device_name, storage, condition_grade, quoted_price, final_price
       FROM offer_items WHERE offer_id = ?`,
    )
    .all(offerId) as Array<{
    device_name: string;
    storage?: string;
    condition_grade?: string;
    quoted_price: number;
    final_price?: number;
  }>;
  const lineItems = items.map((i) => ({
    description: `${i.device_name}${i.storage ? ` ${i.storage}` : ""}${i.condition_grade ? ` · ${i.condition_grade}` : ""}`,
    amount: Number(i.final_price ?? i.quoted_price ?? 0),
  }));
  const amount = lineItems.reduce((s, l) => s + l.amount, 0);
  return { offer, lineItems, amount };
}

invoicesRouter.get("/", requireCapability("invoices:read"), (req, res) => {
  const db = getDb();
  const store = req.query.store_id ? String(req.query.store_id) : null;
  let sql = `SELECT i.*, c.first_name, c.last_name, c.email
             FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id WHERE 1=1`;
  const params: unknown[] = [];
  if (store) {
    sql += " AND i.store_id = ?";
    params.push(store);
  }
  sql += " ORDER BY i.issued_at DESC LIMIT 200";
  const rows = db.prepare(sql).all(...params);
  db.close();
  res.json(rows);
});

invoicesRouter.get("/:id", requireCapability("invoices:read"), (req, res) => {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT i.*, c.first_name, c.last_name, c.email, c.phone
       FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
       WHERE i.id = ?`,
    )
    .get(req.params.id) as Record<string, unknown> | undefined;
  db.close();
  if (!row) return res.status(404).json({ error: "Not found" });
  const line_items = JSON.parse(String(row.line_items_json || "[]"));
  res.json({ ...row, line_items });
});

invoicesRouter.get("/:id/print", requireCapability("invoices:read"), (req, res) => {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT i.*, c.first_name, c.last_name, c.email, c.phone,
              s.value AS company_name_setting
       FROM invoices i
       LEFT JOIN customers c ON c.id = i.customer_id
       LEFT JOIN settings s ON s.key = 'company_name'
       WHERE i.id = ?`,
    )
    .get(req.params.id) as Record<string, unknown> | undefined;
  db.close();
  if (!row) return res.status(404).send("Invoice not found");
  const lines = JSON.parse(String(row.line_items_json || "[]")) as Array<{
    description: string;
    amount: number;
  }>;
  const company = String(row.company_name_setting || "Tech Genius Burlington");
  const html = `<!doctype html><html><head><meta charset="utf-8"/><title>${row.id}</title>
  <style>
    body{font-family:Georgia,serif;max-width:720px;margin:2rem auto;color:#222}
    h1{font-size:1.4rem;margin:0} .muted{color:#666;font-size:.9rem}
    table{width:100%;border-collapse:collapse;margin-top:1.5rem}
    th,td{padding:.55rem .4rem;border-bottom:1px solid #ddd;text-align:left}
    .total{font-weight:700;font-size:1.1rem}
    @media print{button{display:none}}
  </style></head><body>
  <button onclick="print()">Print</button>
  <h1>${company}</h1>
  <p class="muted">Trade-in Invoice ${row.id}<br/>Issued ${row.issued_at} · Status ${row.status}</p>
  <p>Bill to: ${row.first_name || ""} ${row.last_name || ""}<br/>${row.email || ""} · ${row.phone || ""}</p>
  <p class="muted">Offer ${row.offer_id} · Store ${row.store_id}</p>
  <table><thead><tr><th>Item</th><th>Amount (CAD)</th></tr></thead><tbody>
  ${lines.map((l) => `<tr><td>${l.description}</td><td>$${Number(l.amount).toFixed(2)}</td></tr>`).join("")}
  <tr><td class="total">Total payout</td><td class="total">$${Number(row.amount || 0).toFixed(2)}</td></tr>
  </tbody></table>
  <p class="muted">${row.notes || ""}</p>
  </body></html>`;
  res.type("html").send(html);
});

invoicesRouter.post("/from-offer/:offerId", requireCapability("invoices:write"), (req, res) => {
  const db = getDb();
  const built = buildInvoiceFromOffer(db, req.params.offerId);
  if (!built) {
    db.close();
    return res.status(404).json({ error: "Offer not found" });
  }
  const existing = db
    .prepare("SELECT id FROM invoices WHERE offer_id = ? ORDER BY issued_at DESC LIMIT 1")
    .get(req.params.offerId) as { id: string } | undefined;
  if (existing && !req.body?.force) {
    db.close();
    return res.status(409).json({ error: "Invoice already exists", id: existing.id });
  }
  const id = `INV-${Date.now().toString(36).toUpperCase()}-${nanoid(4).toUpperCase()}`;
  db.prepare(
    `INSERT INTO invoices (id, offer_id, customer_id, amount, status, line_items_json, notes, store_id)
     VALUES (?, ?, ?, ?, 'issued', ?, ?, ?)`,
  ).run(
    id,
    req.params.offerId,
    built.offer.customer_id || null,
    built.amount,
    JSON.stringify(built.lineItems),
    req.body?.notes || null,
    built.offer.store_id || "tg-burlington",
  );
  db.close();
  res.status(201).json({ id, amount: built.amount, status: "issued" });
});

invoicesRouter.patch("/:id", requireCapability("invoices:write"), (req, res) => {
  const db = getDb();
  const status = req.body?.status != null ? String(req.body.status) : null;
  const notes = req.body?.notes != null ? String(req.body.notes) : null;
  db.prepare(
    `UPDATE invoices SET
      status = COALESCE(?, status),
      notes = COALESCE(?, notes),
      paid_at = CASE WHEN ? = 'paid' THEN datetime('now') ELSE paid_at END
     WHERE id = ?`,
  ).run(status, notes, status, req.params.id);
  db.close();
  res.json({ ok: true });
});

/** Auto-issue invoice when offer completes (idempotent). */
export function ensureInvoiceForCompletedOffer(db: ReturnType<typeof getDb>, offerId: string): string | null {
  const existing = db.prepare("SELECT id FROM invoices WHERE offer_id = ? LIMIT 1").get(offerId) as
    | { id: string }
    | undefined;
  if (existing) return existing.id;
  const built = buildInvoiceFromOffer(db, offerId);
  if (!built) return null;
  const id = `INV-${Date.now().toString(36).toUpperCase()}-${nanoid(4).toUpperCase()}`;
  db.prepare(
    `INSERT INTO invoices (id, offer_id, customer_id, amount, status, line_items_json, store_id)
     VALUES (?, ?, ?, ?, 'issued', ?, ?)`,
  ).run(
    id,
    offerId,
    built.offer.customer_id || null,
    built.amount,
    JSON.stringify(built.lineItems),
    built.offer.store_id || "tg-burlington",
  );
  return id;
}
