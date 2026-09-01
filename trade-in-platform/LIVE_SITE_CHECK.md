# Live site check — shoptechgenius.ca sell/trade-in

Checked: Jul 29, 2026 against https://shoptechgenius.ca/pages/sell-my-device

## Does trade-in work on the live Shopify site today?

**No.** There is no working in-page trade-in wizard on shoptechgenius.ca yet.

The Sell My Device page only shows banners that link **off-site**. Both primary targets are broken:

| Banner / link | URL | Result |
|---------------|-----|--------|
| Trade-in banner | `https://techgenius.ca/sell-your-device/` | **404 Not Found** |
| Sell device banner | `https://techgenius.ca/fetchData/sell.php` | **404 Not Found** |

So when a customer tries to start trade-in from shoptechgenius.ca, they hit a dead page.

## Other findings on that page

| Check | Result |
|-------|--------|
| `/pages/sell-my-device` loads | 200 OK |
| `/pages/trade-in` | 404 |
| In-page quote form (brand/model/condition) | Missing |
| Photo/video AI | Missing |
| Offer / payout / track | Missing |
| Console noise | Shopify Pay iframe CSP; Giraffly trust script **404** + MIME error (unrelated app) |

`https://techgenius.ca/sell` (Framer) **does** load (200) but it’s marketing copy only (“Get an Instant Quote / Drop Off / Get Paid”) — not the full buyback form.

## What we fixed in our add-on (not live on Shopify yet)

Until assets are uploaded to the theme, these fixes exist only in `trade-in-platform/`:

- Target platform = **shoptechgenius.ca**
- Full trade-in flow for embed on `/pages/sell-my-device`
- Competitor prices removed (Tech Genius offer only)
- On-device vision, checklist, track offer, etc.
- Install guide: `CONNECT_SHOPTECHGENIUS.md`

**Not deployed to Shopify yet** — this cloud agent has no Shopify admin access. Uploading `tg-trade-in.js` / `.css` and replacing the broken banners is required for the live site to work.
