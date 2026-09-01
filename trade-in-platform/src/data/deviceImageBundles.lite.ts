/**
 * Empty stand-in for the generated deviceImageBundles.ts, used by the LITE
 * embed build (`npm run build:embed:lite`).
 *
 * The full embed inlines ~450 product photos as data: URIs, which is why
 * tg-trade-in.js weighs ~10 MB. That inlining exists for the case where the
 * widget has no image host at all. Once the backend is deployed — which it must
 * be anyway, since quotes are server-authoritative — that same host serves
 * /devices/*, so every photo can be fetched normally and lazily. Shipping them
 * twice only costs the shopper their mobile data.
 *
 * With this stub, deviceImages.ts falls back to `/devices/<stem>.png` paths and
 * assetUrl() resolves them against the configured API origin.
 */
export const deviceImageBundles: Record<string, string> = {};
