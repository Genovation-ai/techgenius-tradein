import { useEffect, useState } from "react";
import { embedOrgSlug, fetchOrgBranding, type OrgBranding } from "../lib/tradeInApi";

const FALLBACK: OrgBranding = {
  companyName: "Tech Genius",
  brandColor: null,
  ctaColor: null,
  logoUrl: null,
  plan: null,
};

/**
 * Resolves the merchant whose site this widget is embedded on, from the
 * `data-org` attribute on the mount element.
 *
 * Starts on the fallback rather than empty: the header renders immediately with
 * a name and swaps once the real one arrives, instead of flashing a blank space
 * on every load. A tenant's own colours are applied as CSS variables on the
 * widget root, so the shop's palette flows through the existing styles without
 * every component needing to know about theming.
 */
export function useOrgBranding(): OrgBranding {
  const [branding, setBranding] = useState<OrgBranding>(FALLBACK);

  useEffect(() => {
    let cancelled = false;
    void fetchOrgBranding(embedOrgSlug()).then((b) => {
      if (cancelled) return;
      setBranding(b);

      const root = document.querySelector<HTMLElement>(".tg-trade-in-host");
      if (!root) return;
      if (b.brandColor) root.style.setProperty("--forest", b.brandColor);
      if (b.ctaColor) {
        root.style.setProperty("--cta", b.ctaColor);
        root.style.setProperty("--cta-hover", b.ctaColor);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return branding;
}
