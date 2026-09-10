/** Real product photos — bundled into the embed so Framer/Shopify always show devices (not green shapes). */
import type { DeviceModel } from "./catalog";
import { deviceImageBundles } from "./deviceImageBundles";

/** Prefer inlined PNGs; keep remote URLs only as documentation / rare fallbacks. */
export const deviceImages: Record<string, string> = {
  ...deviceImageBundles,
  // alias if catalog id differs from filename
  "galaxy-book3": deviceImageBundles["galaxy-book3"] ?? deviceImageBundles["galaxy-book4"],
};

/**
 * Bundled photo if this build has one, else the API-served path for the same
 * file. The lite embed ships with no inlined images (the API serves /devices),
 * so every one of these has to degrade to a path rather than to `undefined` —
 * an `undefined` src renders an empty box on the category and brand tiles.
 * `assetUrl()` in tradeInApi turns these paths into absolute API URLs.
 */
function bundledOrPath(...stems: string[]): string {
  for (const stem of stems) {
    if (deviceImageBundles[stem]) return deviceImageBundles[stem];
  }
  return `/devices/${stems[0]}.png`;
}

export const categoryImages: Record<string, string> = {
  smartphone: bundledOrPath("iphone-16-pro", "iphone-15"),
  tablet: bundledOrPath("tab-s9", "ipad-10"),
  smartwatch: bundledOrPath("watch-ultra-2", "watch-series-9"),
  laptop: bundledOrPath("macbook-air-m2", "macbook-air-m3"),
  computer: bundledOrPath("imac-24-2024"),
  "gaming-console": bundledOrPath("playstation-5"),
  vr: bundledOrPath("quest-3"),
  monitor: bundledOrPath("studio-display"),
};


/**
 * Bundled photo for a catalog id, or "" when we have none.
 *
 * It intentionally does NOT fall back to a category stock photo: a shopper
 * shown an iPhone tile while picking a Pixel can select the wrong model, and
 * the quote and hand-off that follow are then wrong too. Callers render a
 * neutral placeholder for "" instead.
 */
export function deviceImage(id: string, _device?: DeviceModel): string {
  return deviceImages[id] ?? "";
}
