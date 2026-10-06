import { getDb } from "../db/migrate.js";
import { emailIdentityFor } from "./emailIdentity.js";

export type EmailSendResult = {
  status: "sent" | "queued" | "blocked" | "failed";
  detail?: string;
};

/**
 * Deliver email when TG_EMAIL_WEBHOOK is configured (POST JSON).
 * Otherwise queue in email_outbox as blocked for ops to configure delivery.
 */
export async function sendTradeInEmail(opts: {
  offerId?: string | null;
  /** Whose customer this is. Decides the name and reply address on the mail,
   *  and keeps one shop's queue out of another's outbox view. */
  orgId?: string | null;
  recipient: string;
  subject: string;
  body: string;
}): Promise<EmailSendResult> {
  const webhook = (process.env.TG_EMAIL_WEBHOOK || "").trim();
  const db = getDb();
  const identity = emailIdentityFor(db, opts.orgId);
  const orgId = opts.orgId || null;

  try {
    if (!opts.recipient || !opts.recipient.includes("@")) {
      db.prepare(
        `INSERT INTO email_outbox (org_id, offer_id, recipient, subject, body, status)
         VALUES (?, ?, ?, ?, ?, 'failed')`,
      ).run(orgId, opts.offerId || null, opts.recipient || "unknown", opts.subject, opts.body);
      return { status: "failed", detail: "Invalid recipient" };
    }

    if (!webhook) {
      const info = db
        .prepare(
          `INSERT INTO email_outbox (org_id, offer_id, recipient, subject, body, status)
           VALUES (?, ?, ?, ?, ?, 'blocked')`,
        )
        .run(orgId, opts.offerId || null, opts.recipient, opts.subject, opts.body);
      if (opts.offerId) {
        db.prepare(
          `INSERT INTO notifications (offer_id, type, channel, recipient, subject)
           VALUES (?, 'email_blocked', 'email', ?, ?)`,
        ).run(opts.offerId, opts.recipient, `[queued] ${opts.subject}`.slice(0, 500));
      }
      return {
        status: "blocked",
        detail: `Email queued (#${info.lastInsertRowid}). Set TG_EMAIL_WEBHOOK to deliver.`,
      };
    }

    try {
      const res = await fetch(webhook, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(process.env.TG_EMAIL_WEBHOOK_TOKEN
            ? { Authorization: `Bearer ${process.env.TG_EMAIL_WEBHOOK_TOKEN}` }
            : {}),
        },
        body: JSON.stringify({
          // Resend and every provider with a compatible shape read "Name <addr>".
          from: `${identity.fromName} <${identity.from}>`,
          ...(identity.replyTo ? { reply_to: identity.replyTo } : {}),
          to: opts.recipient,
          subject: opts.subject,
          text: opts.body,
          offer_id: opts.offerId || null,
        }),
      });
      const text = await res.text();
      const status = res.ok ? "sent" : "failed";
      db.prepare(
        `INSERT INTO email_outbox (org_id, offer_id, recipient, subject, body, status, provider_response, sent_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'sent' THEN datetime('now') ELSE NULL END)`,
      ).run(
        orgId,
        opts.offerId || null,
        opts.recipient,
        opts.subject,
        opts.body,
        status,
        text.slice(0, 2000),
        status,
      );
      if (opts.offerId) {
        db.prepare(
          `INSERT INTO notifications (offer_id, type, channel, recipient, subject)
           VALUES (?, ?, 'email', ?, ?)`,
        ).run(
          opts.offerId,
          status === "sent" ? "email_sent" : "email_failed",
          opts.recipient,
          opts.subject.slice(0, 500),
        );
      }
      return { status, detail: text.slice(0, 200) };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      db.prepare(
        `INSERT INTO email_outbox (org_id, offer_id, recipient, subject, body, status, provider_response)
         VALUES (?, ?, ?, ?, ?, 'failed', ?)`,
      ).run(orgId, opts.offerId || null, opts.recipient, opts.subject, opts.body, msg.slice(0, 2000));
      return { status: "failed", detail: msg };
    }
  } finally {
    db.close();
  }
}

/** Counts for one tenant. Called with no org only by single-tenant tooling. */
export function emailStatusSummary(orgId?: string | null): {
  configured: boolean;
  pending: number;
  sent: number;
  blocked: number;
  failed: number;
} {
  const db = getDb();
  try {
    const count = (status: string) =>
      (
        db
          .prepare(
            orgId
              ? "SELECT COUNT(*) AS c FROM email_outbox WHERE status = ? AND org_id = ?"
              : "SELECT COUNT(*) AS c FROM email_outbox WHERE status = ?",
          )
          .get(...(orgId ? [status, orgId] : [status])) as { c: number }
      ).c;
    return {
      configured: Boolean((process.env.TG_EMAIL_WEBHOOK || "").trim()),
      pending: count("pending"),
      sent: count("sent"),
      blocked: count("blocked"),
      failed: count("failed"),
    };
  } finally {
    db.close();
  }
}

/**
 * Deliver the mail that was written while no provider was configured.
 *
 * Every message sent before TG_EMAIL_WEBHOOK existed was stored with status
 * 'blocked' and nothing ever looked at those rows again. Configuring delivery
 * fixes the next customer and leaves the earlier ones with silence — on this
 * deployment, seventeen people who asked for a quote and heard nothing back.
 *
 * Rows are updated in place rather than re-inserted, so a flush that runs
 * twice does not fill the outbox with copies of the same message, and a row
 * that fails again stays as one row carrying its latest error.
 */
export async function flushBlockedEmails(opts: {
  orgId?: string | null;
  limit?: number;
}): Promise<{ attempted: number; sent: number; failed: number; skipped: string | null }> {
  const webhook = (process.env.TG_EMAIL_WEBHOOK || "").trim();
  if (!webhook) {
    return { attempted: 0, sent: 0, failed: 0, skipped: "TG_EMAIL_WEBHOOK is not set" };
  }

  const limit = Math.min(Math.max(1, opts.limit ?? 50), 200);
  const db = getDb();
  try {
    const rows = db
      .prepare(
        opts.orgId
          ? `SELECT id, org_id, offer_id, recipient, subject, body FROM email_outbox
              WHERE status = 'blocked' AND org_id = ? ORDER BY id ASC LIMIT ?`
          : `SELECT id, org_id, offer_id, recipient, subject, body FROM email_outbox
              WHERE status = 'blocked' ORDER BY id ASC LIMIT ?`,
      )
      .all(...(opts.orgId ? [opts.orgId, limit] : [limit])) as Array<{
      id: number;
      org_id: string | null;
      offer_id: string | null;
      recipient: string;
      subject: string;
      body: string;
    }>;

    let sent = 0;
    let failed = 0;

    for (const row of rows) {
      // Recomputed from the row's own tenant, so a queued message still goes
      // out as the shop it belonged to rather than whoever triggered the flush.
      const identity = emailIdentityFor(db, row.org_id);
      let status: "sent" | "failed" = "failed";
      let detail = "";
      try {
        const res = await fetch(webhook, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(process.env.TG_EMAIL_WEBHOOK_TOKEN
              ? { Authorization: `Bearer ${process.env.TG_EMAIL_WEBHOOK_TOKEN}` }
              : {}),
          },
          body: JSON.stringify({
            from: `${identity.fromName} <${identity.from}>`,
            ...(identity.replyTo ? { reply_to: identity.replyTo } : {}),
            to: row.recipient,
            subject: row.subject,
            text: row.body,
            offer_id: row.offer_id,
          }),
        });
        detail = (await res.text()).slice(0, 2000);
        status = res.ok ? "sent" : "failed";
      } catch (e) {
        detail = (e instanceof Error ? e.message : String(e)).slice(0, 2000);
      }

      db.prepare(
        `UPDATE email_outbox
            SET status = ?, provider_response = ?,
                sent_at = CASE WHEN ? = 'sent' THEN datetime('now') ELSE sent_at END
          WHERE id = ?`,
      ).run(status, detail, status, row.id);

      if (row.offer_id) {
        db.prepare(
          `INSERT INTO notifications (offer_id, type, channel, recipient, subject)
           VALUES (?, ?, 'email', ?, ?)`,
        ).run(
          row.offer_id,
          status === "sent" ? "email_sent" : "email_failed",
          row.recipient,
          row.subject.slice(0, 500),
        );
      }

      if (status === "sent") sent++;
      else failed++;
    }

    return { attempted: rows.length, sent, failed, skipped: null };
  } finally {
    db.close();
  }
}
