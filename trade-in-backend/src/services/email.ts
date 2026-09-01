import { getDb } from "../db/migrate.js";

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
  recipient: string;
  subject: string;
  body: string;
}): Promise<EmailSendResult> {
  const webhook = (process.env.TG_EMAIL_WEBHOOK || "").trim();
  const from = process.env.TG_EMAIL_FROM || "tradein@techgenius.ca";
  const db = getDb();

  try {
    if (!opts.recipient || !opts.recipient.includes("@")) {
      db.prepare(
        `INSERT INTO email_outbox (offer_id, recipient, subject, body, status)
         VALUES (?, ?, ?, ?, 'failed')`,
      ).run(opts.offerId || null, opts.recipient || "unknown", opts.subject, opts.body);
      return { status: "failed", detail: "Invalid recipient" };
    }

    if (!webhook) {
      const info = db
        .prepare(
          `INSERT INTO email_outbox (offer_id, recipient, subject, body, status)
           VALUES (?, ?, ?, ?, 'blocked')`,
        )
        .run(opts.offerId || null, opts.recipient, opts.subject, opts.body);
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
          from,
          to: opts.recipient,
          subject: opts.subject,
          text: opts.body,
          offer_id: opts.offerId || null,
        }),
      });
      const text = await res.text();
      const status = res.ok ? "sent" : "failed";
      db.prepare(
        `INSERT INTO email_outbox (offer_id, recipient, subject, body, status, provider_response, sent_at)
         VALUES (?, ?, ?, ?, ?, ?, CASE WHEN ? = 'sent' THEN datetime('now') ELSE NULL END)`,
      ).run(
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
        `INSERT INTO email_outbox (offer_id, recipient, subject, body, status, provider_response)
         VALUES (?, ?, ?, ?, 'failed', ?)`,
      ).run(opts.offerId || null, opts.recipient, opts.subject, opts.body, msg.slice(0, 2000));
      return { status: "failed", detail: msg };
    }
  } finally {
    db.close();
  }
}

export function emailStatusSummary(): {
  configured: boolean;
  pending: number;
  sent: number;
  blocked: number;
  failed: number;
} {
  const db = getDb();
  try {
    const count = (status: string) =>
      (db.prepare("SELECT COUNT(*) AS c FROM email_outbox WHERE status = ?").get(status) as { c: number })
        .c;
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
