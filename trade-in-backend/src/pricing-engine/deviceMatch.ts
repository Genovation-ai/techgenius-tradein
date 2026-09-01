/**
 * Shared device / storage matching for competitor scrapers.
 * Prevents Pro/Max/Plus/Ultra/Mini/XL/FE cross-matches and capacity misattribution.
 */

const MODIFIERS = ["pro", "max", "plus", "ultra", "mini", "xl", "fe"] as const;

export function normalizeCapacity(raw: string): string {
  return String(raw || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/gigabytes?/g, "gb")
    .replace(/terabytes?/g, "tb");
}

/** Known storage sizes (largest first) so glued titles like iphone15128gb resolve to 128. */
const KNOWN_STORAGE_GB = [2048, 1024, 512, 256, 128, 64, 32, 16, 8];

/** Convert capacity text to GB units (1TB → 1024). Returns null if not parseable. */
export function capacityToGb(raw: string): number | null {
  const n = normalizeCapacity(raw);
  const tb = n.match(/(\d+(?:\.\d+)?)tb/);
  if (tb) return Math.round(parseFloat(tb[1]) * 1024);

  // Standalone / non-digit-bounded sizes (largest first): "128gb", "-128gb"
  for (const k of KNOWN_STORAGE_GB) {
    if (new RegExp(`(?:^|[^0-9])${k}gb(?:$|[^0-9a-z])`).test(n)) return k;
  }
  // Glued titles like iphone15128gb: letter + optional 1–2 model digits + storage
  for (const k of KNOWN_STORAGE_GB) {
    if (new RegExp(`[a-z](?:\\d{1,2})?${k}gb(?:$|[^0-9a-z])`).test(n)) return k;
  }
  const gb = n.match(/(?:^|[^0-9])(\d+)gb(?:$|[^0-9a-z])/);
  return gb ? parseInt(gb[1], 10) : null;
}

/** Canonical storage label for catalog (e.g. 1024GB → 1TB). */
export function normalizeStorageLabel(raw: string): string {
  const s = String(raw || "").trim();
  const tb = s.match(/(\d+(?:\.\d+)?)\s*TB/i);
  if (tb) {
    const n = tb[1].replace(/\.0$/, "");
    return `${n}TB`;
  }
  const gb = s.match(/(\d+)\s*GB/i);
  if (gb) {
    const n = parseInt(gb[1], 10);
    if (n === 1024) return "1TB";
    if (n === 2048) return "2TB";
    return `${n}GB`;
  }
  const mm = s.match(/(\d+)\s*mm/i);
  if (mm) return `${mm[1]}mm`;
  return s;
}

/** Alternate keys to try when looking up prices (1TB ↔ 1024GB). */
export function storageLookupKeys(raw: string): string[] {
  const trimmed = String(raw || "").trim();
  const label = normalizeStorageLabel(trimmed);
  const keys = new Set<string>();
  if (trimmed) keys.add(trimmed);
  if (label) keys.add(label);
  const gb = capacityToGb(trimmed || label);
  if (gb === 1024) {
    keys.add("1TB");
    keys.add("1024GB");
  } else if (gb === 2048) {
    keys.add("2TB");
    keys.add("2048GB");
  } else if (gb != null && gb > 0) {
    keys.add(`${gb}GB`);
  }
  return [...keys];
}

export function capacitiesMatch(a: string, b: string): boolean {
  const na = normalizeCapacity(a);
  const nb = normalizeCapacity(b);
  if (!na || !nb) return false;

  const ga = capacityToGb(na);
  const gb = capacityToGb(nb);
  if (ga != null && gb != null) return ga === gb;

  const ma = na.match(/(\d+)mm/)?.[1];
  const mb = nb.match(/(\d+)mm/)?.[1];
  if (ma && mb) return ma === mb;

  return na.includes(nb) || nb.includes(na);
}

function hasModifier(text: string, mod: string): boolean {
  if (mod === "plus") return /\+|plus\b/.test(text);
  return new RegExp(`\\b${mod}\\b`).test(text);
}

/** Modifiers must be present on both sides or neither (symmetric). */
export function modifiersMatch(wantModel: string, candidateTitle: string): boolean {
  const want = wantModel.toLowerCase();
  const got = candidateTitle.toLowerCase();
  for (const mod of MODIFIERS) {
    if (hasModifier(want, mod) !== hasModifier(got, mod)) return false;
  }
  return true;
}

/**
 * Strict catalog/title match used by Bell / TELUS / spot-checks.
 * Requires model phrase + modifiers + storage capacity.
 */
export function matchDeviceTitle(opts: {
  title: string;
  model: string;
  variant: string;
  storageText?: string | null;
  requireStorage?: boolean;
}): boolean {
  const title = opts.title.toLowerCase().trim();
  const model = opts.model.toLowerCase().trim();
  if (!title || !model) return false;

  // Full model string must appear (prevents "S24" matching only via tokens)
  if (!title.includes(model)) return false;
  if (!modifiersMatch(model, title)) return false;

  const storageHay = `${title} ${opts.storageText || ""}`;
  const hasCapacity = capacitiesMatch(storageHay, opts.variant);
  if (opts.requireStorage !== false && !hasCapacity) return false;
  return true;
}

export function pickBestTitleMatch<T>(
  items: T[],
  opts: {
    getTitle: (item: T) => string;
    getStorage?: (item: T) => string | null | undefined;
    model: string;
    variant: string;
    requireStorage?: boolean;
  },
): T | undefined {
  const matches = items.filter((item) =>
    matchDeviceTitle({
      title: opts.getTitle(item),
      model: opts.model,
      variant: opts.variant,
      storageText: opts.getStorage?.(item),
      requireStorage: opts.requireStorage,
    }),
  );
  if (!matches.length) return undefined;
  const want = `${opts.model} ${opts.variant}`.toLowerCase().replace(/\s+/g, "");
  const exact = matches.find((item) => opts.getTitle(item).toLowerCase().replace(/\s+/g, "") === want);
  if (exact) return exact;
  // Prefer shortest title (base model over accidental longer siblings)
  return [...matches].sort((a, b) => opts.getTitle(a).length - opts.getTitle(b).length)[0];
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
