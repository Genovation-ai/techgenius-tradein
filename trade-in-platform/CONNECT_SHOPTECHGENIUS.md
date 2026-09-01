# Connect trade-in to shoptechgenius.ca

**Primary platform to connect:** [https://shoptechgenius.ca/](https://shoptechgenius.ca/) (Shopify)  
**Store:** `shop-techgenius.myshopify.com`  
**Page:** [https://shoptechgenius.ca/pages/sell-my-device](https://shoptechgenius.ca/pages/sell-my-device)

**Framer** (`techgenius.ca`) stays the brand site. After Shopify works, point Sell / “Get a Quote” there — or optionally embed the same JS later.  
**No Reusely** (or other buyback SaaS) required for connect or for later backend.

---

## Phase 1 — Connect the UI (do this first)

Goal: wizard loads on the live sell page under your theme. Demo prices / local Offer IDs are fine.

### Step A — Build

```bash
cd trade-in-platform
npm install
npm run build:embed
```

Files:

- `dist-embed/tg-trade-in.js`
- `dist-embed/tg-trade-in.css`

### Step B — Upload to Shopify

1. Shopify Admin → **Online Store → Themes → … → Edit code**
2. Open **Assets**
3. **Add a new asset** → upload both files above  
   (names must stay `tg-trade-in.js` and `tg-trade-in.css`)

### Step C — Mount on Sell My Device

**Option 1 — Liquid snippet (cleanest)**

1. Themes → Edit code → **Snippets** → Add new: `tg-trade-in.liquid`
2. Paste contents of `shopify/snippets/tg-trade-in.liquid`
3. Open the template used by **Sell My Device** (or create a page template) and add:

```liquid
{% render 'tg-trade-in' %}
```

**Option 2 — Page HTML**

1. Admin → **Pages → Sell My Device**
2. Remove broken outbound banners (`techgenius.ca` / `sell.php`)
3. Paste HTML from `shopify/page-sell-my-device.html`
4. Replace `ASSET_BASE` with your theme CDN, e.g.  
   `https://shoptechgenius.ca/cdn/shop/t/THEME_ID/assets`  
   (open any existing theme CSS in the browser to copy the real path)

### Step D — Verify

Open [sell-my-device](https://shoptechgenius.ca/pages/sell-my-device):

- [ ] Wizard shows under theme header
- [ ] Category → brand → model → offer flow works
- [ ] Colors match green / orange brand
- [ ] Broken 404 banners are gone

### Step E — Framer link (after Shopify works)

On [techgenius.ca/sell](https://techgenius.ca/sell), set **Get an Instant Quote** →  
`https://shoptechgenius.ca/pages/sell-my-device`

No Framer plugin. One button is enough for Phase 1.

---

## Phase 2 — Your own backend (later, still no Reusely)

| Need | Own it how |
|------|------------|
| Live prices | Your sheet / admin API → replace demo `catalog.ts` |
| Save offers | Your DB / Shopify metafield / simple API |
| Track offer | Same store |
| Payout | Interac / Shopify gift card — your choice |
| Shipping | Canada Post / EasyPost when you want |

Phase 1 does **not** need any of that.

---

## What “connected” means

```
Customer → shoptechgenius.ca/pages/sell-my-device
         → theme loads tg-trade-in.css + .js
         → #tg-trade-in-root mounts the wizard
         → (later) your API for prices + offers
```

Framer is optional chrome/link. Shopify is the platform you connect first.
