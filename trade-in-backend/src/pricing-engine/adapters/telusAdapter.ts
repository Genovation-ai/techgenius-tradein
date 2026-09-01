import type { ProviderAdapter, ScraperResult, ScrapedPrice, ToScrape } from "../types.js";
import { sanitizeScrapedPrice } from "../validate.js";
import { pickBestTitleMatch, sleep } from "../deviceMatch.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const TRADE_IN_URL = "https://www.telus.com/mobility/trade-in";
const BACKEND = "https://www.telus.com/mobility/trade-in/backend";

interface TelusDevice {
  modelCd?: string;
  storageCd?: string;
  marketValueAmt?: number;
  productDescription?: Array<{ messageTxt?: string; localeCd?: string }>;
}

function deviceTitle(d: TelusDevice): string {
  return (
    d.productDescription?.find((p) => p.localeCd === "EN")?.messageTxt ||
    d.productDescription?.[0]?.messageTxt ||
    d.modelCd ||
    ""
  );
}

async function createTelusContext(): Promise<{ salesTransactionId: string }> {
  const res = await fetch(`${BACKEND}/context`, {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      lineOfBusiness: "mobility",
      orderType: "activation",
      customerType: "undeclared",
      offerType: "CONSUMER",
    }),
  });
  if (!res.ok) throw new Error(`context HTTP ${res.status}`);
  const ctx = (await res.json()) as { salesTransactionId?: string; id?: string };
  const salesTransactionId = ctx.salesTransactionId;
  if (!salesTransactionId) {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ userAgent: UA, locale: "en-CA" });
      let captured = "";
      page.on("response", async (r) => {
        if (r.url().includes("/mobility/trade-in/backend/context") && r.request().method() === "POST") {
          try {
            const j = (await r.json()) as { salesTransactionId?: string };
            if (j.salesTransactionId) captured = j.salesTransactionId;
          } catch {
            /* ignore */
          }
        }
      });
      await page.goto(TRADE_IN_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForTimeout(5000);
      if (!captured) throw new Error("no salesTransactionId from browser session");
      return { salesTransactionId: captured };
    } finally {
      await browser.close();
    }
  }
  return { salesTransactionId };
}

function buildSearchQuery(_make: string, model: string, variant: string): string {
  const storage = variant.replace(/gb/i, " GB").replace(/\s+/g, " ").trim();
  return `${model} ${storage}`.replace(/\s+/g, " ").trim();
}

async function fetchDevices(
  salesTransactionId: string,
  query: string,
  attempt = 1,
): Promise<Record<string, TelusDevice>> {
  const q = encodeURIComponent(query);
  const url = `${BACKEND}/devices?device=${q}&salesTransactionId=${salesTransactionId}&lang=en`;
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if ((res.status === 429 || res.status >= 500) && attempt < 4) {
    await sleep(400 * attempt * attempt);
    return fetchDevices(salesTransactionId, query, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} @ ${url}`);
  return (await res.json()) as Record<string, TelusDevice>;
}

/**
 * TELUS Trade-In — /mobility/trade-in/backend/devices search API.
 * Returns marketValueAmt (max market estimate, not condition-tiered).
 */
export function createTelusAdapter(opts?: { name?: string }): ProviderAdapter {
  const name = opts?.name ?? "telus";
  return {
    name,
    engine: "cheerio",
    async scrape(devices: ToScrape[]): Promise<ScraperResult> {
      const started = Date.now();
      const rows: ScrapedPrice[] = [];
      const errors: string[] = [];
      let targeted = 0;

      let salesTransactionId: string;
      try {
        ({ salesTransactionId } = await createTelusContext());
      } catch (e) {
        return {
          provider: name,
          engine: "cheerio",
          rows: [],
          errors: [`${name}: context failed: ${e instanceof Error ? e.message : String(e)}`],
          durationMs: Date.now() - started,
          targeted: devices.length,
          discovered: 0,
        };
      }

      for (const d of devices) {
        targeted += 1;
        const variant = d.variant || "128GB";
        const query = buildSearchQuery(d.make, d.model, variant);
        try {
          await sleep(200);
          const data = await fetchDevices(salesTransactionId, query);
          const items = Object.values(data);
          const hit = pickBestTitleMatch(items, {
            getTitle: (item) => `${deviceTitle(item)} ${item.modelCd || ""}`,
            getStorage: (item) => item.storageCd || deviceTitle(item),
            model: d.model,
            variant,
            requireStorage: true,
          });
          if (!hit?.marketValueAmt || hit.marketValueAmt < 5) {
            errors.push(`${name}: no marketValueAmt for ${d.model} ${variant}`);
            continue;
          }
          const scraped = sanitizeScrapedPrice({
            competitor_name: name,
            make: d.make,
            model: d.model,
            product_id: d.productId,
            variant,
            condition: "excellent",
            trade_in_price: hit.marketValueAmt,
            sell_price: null,
            currency: "CAD",
            raw: {
              source: TRADE_IN_URL,
              engine: "telus-backend",
              payload: {
                modelCd: hit.modelCd,
                storageCd: hit.storageCd,
                title: deviceTitle(hit),
              },
            },
            scraped_at: new Date().toISOString(),
          });
          if (scraped) rows.push(scraped);
        } catch (e) {
          errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
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
