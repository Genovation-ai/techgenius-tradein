/**
 * The order a customer expects to find things in.
 *
 * Brands. Apple, Samsung, then Google lead, in that order — the three the
 * shop actually takes in, named by the owner. The rest follow alphabetically
 * so a brand is where you would guess. "All brands" goes last: it is the
 * escape hatch, not the default — leading with it was why the first screen
 * dumped a Motorola beside a Galaxy beside an iPhone with nothing in common.
 *
 * Models. Newest first. There is no release date on a device, but the
 * generation is in the name — iPhone 17, Galaxy S25, Pixel 9 — and where it is
 * not, price is a fair stand-in, since what a phone is worth tracks how new it
 * is closely enough for ordering. Within a generation the dearer variant leads
 * (Pro Max above Pro above base), which is the order the manufacturer lists
 * them in too.
 */

const FIRST_BRANDS = ["Apple", "Samsung", "Google"];

export function orderBrands(brands: string[]): string[] {
  const pinned = FIRST_BRANDS.filter((b) => brands.includes(b));
  const rest = brands.filter((b) => !FIRST_BRANDS.includes(b)).sort((a, b) => a.localeCompare(b));
  return [...pinned, ...rest];
}

/**
 * The year a model most likely shipped, read from its name.
 *
 * A bare generation number does not compare across lines: a Galaxy A71 is a
 * 2020 budget phone and a Galaxy S25 is a 2025 flagship, and 71 > 25 put the
 * A71 at the top of Samsung. So each family maps its number to a year using
 * the cadence the manufacturer actually kept — iPhone n shipped in 2008 + n,
 * Galaxy S20 onward in 2000 + n, the A-series' last digit stepping one a year
 * from 2019. The mapping is approximate by a year here and there and that is
 * fine: it only has to put things in order, never to state a date.
 */
export function estimatedYear(name: string): number | null {
  const n = name.toLowerCase();
  let m: RegExpMatchArray | null;

  if ((m = n.match(/\biphone\s*(\d{1,2})\b/))) return 2008 + Number(m[1]); // iPhone 15 → 2023
  if (/\biphone\s*(x|xs|xr)\b/.test(n)) return 2017;
  if (/\biphone\s*se\b/.test(n)) return /2022|3rd/.test(n) ? 2022 : /2020|2nd/.test(n) ? 2020 : 2016;
  if ((m = n.match(/\bpixel\s*(\d{1,2})\b/))) return 2015 + Number(m[1]);
  if (/\bpixel\b/.test(n) && !/\d/.test(n)) return 2016;

  // Samsung
  if ((m = n.match(/\bgalaxy\s+s\s*(\d{1,2})\b/))) {
    const g = Number(m[1]);
    return g >= 20 ? 2000 + g : 2009 + g; // S10 → 2019, S9 → 2018
  }
  if ((m = n.match(/\bgalaxy\s+(?:z\s*)?(?:fold|flip)\s*(\d)?\b/))) return 2018 + Number(m[1] ?? 1);
  if ((m = n.match(/\bgalaxy\s+note\s*(\d{1,2})\b/))) {
    const g = Number(m[1]);
    return g >= 20 ? 2000 + g : 2010 + g; // Note 10 → 2019 (approx.)
  }
  if ((m = n.match(/\bgalaxy\s+a\s*(\d)(\d)\b/))) return 2019 + Number(m[2]); // A55 → 2024
  if ((m = n.match(/\bgalaxy\s+tab\s+s\s*(\d{1,2})\b/))) return 2014 + Number(m[1]);
  if ((m = n.match(/\bgalaxy\s+watch\s*(\d)\b/))) return 2020 + Number(m[1]);

  // Others with a plain generation
  if ((m = n.match(/\b(?:oneplus|nord)\s*(\d{1,2})\b/))) return 2012 + Number(m[1]);
  if ((m = n.match(/\bipad\s*(?:pro|air|mini)?\s*(\d{1,2})\b/))) return 2010 + Number(m[1]);

  // A year written in the name wins outright
  if ((m = n.match(/\b(20[12]\d)\b/))) return Number(m[1]);
  return null;
}

export function newestFirst<T extends { name: string; basePrice?: number }>(devices: T[]): T[] {
  return [...devices].sort((a, b) => {
    const ga = estimatedYear(a.name);
    const gb = estimatedYear(b.name);
    if (ga != null && gb != null && ga !== gb) return gb - ga;
    if (ga != null && gb == null) return -1;
    if (ga == null && gb != null) return 1;
    const pa = a.basePrice ?? 0;
    const pb = b.basePrice ?? 0;
    if (pa !== pb) return pb - pa;
    return a.name.localeCompare(b.name);
  });
}
