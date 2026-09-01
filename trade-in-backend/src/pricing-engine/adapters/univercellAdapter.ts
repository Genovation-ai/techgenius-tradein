import type { ProviderAdapter, ScraperResult, ScrapedPrice, ToScrape } from "../types.js";
import { sanitizeScrapedPrice } from "../validate.js";
import { capacitiesMatch, normalizeCapacity } from "../deviceMatch.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/** Maps UniverCell sell-page grades → our competitor conditions. */
const GRADE_MAP: Record<string, ScrapedPrice["condition"]> = {
  flawlessPrice: "excellent",
  goodPrice: "good",
  fairPrice: "fair",
  defectivePrice: "broken",
};

interface CapacityRow {
  capacity: string;
  flawlessPrice?: string;
  goodPrice?: string;
  fairPrice?: string;
  defectivePrice?: string;
}

function slugify(model: string): string {
  return model
    .toLowerCase()
    .replace(/\+/g, "-plus")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Extract sydCapacityPrices JSON array from Next.js RSC HTML. */
export function parseSellPage(html: string): CapacityRow[] {
  const idx = html.indexOf("sydCapacityPrices");
  if (idx < 0) return [];
  const start = html.indexOf("[", idx);
  if (start < 0) return [];

  // Balanced-bracket scan so we don't truncate on nested objects / early `],`
  let depth = 0;
  let end = -1;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (ch === "[") depth += 1;
    else if (ch === "]") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return [];

  const raw = html.slice(start, end + 1).replace(/\\"/g, '"');
  try {
    const parsed = JSON.parse(raw) as CapacityRow[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function findCapacityRow(capacities: CapacityRow[], variant: string): CapacityRow | null {
  const want = normalizeCapacity(variant);
  return (
    capacities.find((c) => capacitiesMatch(c.capacity, want)) ||
    capacities.find((c) => normalizeCapacity(c.capacity) === want) ||
    null
  );
}

function buildSellUrl(make: string, model: string): string {
  const brand = make.toLowerCase();
  const deviceSlug = slugify(model);
  return `https://univercell.ai/sell/mobile/${brand}/${deviceSlug}`;
}

function parseMoney(raw: string | undefined): number {
  if (!raw) return NaN;
  return Number(String(raw).replace(/[^0-9.]/g, ""));
}

/**
 * UniverCell — trade-in prices embedded in Next.js RSC payload on /sell/mobile/{brand}/{model}.
 */
export function createUnivercellAdapter(opts?: { name?: string }): ProviderAdapter {
  const name = opts?.name ?? "univercell";
  return {
    name,
    engine: "cheerio",
    async scrape(devices: ToScrape[]): Promise<ScraperResult> {
      const started = Date.now();
      const rows: ScrapedPrice[] = [];
      const errors: string[] = [];
      let targeted = 0;

      // Deduplicate page fetches when multiple variants share a URL
      const pageCache = new Map<string, CapacityRow[] | "error">();

      for (const d of devices) {
        targeted += 1;
        const url = d.url || buildSellUrl(d.make, d.model);
        const variant = d.variant || "128GB";
        try {
          let capacities: CapacityRow[];
          const cached = pageCache.get(url);
          if (cached === "error") {
            errors.push(`${name}: prior fetch failed @ ${url}`);
            continue;
          }
          if (cached) {
            capacities = cached;
          } else {
            const res = await fetch(url, {
              headers: { "User-Agent": UA, Accept: "text/html" },
            });
            if (!res.ok) {
              pageCache.set(url, "error");
              errors.push(`${name}: HTTP ${res.status} @ ${url}`);
              continue;
            }
            const html = await res.text();
            capacities = parseSellPage(html);
            if (!capacities.length) {
              pageCache.set(url, "error");
              errors.push(`${name}: no sydCapacityPrices @ ${url}`);
              continue;
            }
            pageCache.set(url, capacities);
          }

          const row = findCapacityRow(capacities, variant);
          if (!row) {
            const available = capacities.map((c) => c.capacity).join(", ");
            errors.push(
              `${name}: no capacity match for ${d.model} ${variant} @ ${url} (have: ${available})`,
            );
            continue;
          }

          let grades = 0;
          for (const [field, cond] of Object.entries(GRADE_MAP)) {
            const price = parseMoney(row[field as keyof CapacityRow] as string | undefined);
            if (!price || price < 5) continue;
            const scraped = sanitizeScrapedPrice({
              competitor_name: name,
              make: d.make,
              model: d.model,
              product_id: d.productId,
              // Always persist the requested variant label so catalog joins stay stable,
              // but only after an exact capacity match above.
              variant,
              condition: cond,
              trade_in_price: price,
              sell_price: null,
              currency: "CAD",
              raw: {
                source: url,
                engine: "univercell-rsc",
                payload: { field, capacity: row.capacity, requestedVariant: variant },
              },
              scraped_at: new Date().toISOString(),
            });
            if (scraped) {
              rows.push(scraped);
              grades += 1;
            }
          }
          if (!grades) {
            errors.push(`${name}: capacity ${row.capacity} had no usable prices @ ${url}`);
          }
        } catch (e) {
          errors.push(`${name}: ${e instanceof Error ? e.message : String(e)} @ ${url}`);
        }
      }

      return {
        provider: name,
        engine: "cheerio",
        rows,
        errors,
        durationMs: Date.now() - started,
        targeted,
        discovered: rows.length,
      };
    },
  };
}
