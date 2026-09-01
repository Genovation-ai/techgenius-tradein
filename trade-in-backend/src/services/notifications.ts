import type { Database } from "better-sqlite3";
import { sendTradeInEmail } from "./email.js";

/** Record an in-app notification tied to a real offer event (not UI-only). */
export function recordOfferNotification(
  db: Database,
  opts: {
    offerId: string;
    type: string;
    channel?: string;
    recipient?: string | null;
    subject: string;
  },
): void {
  db.prepare(
    `INSERT INTO notifications (offer_id, type, channel, recipient, subject)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    opts.offerId,
    opts.type,
    opts.channel || "in_app",
    opts.recipient || null,
    opts.subject.slice(0, 500),
  );
}

/** When a workflow stage has send_email=1, log + attempt real email delivery. */
export function notifyOfferStatusChange(db: Database, offerId: string, status: string): void {
  const stage = db
    .prepare("SELECT label, send_email, email_template FROM workflow_stages WHERE id = ?")
    .get(status) as { label: string; send_email: number; email_template?: string | null } | undefined;

  const offer = db
    .prepare(
      `SELECT o.id, o.total_value, c.email, c.first_name, c.last_name
       FROM offers o LEFT JOIN customers c ON c.id = o.customer_id
       WHERE o.id = ?`,
    )
    .get(offerId) as
    | {
        id: string;
        total_value: number;
        email?: string;
        first_name?: string;
        last_name?: string;
      }
    | undefined;

  if (!offer) return;

  const label = stage?.label || status;
  const subject = `Offer ${offerId} → ${label}`;

  recordOfferNotification(db, {
    offerId,
    type: `status:${status}`,
    channel: "in_app",
    recipient: offer.email || null,
    subject,
  });

  if (stage?.send_email && offer.email) {
    const body =
      stage.email_template?.trim() ||
      [
        `Hi ${offer.first_name || "there"},`,
        "",
        `Your Tech Genius trade-in offer ${offerId} is now: ${label}.`,
        `Current offer value: $${Number(offer.total_value || 0).toFixed(2)} CAD.`,
        "",
        "Track anytime with your Offer ID on our sell page.",
        "",
        "— Tech Genius Burlington",
      ].join("\n");

    recordOfferNotification(db, {
      offerId,
      type: `status_email:${status}`,
      channel: "email",
      recipient: offer.email,
      subject: `Tech Genius Trade-In update: ${label}`,
    });

    void sendTradeInEmail({
      offerId,
      recipient: offer.email,
      subject: `Tech Genius Trade-In update: ${label}`,
      body,
    });
  }
}
