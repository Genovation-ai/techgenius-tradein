import { Router } from "express";
import { nanoid } from "nanoid";
import { randomBytes, scryptSync } from "node:crypto";
import { getDb } from "../db/migrate.js";
import { requireCapability } from "../middleware/auth.js";
import { STAFF_ROLES, capabilitiesForRole, normalizeRole } from "../middleware/roles.js";

export const teamRouter = Router();

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString("hex");
}

function makePasswordRecord(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${hashPassword(password, salt)}`;
}

teamRouter.get("/", requireCapability("team:read"), (_req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, email, name, role, enabled, created_at FROM admin_users ORDER BY created_at ASC`,
    )
    .all();
  db.close();
  res.json({
    users: rows,
    roles: STAFF_ROLES,
    capabilities: Object.fromEntries(STAFF_ROLES.map((r) => [r, capabilitiesForRole(r)])),
  });
});

teamRouter.get("/me/capabilities", (req, res) => {
  const role = req.tgAuth?.role || "operator";
  res.json({
    role: role === "master" ? "admin" : normalizeRole(role),
    auth_type: req.tgAuth?.type,
    capabilities: capabilitiesForRole(role),
  });
});

teamRouter.post("/", requireCapability("team:write"), (req, res) => {
  const email = String(req.body?.email || "")
    .trim()
    .toLowerCase();
  const name = String(req.body?.name || "").trim().slice(0, 120);
  const password = String(req.body?.password || "");
  const role = normalizeRole(req.body?.role);

  if (!email || !name || password.length < 8) {
    return res.status(400).json({ error: "email, name, and password (min 8) are required" });
  }
  if (role === "admin" && req.tgAuth?.role === "manager") {
    return res.status(403).json({ error: "Managers cannot create admin users" });
  }

  const db = getDb();
  const exists = db.prepare("SELECT id FROM admin_users WHERE email = ?").get(email);
  if (exists) {
    db.close();
    return res.status(409).json({ error: "User already exists" });
  }
  const id = nanoid(12);
  db.prepare(
    "INSERT INTO admin_users (id, email, password_hash, name, role, org_id) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, email, makePasswordRecord(password), name, role, req.tgAuth?.orgId || "org-tech-genius");
  db.close();
  res.status(201).json({ id, email, name, role });
});

teamRouter.patch("/:id", requireCapability("team:write"), (req, res) => {
  const db = getDb();
  const user = db
    .prepare("SELECT id, role FROM admin_users WHERE id = ?")
    .get(req.params.id) as { id: string; role: string } | undefined;
  if (!user) {
    db.close();
    return res.status(404).json({ error: "Not found" });
  }

  const nextRole = req.body?.role != null ? normalizeRole(req.body.role) : null;
  if (nextRole === "admin" && req.tgAuth?.role === "manager") {
    db.close();
    return res.status(403).json({ error: "Managers cannot promote to admin" });
  }

  if (req.body?.enabled === 0 || req.body?.enabled === false) {
    const admins = db
      .prepare("SELECT COUNT(*) AS c FROM admin_users WHERE role = 'admin' AND enabled = 1")
      .get() as { c: number };
    if (user.role === "admin" && admins.c <= 1) {
      db.close();
      return res.status(400).json({ error: "Cannot disable the last admin" });
    }
  }

  db.prepare(
    `UPDATE admin_users SET
      name = COALESCE(?, name),
      role = COALESCE(?, role),
      enabled = COALESCE(?, enabled)
     WHERE id = ?`,
  ).run(
    req.body?.name != null ? String(req.body.name).slice(0, 120) : null,
    nextRole,
    req.body?.enabled === undefined ? null : req.body.enabled ? 1 : 0,
    req.params.id,
  );

  if (req.body?.password && String(req.body.password).length >= 8) {
    db.prepare("UPDATE admin_users SET password_hash = ? WHERE id = ?").run(
      makePasswordRecord(String(req.body.password)),
      req.params.id,
    );
  }

  db.close();
  res.json({ ok: true });
});

/** Seed default operator + manager for local/dev demos when missing */
export function seedStaffRoles() {
  const db = getDb();
  const opEmail = (process.env.TG_OPERATOR_EMAIL || "operator@techgenius.ca").toLowerCase();
  const existing = db.prepare("SELECT id FROM admin_users WHERE email = ?").get(opEmail);
  if (!existing) {
    const password = process.env.TG_OPERATOR_PASSWORD || "Operator2026!";
    db.prepare(
      "INSERT INTO admin_users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, 'operator')",
    ).run(nanoid(12), opEmail, makePasswordRecord(password), "Floor Operator");
    console.log(`Seeded operator login: ${opEmail}`);
  }
  const mgrEmail = (process.env.TG_MANAGER_EMAIL || "manager@techgenius.ca").toLowerCase();
  const mgr = db.prepare("SELECT id FROM admin_users WHERE email = ?").get(mgrEmail);
  if (!mgr) {
    const password = process.env.TG_MANAGER_PASSWORD || "Manager2026!";
    db.prepare(
      "INSERT INTO admin_users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, 'manager')",
    ).run(nanoid(12), mgrEmail, makePasswordRecord(password), "Store Manager");
    console.log(`Seeded manager login: ${mgrEmail}`);
  }
  db.close();
}
