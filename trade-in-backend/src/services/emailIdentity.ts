import type { Database } from "better-sqlite3";

/**
 * Who an email appears to come from.
 *
 * Gadget Swap is white-label: the landing page promises a shop's customers "never
 * see us". Email was the one place that promise broke. Every message went out
 * from a single platform address and signed itself "Tech Genius Burlington",
 * so the first tenant to sign up after Tech Genius would have had their
 * customers emailed by a different shop.
 *
 * The sending infrastructure stays shared — one provider account, one verified
 * domain — because a shop signing up on a Tuesday cannot be asked to edit DNS
 * before its first customer gets a receipt. What varies per tenant is the
 * identity carried on top of it:
 *
 *   From:     "Red Bull Trade-In" <noreply@[platform domain]>
 *   Reply-To: trade@redbull.com
 *
 * The display name and reply address are the shop's, so a customer reads it as
 * theirs and a reply reaches them rather than us. A tenant that wants the
 * envelope address itself to be theirs needs their own verified domain, which
 * is a DNS step they take deliberately; TG_EMAIL_FROM stays the fallback until
 * per-org domains are offered.
 */
export interface EmailIdentity {
  /** Envelope sender — the platform's verified address. */
  from: string;
  /** Display name shown to the customer. */
  fromName: string;
  /** Where a reply goes: the shop's own inbox when it has one. */
  replyTo: string | null;
  /** The shop's name, for use inside the message body. */
  companyName: string;
  /** The shop's accent colour, for the email header. */
  brandColor: string;
}

const PLATFORM_FALLBACK_NAME = "Gadget Swap Trade-In";

/**
 * Never throws. An org with no settings row still gets a sane identity, since
 * failing to resolve branding must not stop a customer being told their device
 * arrived.
 */
export function emailIdentityFor(db: Database, orgId: string | null | undefined): EmailIdentity {
  const from = (process.env.TG_EMAIL_FROM || "tradein@techgenius.ca").trim();

  let companyName = "";
  let companyEmail = "";
  let brandColor = "";
  if (orgId) {
    try {
      const row = db
        .prepare(
          "SELECT company_name, company_email, widget_brand_color FROM org_settings WHERE org_id = ?",
        )
        .get(orgId) as
        | { company_name?: string; company_email?: string; widget_brand_color?: string }
        | undefined;
      companyName = (row?.company_name || "").trim();
      companyEmail = (row?.company_email || "").trim();
      brandColor = (row?.widget_brand_color || "").trim();
    } catch {
      /* settings table missing on a very old database — fall through */
    }
  }

  return {
    from,
    fromName: companyName ? `${companyName} Trade-In` : PLATFORM_FALLBACK_NAME,
    // Only a real address; a blank reply-to is better than one that bounces.
    replyTo: companyEmail.includes("@") ? companyEmail : null,
    companyName: companyName || "our shop",
    // A sane, professional default when a shop has not set its own.
    brandColor: /^#[0-9a-fA-F]{6}$/.test(brandColor) ? brandColor : "#0B3D2E",
  };
}
