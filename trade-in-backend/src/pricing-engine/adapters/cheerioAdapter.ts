import * as cheerio from "cheerio";
import type { ProviderAdapter, ScraperResult, ScrapedPrice, ToScrape } from "../types.js";
import { parsePriceText, sanitizeScrapedPrice } from "../validate.js";
import { normalizeCondition, type CompetitorCondition } from "../types.js";

const USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
];

function pickUa(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * Cheerio adapter — fast static HTML path.
 * Example competitor: GoRecell-style product pages (config-driven selectors).
 */
export function createCheerioAdapter(opts: {
  name: string;
  defaultCurrency?: string;
}): ProviderAdapter {
  return {
    name: opts.name,
    engine: "cheerio",
    async scrape(devices: ToScrape[], scrapeOpts): Promise<ScraperResult> {
      const started = Date.now();
      const timeoutMs = scrapeOpts?.timeoutMs ?? 25_000;
      const rows: ScrapedPrice[] = [];
      const errors: string[] = [];
      let targeted = 0;

      for (const d of devices) {
        if (!d.url) continue;
        targeted += 1;
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), timeoutMs);
          const res = await fetch(d.url, {
            signal: ctrl.signal,
            headers: {
              "User-Agent": pickUa(),
              Accept: "text/html,application/xhtml+xml",
            },
          });
          clearTimeout(timer);
          if (!res.ok) {
            errors.push(`${opts.name}: HTTP ${res.status} for ${d.url}`);
            continue;
          }
          const html = await res.text();
          const $ = cheerio.load(html);
          const conditions = (Object.keys(d.selectors ?? {}) as string[]) || [];
          const toTry =
            conditions.length > 0
              ? conditions
              : (["excellent", "good", "fair", "cracked", "broken"] as CompetitorCondition[]);

          for (const condRaw of toTry) {
            const cond = normalizeCondition(condRaw);
            if (!cond) continue;
            const selector =
              d.selectors?.[condRaw as keyof typeof d.selectors] ||
              d.selectors?.[cond as keyof typeof d.selectors];
            if (!selector) continue;
            // Support "sel1, sel2" — take first match with a price
            let price: number | null = null;
            for (const sel of String(selector).split(",").map((s) => s.trim().replace(/::text$/, ""))) {
              const text = $(sel).first().text();
              price = parsePriceText(text);
              if (price) break;
            }
            // Fallback: look for $-amounts near condition keywords
            if (!price) {
              const body = $("body").text();
              const re = new RegExp(`${cond}[^$]{0,40}\\$\\s*([\\d,]+(?:\\.\\d{2})?)`, "i");
              const m = body.match(re);
              if (m) price = parsePriceText(m[0]);
            }
            if (!price) continue;
            const row = sanitizeScrapedPrice({
              competitor_name: opts.name,
              make: d.make,
              model: d.model,
              product_id: d.productId,
              variant: d.variant,
              condition: cond,
              trade_in_price: price,
              sell_price: null,
              currency: opts.defaultCurrency ?? "CAD",
              raw: { source: d.url, engine: "cheerio", payload: { selector } },
              scraped_at: new Date().toISOString(),
            });
            if (row) rows.push(row);
          }
        } catch (e) {
          errors.push(`${opts.name}: ${e instanceof Error ? e.message : String(e)} @ ${d.url}`);
        }
        await sleep(400 + Math.floor(Math.random() * 400));
      }

      return {
        provider: opts.name,
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
