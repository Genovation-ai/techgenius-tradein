# Tech Genius Trade-In → Framer `/sell`

**What's in this folder**

| File | What it is |
|------|------------|
| `tg-trade-in.js` | The widget. 388 KB (125 KB gzipped). |
| `tg-trade-in.css` | Its styles. 21 KB. |
| `framer-embed.html` | Paste-in block for a Framer **Embed** element. |
| `TechGeniusTradeIn.tsx` | Framer **Code Component** version (nicer: settings in the panel). |
| `FRAMER_PROMPT.txt` | Text to hand to Framer AI if you'd rather not click through it. |

Current `techgenius.ca/sell` has the hero, the three steps ("Get an Instant Quote",
"Drop Off Device", "Get Paid Fast") and the trust badges — but **no working
wizard**. This adds the wizard under that existing content. Nothing else on the
page changes.

---

## Read this first — the one thing you must do yourself

The widget is a front-end. Every price it shows comes from your backend, which
**must be deployed to a public HTTPS URL** before the widget can work anywhere
other than your laptop.

That's deliberate, not a limitation: prices are computed server-side so a
customer can't edit the offer in their browser. There is no version of this that
works with the backend on `127.0.0.1` — Framer runs on Framer's servers and
your visitors' browsers, neither of which can see your laptop.

So the order is:

1. **Deploy `trade-in-backend`** → get a URL like `https://api.techgenius.ca`
2. Then everything below takes about ten minutes.

If the backend isn't up yet, the widget will render and then show a loading /
error state. It won't show fake prices, which is the correct behaviour.

---

## Step 1 — Deploy the backend

Any host that runs Node 20+ with a persistent disk works (Railway, Render,
Fly.io, a VPS). It's an Express app with a SQLite file.

**Required environment variables** — the server refuses to boot in production
without the first three, on purpose:

```bash
NODE_ENV=production
TG_API_KEY=<long random string>
TG_ADMIN_PASSWORD=<your admin password>
TG_CRON_SECRET=<long random string>

# Let the browser on your Framer site call the API:
TG_CORS_ORIGINS=https://techgenius.ca,https://www.techgenius.ca,https://shoptechgenius.ca

# If your host puts a proxy in front (most do):
TG_TRUST_PROXY=1
```

Two things the backend must keep across restarts:

- `data/tradein.db` — the catalog, prices, offers. **Mount a volume for this.**
  If it's on ephemeral disk you lose every offer on each deploy.
- `../trade-in-platform/public/devices` — the product photos, served at
  `/devices/*`. The widget loads photos from here.

Confirm it's alive:

```bash
curl https://api.techgenius.ca/api/health
# {"status":"ok", ...}
curl "https://api.techgenius.ca/api/catalog/devices?limit=3"
```

---

## Step 2 — Host the two files

Framer's asset uploader doesn't reliably serve `.js`. Any of these works — pick one:

**Easiest: serve them from the API you just deployed.** Drop both files into the
backend's static folder (next to `public/devices`) and they're at
`https://api.techgenius.ca/tg-trade-in.js`. One less host to manage, and no CORS
question for the assets.

**Or** Cloudflare Pages / Netlify — drag this folder onto their dashboard, free,
gives you `https://something.pages.dev/tg-trade-in.js`.

**Or** GitHub + jsDelivr — push the folder to a public repo, then
`https://cdn.jsdelivr.net/gh/<user>/<repo>@main/tg-trade-in.js`.

Whichever you choose, that base URL is your `ASSET_BASE_HERE` below.

---

## Step 3 — Put it on `/sell`

### Option A — Embed element (fastest)

1. Framer → open the **Sell** page
2. Place the cursor **below** the "Get Paid Fast" section
3. **Insert → Embed**, switch it to **HTML**
4. Paste the contents of `framer-embed.html`
5. Replace `API_URL_HERE` and `ASSET_BASE_HERE` with your two URLs
6. Set the element **Width: Fill**, **Height: 1100**
7. **Publish**

### Option B — Code Component (recommended if you'll tweak it later)

1. Framer → **Assets → Code → New Component**, name it `TechGeniusTradeIn`
2. Paste all of `TechGeniusTradeIn.tsx`
3. Drag the component onto `/sell`
4. Fill in the right-hand panel:
   - **API URL** → `https://api.techgenius.ca`
   - **Script URL** → `<ASSET_BASE>/tg-trade-in.js`
   - **CSS URL** → `<ASSET_BASE>/tg-trade-in.css`
   - **Org slug** → `tech-genius`
   - **Min height** → `1100`
5. **Publish**

Option B is better because the URLs live in the Framer panel — a staff member
can repoint the widget at a staging API without touching code.

---

## Step 4 — Wire the existing buttons

Your "Get an Instant Quote" button currently goes nowhere useful. Point it at
the wizard:

1. Select the button → **Link** → **Section on this page** → the embed/component
2. Or give the embed a section id and link to `/sell#quote`

The wizard already includes its own "Track my offer" box at the bottom, so you
don't need a separate tracking page.

---

## Step 5 — Check it

On the published site, not the Framer preview:

- [ ] `/sell` shows the wizard under your existing hero and three steps
- [ ] Category tiles show real product photos (not empty boxes)
- [ ] Picking **Smartphone → Apple** shows one tile per model — you should see
      exactly one "iPhone 12", not ten variants of it
- [ ] Every tile shows a photo of *that* model
- [ ] Pick a device → the price shown matches the Pricing page in `/admin`
- [ ] Submit a test offer → it appears in `/admin` → Offers
- [ ] Open DevTools → Console: no red errors; Network: no failed requests
- [ ] Shop link still goes to shoptechgenius.ca

---

## Changing the look later — no rebuild

The widget's appearance is a server setting, so you change it from admin and
the live site follows on next load:

**Admin → Settings → Storefront template**

| Template | Look |
|----------|------|
| Tech Genius (default) | Warm local-shop styling, roomy cards |
| Guided steps | One question per screen, loud progress bar |
| Dense catalog | Tighter grid, more models above the fold |
| Carrier blue | Cool corporate palette, flat cards |
| Rounded friendly | Soft radii, big tap targets |
| Ops console | Neutral, data-forward |
| Minimal | Inherits your Framer page's type and colours |

Preview one before switching the live store by adding `?tg_template=minimal` to
the `/sell` URL.

Brand colours, company name and payout methods come from
**Admin → Settings → Organization**.

---

## Troubleshooting

**Widget doesn't appear at all**
The embed can't find its mount point. Confirm the pasted HTML still contains
`id="tg-trade-in-root"` — Framer sometimes strips ids when you edit inside the
embed box. Re-paste rather than hand-editing.

**Widget appears but no devices load**
Console will show a CORS error or a failed request to your API.
- Is `TG_CORS_ORIGINS` set to include `https://techgenius.ca` *and*
  `https://www.techgenius.ca`? They're different origins to a browser.
- Is `data-api` the exact API origin, with `https://` and no trailing slash?
- Does `https://<your-api>/api/health` load in a browser tab?

**Devices load but photos are missing**
The API isn't serving `/devices`. Check
`https://<your-api>/devices/iphone-15.png` loads. If not, the
`trade-in-platform/public/devices` folder didn't make it into your deployment.

**Prices look wrong**
The widget only displays what the server computes. Check
**Admin → Pricing** (which competitor the quotes reflect, and the beat %). After
any catalog import, re-run on the server:

```bash
npm run catalog:dedupe        # preview
npm run catalog:dedupe:apply  # one row per model
npm run images:backfill -- --check-remote
npm run images:audit          # must report 0 cross-model collisions
```

**It works in Framer preview but not published**
Almost always mixed content: your site is HTTPS and `data-api` is `http://`.
The API must be HTTPS.

---

## Why this build is small

There's also a "full" embed at ~10 MB that inlines every product photo. This one
is 388 KB and loads photos from your API instead — which you're running anyway,
since that's where prices come from. On mobile that's the difference between a
page that loads and one that doesn't. Use the full build only if you ever need
the widget to render photos with no backend reachable at all.

Rebuild either from `trade-in-platform`:

```bash
npm run build:embed:lite   # → dist-embed-lite (this one, 388 KB)
npm run build:embed        # → dist-embed (10 MB, photos inlined)
```
