# Honest trade-in audit (re-checked Jul 29, 2026)

How I checked:
- Fetched live HTML/JS from `gorecell.ca/step-flow/` and `univercell.ai/sell/details`
- Parsed condition definitions, carriers, categories, required form schema, AI video strings
- **Did not** click every model path in a real browser session with their backend offers

## GoRecell (`/step-flow/`)

| Function | On GoRecell? | In Tech Genius module? | Notes |
|----------|--------------|------------------------|-------|
| Category first (phone/tablet/watch/…) | Yes (11 cats incl. VR, consoles, monitors) | Partial | We have 4: smartphone, tablet, smartwatch, laptop |
| Brand → model | Yes | Yes | |
| Model search | Yes | Yes | |
| Carrier / network | Yes (Bell, Fido, Koodo, Rogers, Telus, Unlocked, Virgin) | Yes | Freedom + Other added |
| Condition grades + written definitions | Yes: Like New / Good / Cracked / Defective | Yes | We use Flawless→Defective labels with same rules mixed in |
| Battery thresholds in grade text | Yes (85% / 84%) | Yes | In grade definitions |
| Instant price by condition | Yes (live catalog prices) | Partial | Demo prices in `catalog.ts`, not their live API |
| Product-specific questions | Yes (Angular question UI) | Partial | Generic checklist only; no S-Pen / accessory matrix per SKU |
| Promo code | Yes | Yes | |
| Accept & add another device | Yes | Yes | Cart |
| Get paid / checkout | Yes | Yes | |
| Mail-in shipping kit flow | Yes | Partial | We collect address; no real Canada Post label API |
| Track my offer | Yes | Yes | LocalStorage, not their backend |
| Bulk sell path | Yes | No | Out of scope for v1 |
| Photo/video grading online | No real buyback AI | N/A | We added vision as an upgrade |
| Live payout methods on page HTML | Cheque/PayPal/Interac in FAQ | Yes | Interac / PayPal / cash / store credit |

## UniverCell (`/sell/details`)

| Function | On UniverCell? | In Tech Genius module? | Notes |
|----------|----------------|------------------------|-------|
| Device type / make / model / storage required | Yes | Yes | Category ≈ type |
| Valuation questions | Yes | Yes | |
| Battery health required (0–100) | Yes | Yes | |
| Carrier required | Yes | Yes | |
| Fully functional? | Yes | Yes | |
| Exterior condition? | Yes | Yes | |
| Under contract? | Yes | Yes | |
| Charger included? | Yes | Yes | |
| S-Pen / accessory extras | Yes (device-specific) | No | Only generic charger |
| Clean IMEI / not lost-stolen note | Yes | Yes | Gate on checklist |
| Activation / iCloud / FRP unlock | Yes | Yes | |
| Provide Device Video (record/upload/skip) | Yes | Yes | |
| AI assessment (`assessPhoneCondition`) | Yes (their cloud AI) | Partial | **On-device CV**, not their model/API |
| AI can pre-select condition | Yes | Yes | Suggested grade |
| Multi-store map / geolocation pick | Yes | Partial | Single Burlington location |
| First/last name, email, phone | Yes | Yes | |
| Payout method + lock-in offer | Yes | Yes | |
| User notes | Yes | Yes | |
| Promo validation | Yes | Yes | Local codes only |
| Add another item | Yes (stub message in their JS too) | Yes | |
| CRM / RepairDesk ticket create | Yes | No | Needs their backend hookup |
| Proof of purchase < 6 months note | Yes | No | Not in UI yet |

## Summary

**Checked for real:** public page structure, required fields, condition rules, carriers, categories, AI video UX strings, checkout contact fields.

**Not fully verified:** every SKU price, every accessory question tree, end-to-end payment/shipping integrations (those need their private APIs).

**Still missing vs them (if you want 1:1):**
1. More GoRecell categories (console, VR, monitors, iMac, Surface…)
2. Device-specific accessory questions (S-Pen, etc.)
3. Live buyback price feed (not demo catalog)
4. Real shipping-label + offer tracking backend
5. Multi-store map picker
6. Cloud vision API parity (we intentionally went local-only)
