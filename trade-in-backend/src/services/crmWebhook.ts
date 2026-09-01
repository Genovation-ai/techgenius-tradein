import { getDb } from "../db/migrate.js";

export async function dispatchCrmWebhook(
  offerId: string,
  payload: Record<string, unknown>,
): Promise<{ status: "sent" | "blocked" | "failed"; detail?: string }> {
  const url = (process.env.TG_CRM_WEBHOOK_URL || "").trim();
  const json = JSON.stringify(payload);
  const db = getDb();

  try {
    if (!url) {
      db.prepare(
        `INSERT INTO crm_outbox (offer_id, payload_json, status) VALUES (?, ?, 'blocked')`,
      ).run(offerId, json);
      return {
        status: "blocked",
        detail: "Set TG_CRM_WEBHOOK_URL to deliver CRM events (Twenty or other).",
      };
    }

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(process.env.TG_CRM_WEBHOOK_TOKEN
            ? { Authorization: `Bearer ${process.env.TG_CRM_WEBHOOK_TOKEN}` }
            : {}),
        },
        body: json,
      });
      const text = await res.text();
      const status = res.ok ? "sent" : "failed";
      db.prepare(
        `INSERT INTO crm_outbox (offer_id, payload_json, status, response, sent_at)
         VALUES (?, ?, ?, ?, CASE WHEN ? = 'sent' THEN datetime('now') ELSE NULL END)`,
      ).run(offerId, json, status, text.slice(0, 2000), status);
      return { status, detail: text.slice(0, 200) };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      db.prepare(
        `INSERT INTO crm_outbox (offer_id, payload_json, status, response) VALUES (?, ?, 'failed', ?)`,
      ).run(offerId, json, msg);
      return { status: "failed", detail: msg };
    }
  } finally {
    db.close();
  }
}
