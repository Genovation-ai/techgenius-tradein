import type { ProviderAdapter, ScraperResult, ScrapedPrice, ToScrape } from "../types.js";
import { parsePriceText, sanitizeScrapedPrice } from "../validate.js";
import { normalizeCondition, type CompetitorCondition } from "../types.js";

/**
 * Playwright adapter — escalate for JS-heavy competitor pages.
 * Lazy-imports playwright so Cheerio-only deploys still boot.
 */
export function createPlaywrightAdapter(opts: {
  name: string;
  defaultCurrency?: string;
}): ProviderAdapter {
  return {
    name: opts.name,
    engine: "playwright",
    async scrape(devices: ToScrape[], scrapeOpts): Promise<ScraperResult> {
      const started = Date.now();
      const timeoutMs = scrapeOpts?.timeoutMs ?? 45_000;
      const rows: ScrapedPrice[] = [];
      const errors: string[] = [];
      let targeted = 0;

      let chromium: typeof import("playwright").chromium | null = null;
      try {
        ({ chromium } = await import("playwright"));
      } catch (e) {
        return {
          provider: opts.name,
          engine: "playwright",
          rows: [],
          errors: [`playwright not available: ${e instanceof Error ? e.message : String(e)}`],
          durationMs: Date.now() - started,
          targeted: 0,
          discovered: 0,
        };
      }

      const browser = await chromium.launch({ headless: true });
      try {
        for (const d of devices) {
          if (!d.url) continue;
          targeted += 1;
          const page = await browser.newPage({
            userAgent:
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
          });
          try {
            await page.goto(d.url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
            await page.waitForTimeout(800);

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
              let price: number | null = null;
              if (selector) {
                for (const sel of String(selector).split(",").map((s) => s.trim().replace(/::text$/, ""))) {
                  try {
                    const el = page.locator(sel).first();
                    if ((await el.count()) > 0) {
                      price = parsePriceText(await el.innerText());
                      if (price) break;
                    }
                  } catch {
                    /* try next */
                  }
                }
              }
              if (!price) {
                const body = await page.locator("body").innerText();
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
                raw: { source: d.url, engine: "playwright", payload: { selector } },
                scraped_at: new Date().toISOString(),
              });
              if (row) rows.push(row);
            }
          } catch (e) {
            errors.push(`${opts.name}: ${e instanceof Error ? e.message : String(e)} @ ${d.url}`);
          } finally {
            await page.close().catch(() => undefined);
          }
        }
      } finally {
        await browser.close().catch(() => undefined);
      }

      return {
        provider: opts.name,
        engine: "playwright",
        rows,
        errors,
        durationMs: Date.now() - started,
        targeted,
        discovered: rows.length,
      };
    },
  };
}
