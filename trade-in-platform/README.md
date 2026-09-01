# Tech Genius Trade-In → shoptechgenius.ca

Features for the **existing Shopify platform**:  
[https://shoptechgenius.ca/](https://shoptechgenius.ca/)

| Site | Role |
|------|------|
| **shoptechgenius.ca** | Shopify store — **connect trade-in here** |
| techgenius.ca | Framer brand site — can link to Shopify sell page |

## Install on Shopify

See **[CONNECT_SHOPTECHGENIUS.md](./CONNECT_SHOPTECHGENIUS.md)**

```bash
npm install
npm run build:embed   # tg-trade-in.js + .css → Theme Assets
npm run dev           # local preview
npm test
```

Paste into `/pages/sell-my-device` (replace outbound banners only).

## What’s included

Category → Brand → Model → Details → Checklist → On-device vision → Grade → **Tech Genius offer only** → Payout → Track offer  

Competitor prices are not shown to customers.
