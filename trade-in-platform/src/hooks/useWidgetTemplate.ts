import { useEffect, useState } from "react";
import { DEFAULT_WIDGET_TEMPLATE, embedOrgSlug, fetchWidgetTemplate } from "../lib/tradeInApi";

/**
 * Frontend template the widget renders with, chosen by staff in Admin →
 * Settings and applied as `data-template` on the widget root.
 *
 * Mirrors how `frontend_price_source` lets staff choose which competitor the
 * quotes reflect: one server-side setting, read by the widget at runtime.
 *
 * Renders with the default until the lookup resolves so the sell flow is never
 * blocked on a cosmetic setting. A `?tg_template=` query param overrides it,
 * which is how staff preview a template before switching the live store.
 */
export function useWidgetTemplate(): string {
  const [template, setTemplate] = useState<string>(() => previewOverride() || DEFAULT_WIDGET_TEMPLATE);

  useEffect(() => {
    if (previewOverride()) return;
    let cancelled = false;
    void fetchWidgetTemplate(embedOrgSlug()).then((t) => {
      if (!cancelled) setTemplate(t);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return template;
}

function previewOverride(): string | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("tg_template");
  return value ? value.trim() || null : null;
}
