import type { EmailIdentity } from "./emailIdentity.js";

/**
 * A professional, branded HTML wrapper for every customer email.
 *
 * The messages were plain text: correct, but they read like a system log, not
 * like a shop a customer just agreed to sell a phone to. This wraps the same
 * words in a clean, responsive layout carrying the shop's name and colour, so
 * the email looks like it came from the business the customer dealt with —
 * which, being white-label, is the shop and never us.
 *
 * Table-based layout and fully inline styles on purpose: Gmail, Outlook and
 * Apple Mail strip <style> blocks and flex/grid, so the old rules apply. A
 * plain-text version always travels alongside this (see email.ts), both for
 * deliverability and for clients that prefer text.
 */

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Readable text on the header colour: dark colours get white, light get ink. */
function textOn(hex: string): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  // Perceived luminance (ITU-R BT.601).
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#1f2430" : "#ffffff";
}

/**
 * Turn the plain-text body into HTML paragraphs.
 *
 * Blank lines separate paragraphs; single newlines become line breaks. A final
 * line that starts with an em dash is treated as the sign-off and set apart.
 */
function paragraphs(body: string): string {
  const blocks = body
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  return blocks
    .map((block) => {
      const html = esc(block).replace(/\n/g, "<br>");
      const isSignoff = block.startsWith("—");
      const style = isSignoff
        ? "margin:24px 0 0;color:#6b7280;font-size:14px;"
        : "margin:0 0 16px;color:#1f2430;font-size:15px;line-height:1.6;";
      return `<p style="${style}">${html}</p>`;
    })
    .join("");
}

export function renderEmailHtml(identity: EmailIdentity, subject: string, body: string): string {
  const brand = /^#[0-9a-fA-F]{6}$/.test(identity.brandColor) ? identity.brandColor : "#0B3D2E";
  const onBrand = textOn(brand);
  const company = esc(identity.companyName);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f5f7;-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(subject)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #eceef1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
          <tr>
            <td style="background:${brand};padding:22px 28px;">
              <span style="color:${onBrand};font-size:19px;font-weight:700;letter-spacing:.2px;">${company}</span>
            </td>
          </tr>
          <tr>
            <td style="padding:30px 28px 8px;">
              ${paragraphs(body)}
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px 26px;border-top:1px solid #eceef1;">
              <p style="margin:0;color:#9aa0ac;font-size:12px;line-height:1.5;">
                This is an automated update about your trade-in with ${company}.
                Just reply to this email if you have any questions &mdash; it reaches ${company} directly.
              </p>
            </td>
          </tr>
        </table>
        <p style="margin:14px 0 0;color:#b4b9c2;font-size:11px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
          Sent by ${company}
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
