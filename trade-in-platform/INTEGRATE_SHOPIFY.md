# Add trade-in to Shopify shop page (optional)

Primary install is **Framer** — see [INTEGRATE_FRAMER.md](./INTEGRATE_FRAMER.md) for [techgenius.ca/sell](https://techgenius.ca/sell).

Use this only if you also want the wizard on [shoptechgenius.ca/pages/sell-my-device](https://shoptechgenius.ca/pages/sell-my-device) (Shopify). That shop site is separate from the Framer brand site.

## 1. Build the embed bundle

```bash
cd trade-in-platform
npm install
npm run build:embed
```

Output:

- `dist-embed/tg-trade-in.js`
- `dist-embed/tg-trade-in.css`

## 2. Upload to Shopify

**Online Store → Themes → Edit code → Assets**

Upload:

- `tg-trade-in.js`
- `tg-trade-in.css`

Optional: add snippet `shopify/snippets/tg-trade-in.liquid` under **Snippets**.

## 3. Put it on Sell My Device

### Option A — Page HTML (fastest)

1. Admin → **Pages → Sell My Device**
2. Remove / replace the outbound banner images (`techgenius.ca`, `sell.php`)
3. Paste contents of `shopify/page-sell-my-device.html`
4. Set `ASSET_BASE` to your theme asset URLs, e.g.  
   `https://shoptechgenius.ca/cdn/shop/t/14/assets`  
   (or use Liquid if the page supports it)

### Option B — Theme snippet

In the page template / section that renders sell-my-device:

```liquid
{% render 'tg-trade-in' %}
```

## 4. What stays on Tech Genius

| Already on site | Action |
|-----------------|--------|
| Shop / collections | Keep |
| Repair (3rd party for now) | Keep until you copy UniverCell repair later |
| Recycle / blogs / cart | Keep |
| Header, nav, footer, reviews | Keep |
| Sell My Device banners | **Replace with this embed** |

## 5. Verify

1. Open `/pages/sell-my-device`
2. Complete a quote with photo upload
3. Confirm Offer ID + Track my offer
4. Confirm theme header/footer still wrap the page

## 6. Later (your own backend — no Reusely)

- Point checkout submit in `TradeInFlow.tsx` to your API / Shopify metafields
- Swap demo prices in `src/data/catalog.ts` for live buyback rates
- Replace localStorage offer tracking with your database
