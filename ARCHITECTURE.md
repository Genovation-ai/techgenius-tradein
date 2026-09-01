# Where to change things

A map, not a tour. Find the row that matches what you need to change, open that
file, done. For product context read `PROJECT_MASTER_GUIDE.md`; for full history
read `PROJECT_HANDOFF.md`.

Two apps, one database:

```
trade-in-backend/    Express + SQLite. Owns all money decisions.
trade-in-platform/   React. Customer widget + staff admin. Owns no pricing.
```

## The one rule

**Prices are decided on the server.** The widget displays what `/api/quote`
returns and nothing else. If you find yourself computing an offer in the browser,
stop — that path was removed on purpose (it once showed customers invented
numbers during an outage). See `PART U` in the handoff.

## Change X → edit Y

### Money
| To change | Edit |
|---|---|
| How an offer is calculated | `backend/src/services/quoteEngine.ts` |
| Which competitor quotes follow, match vs beat, beat % | Admin → Pricing, stored in `settings`; logic in `services/competitorPricing.ts` |
| Condition grade → competitor tier mapping | `services/competitorPricing.ts` (`COMPETITOR_TO_STORE`) |
| Grade ladder / storage ladder guarantees | `quoteEngine.ts` — `resolveLadderCappedPrice`, `storageCap` |
| Promo codes | Backend `promo_codes` table. The client map in `data/catalog.ts` is **not** authoritative. |

### Catalog
| To change | Edit |
|---|---|
| Which devices customers see | `backend/src/routes/catalog.ts` (hides anything unpriced) |
| Device → photo mapping | `backend/scripts/image_aliases.py` |
| Generated placeholder art | `backend/scripts/build_device_image.py` |
| Duplicate catalog rows | `backend/scripts/dedupe_catalog.py` |

### Customer widget
| To change | Edit |
|---|---|
| Step order / flow state | `platform/src/components/TradeInFlow.tsx` |
| A single step | `platform/src/components/<Name>Step.tsx` |
| Condition questions | `components/ValuationStep.tsx` + `data/catalog.ts` |
| Published grade names + criteria | `data/catalog.ts` — `gradeLabels`, `gradeDefinitions`, `inferGradeFromAnswers` |
| Storage vs memory labelling | `lib/tradeInTypes.ts` — `specKind`, `specLabel` |
| Storefront look | Admin → Settings → Storefront template; skins in `src/templates.css` |

### Admin
| To change | Edit |
|---|---|
| A page | `platform/src/admin/pages/<Name>Page.tsx` |
| Nav, store selector, notifications | `platform/src/admin/AdminLayout.tsx` |
| Auth, API key, shared fetch | `platform/src/admin/api.ts` |
| Who can do what | `backend/src/middleware/roles.ts` |

### Framer / embed
| To change | Edit |
|---|---|
| The embed bundle | `npm run build:embed:lite` → `dist-embed-lite/` |
| Mount behaviour, `data-api`, `data-org` | `platform/src/shopifyEmbed.tsx` |
| What Framer gets | `~/Downloads/TechGenius-Framer-Sell/` |
| Preview a build locally | `npm run preview:embed` → http://localhost:4210 |

`_archive/` is superseded. Never copy out of it.

## Before you ship

Each command answers one question and exits non-zero when the answer is bad.

```bash
cd trade-in-backend
npm run smoke:api        # do all 44 endpoints still work on real data?
npm run health:scrapers  # is competitor data fresh and covering the catalog?
npm run audit:quotes     # is any customer quoted a contradictory price?
npm run audit:catalog    # is the stored price table self-consistent?
npm run images:audit     # does every model have its own correct photo?
npm run catalog:dedupe   # is it still one row per model?
npm run test:quote-guard # retired devices unquotable, ladders hold

cd ../trade-in-platform
npm test && npx tsc -b && npx oxlint
```

## Things that look wrong but are deliberate

- **Grade keys are `flawless`/`good`/`average`/`fair`/`defective`, not the
  customer-facing names.** They map to scraped competitor tiers; renaming them
  breaks every price lookup. Display names live in `gradeLabels`.
- **Unpriced devices stay `enabled = 1`** and are filtered out of the catalog
  listing instead. Price syncs only touch enabled rows, so disabling would
  freeze them out of pricing permanently.
- **`data/pricingSnapshot.ts` and `fallbackSourcePointsForQuote` are empty /
  unused on purpose.** They backed a client-side estimate that is gone.
- **Duplicate catalog rows are disabled, not deleted**, so offer history and
  scraper mappings keep resolving.

## Abandoned buybacks (follow-ups)

Most people who price a device never submit. Every one of them used to be
discarded; they are now recorded so the shop can call them back.

| Piece | Where |
|---|---|
| Capture endpoint | `backend/src/routes/widget.ts` — `POST /api/widget/lead` |
| Storage | `abandoned_leads` table (deliberately **not** `offers`, so unfinished quotes never pollute pipeline counts or revenue reports) |
| Staff list | Admin → Follow-ups (`platform/src/admin/pages/LeadsPage.tsx`) |
| Fired from | `TradeInFlow.tsx` — debounced, once contact details plus a priced device exist |
| Converted | Marked automatically on submit, so "leads recovered" stays measurable |

Upserts by email, so a shopper returning three times is one lead. Partial
updates use `COALESCE` — a later call carrying only an email must not erase the
name captured earlier.

## Widget analytics events

The widget is an opaque island on Framer: traffic lands on /sell, offers appear
in admin, and nothing in between is visible. It now emits plain `CustomEvent`s
on `window` that any analytics tool on the host page can listen for.

```js
window.addEventListener("techgenius:offer_shown", (e) => {
  gtag("event", "trade_in_offer", { value: e.detail.value });
});
```

Events: `flow_started`, `device_selected`, `offer_shown`, `offer_accepted`,
`device_added`, `offer_submitted`, `quote_failed`. Defined in
`platform/src/lib/widgetEvents.ts`.

**Never put personal data in these** — the host page may forward them to third
parties. Device, step and amount only; verified by test.

## Catalog imagery

416 devices: **386 on a real product photo, 30 on a generated placeholder**, zero
shared across models, zero broken.

| Task | Command |
|---|---|
| Re-map photos after an import | `npm run images:backfill` |
| Prove no two models share one | `npm run images:audit` |
| Source missing photos from Wikimedia | `python3 scripts/fetch_commons_images.py [--apply]` |

`fetch_commons_images.py` is deliberately strict and rejects most candidates.
Two lessons are baked into it:

1. **Matching the name is not enough.** Loose matching offered a Pixel Fold for
   "Pixel 2" (the 2 was a sequence number in the filename) and a Tab S for a
   P1000 Galaxy Tab. It now requires the filename to *be* the model name once
   brand and photo decorations are stripped.
2. **The right device can still be the wrong image.** It found a genuine Galaxy
   S4 propped on garden gravel and a dark corner-crop of an iPad on a desk —
   correct, and unusable beside 386 clean renders. Candidates must also sit on a
   white or transparent background and be roughly portrait.

Anything uncertain stays a labelled placeholder, because a placeholder costs
nothing and a confidently wrong handset costs the sale.

Attribution for every sourced image is in `public/devices/IMAGE_CREDITS.json`
(all CC or public domain) and must be published if you use them commercially.

## Audit trail

Every status move, price edit and payout change is recorded with who and when.

| Piece | Where |
|---|---|
| Writer | `backend/src/services/activityLog.ts` |
| Storage | `activity_log` table |
| Read | `GET /api/offers/:id/history`, `GET /api/inventory/:id/history` |
| Shown | Offer detail → History |

Writes are fire-and-forget: an audit failure must never block the operation it
describes.

**`PATCH /api/offers/:id` rejects a `status` field with 400.** It used to accept
it into the void and answer 200, so callers believed an offer had advanced when
nothing had. Status moves belong on `PATCH /:id/status` because they also issue
invoices and create inventory. The smoke test now asserts the stored value
rather than trusting the response code — that no-op fooled it for weeks.
