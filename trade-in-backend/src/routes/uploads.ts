import { Router } from "express";
import { nanoid } from "nanoid";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "../db/migrate.js";
import { requireCapability } from "../middleware/auth.js";
import { orgFilter, ownsRow } from "../middleware/orgScope.js";

export const uploadsRouter = Router();

const UPLOAD_ROOT = path.resolve(import.meta.dirname, "../../data/uploads");

function ensureUploadRoot() {
  fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
}

/** JSON body upload (base64) — avoids multer dependency. */
uploadsRouter.post("/", requireCapability("uploads:write"), (req, res) => {
  ensureUploadRoot();
  const offerId = req.body?.offer_id ? String(req.body.offer_id) : null;
  const filename = String(req.body?.filename || "upload.bin").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  const mime = String(req.body?.mime_type || "application/octet-stream").slice(0, 80);
  const b64 = String(req.body?.content_base64 || "");
  if (!b64) return res.status(400).json({ error: "content_base64 required" });

  let buf: Buffer;
  try {
    buf = Buffer.from(b64, "base64");
  } catch {
    return res.status(400).json({ error: "Invalid base64" });
  }
  if (buf.length > 8 * 1024 * 1024) {
    return res.status(413).json({ error: "Max upload size is 8MB" });
  }

  const allowed = /^(image\/(jpeg|png|webp|gif)|application\/pdf)$/;
  if (!allowed.test(mime)) {
    return res.status(400).json({ error: "Only images and PDF are allowed" });
  }

  const id = nanoid(12);
  const stored = `${id}-${filename}`;
  const storagePath = path.join(UPLOAD_ROOT, stored);
  fs.writeFileSync(storagePath, buf);

  const db = getDb();
  if (offerId) {
    const offer = db.prepare("SELECT id FROM offers WHERE id = ?").get(offerId);
    if (!offer) {
      db.close();
      fs.unlinkSync(storagePath);
      return res.status(404).json({ error: "Offer not found" });
    }
  }
  db.prepare(
    `INSERT INTO uploads (id, offer_id, filename, mime_type, size_bytes, storage_path, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, offerId, filename, mime, buf.length, stored, req.tgAuth?.userId || null);
  db.close();

  res.status(201).json({
    id,
    filename,
    mime_type: mime,
    size_bytes: buf.length,
    url: `/api/uploads/${id}/file`,
  });
});

uploadsRouter.get("/", requireCapability("uploads:write"), (req, res) => {
  const db = getDb();
  const offerId = req.query.offer_id ? String(req.query.offer_id) : null;
  // Uploads are photographs of a customer's device, often showing serials and
  // sometimes the room they were taken in. They are scoped like any other
  // customer record.
  const org = orgFilter(req);
  let rows;
  if (offerId) {
    rows = db
      .prepare(
        `SELECT id, offer_id, filename, mime_type, size_bytes, created_at FROM uploads WHERE offer_id = ?${org.sql} ORDER BY created_at DESC`,
      )
      .all(offerId, ...org.params);
  } else {
    rows = db
      .prepare(
        `SELECT id, offer_id, filename, mime_type, size_bytes, created_at FROM uploads WHERE 1=1${org.sql} ORDER BY created_at DESC LIMIT 100`,
      )
      .all(...org.params);
  }
  db.close();
  res.json(rows);
});

uploadsRouter.get("/:id/file", requireCapability("uploads:write"), (req, res) => {
  const db = getDb();
  const row = db.prepare("SELECT * FROM uploads WHERE id = ?").get(req.params.id) as
    | { storage_path: string; mime_type: string; filename: string; org_id?: unknown }
    | undefined;
  db.close();
  if (row && !ownsRow(req, row)) return res.status(404).json({ error: "Not found" });
  if (!row) return res.status(404).json({ error: "Not found" });
  const full = path.join(UPLOAD_ROOT, row.storage_path);
  if (!fs.existsSync(full)) return res.status(404).json({ error: "File missing" });
  res.setHeader("Content-Type", row.mime_type || "application/octet-stream");
  res.setHeader("Content-Disposition", `inline; filename="${row.filename}"`);
  fs.createReadStream(full).pipe(res);
});

uploadsRouter.delete("/:id", requireCapability("uploads:write"), (req, res) => {
  const db = getDb();
  const row = db.prepare("SELECT storage_path FROM uploads WHERE id = ?").get(req.params.id) as
    | { storage_path: string }
    | undefined;
  if (!row) {
    db.close();
    return res.status(404).json({ error: "Not found" });
  }
  db.prepare("DELETE FROM uploads WHERE id = ?").run(req.params.id);
  db.close();
  const full = path.join(UPLOAD_ROOT, row.storage_path);
  if (fs.existsSync(full)) fs.unlinkSync(full);
  res.json({ ok: true });
});
