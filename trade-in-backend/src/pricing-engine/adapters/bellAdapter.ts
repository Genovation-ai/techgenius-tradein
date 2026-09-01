import type { ProviderAdapter, ScraperResult, ScrapedPrice, ToScrape } from "../types.js";
import { sanitizeScrapedPrice } from "../validate.js";
import { pickBestTitleMatch, sleep } from "../deviceMatch.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const SBE_BASE = "https://ws1-bell.sbeglobalcare.com/gc-ws-connect-1.9/rest/gcWsConnect/";
const TRADE_IN_URL = "https://www.bell.ca/Mobility/Trade-in-program";

async function corsFetch(uri: string, auth = false, attempt = 1): Promise<unknown> {
  const params = auth
    ? new URLSearchParams({ key: "TradeIn_SBE", baseAddress: SBE_BASE, uri })
    : new URLSearchParams({ baseAddress: SBE_BASE, uri });
  const path = auth ? "CorsProxyAuthenticate" : "corsproxy";
  const res = await fetch(`https://www.bell.ca/ajax/toolbox/${path}?${params}`, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
      Referer: TRADE_IN_URL,
    },
  });
  const raw = await res.text();
  const trimmed = raw.trim();
  // Bell's proxy intermittently returns an HTML error/challenge page under load.
  if (!res.ok || trimmed.startsWith("<!") || trimmed.startsWith("<html") || trimmed.startsWith("<HTML")) {
    if (attempt < 5) {
      await sleep(350 * attempt * attempt);
      return corsFetch(uri, auth, attempt + 1);
    }
    throw new Error(`Bell proxy bad response HTTP ${res.status}: ${trimmed.slice(0, 60)}`);
  }
  try {
    return JSON.parse(JSON.parse(raw) as string);
  } catch {
    try {
      return JSON.parse(raw);
    } catch {
      if (attempt < 5) {
        await sleep(350 * attempt * attempt);
        return corsFetch(uri, auth, attempt + 1);
      }
      throw new Error(`Bell proxy non-JSON: ${trimmed.slice(0, 60)}`);
    }
  }
}

async function login(): Promise<string> {
  const auth = (await corsFetch("login?org_code={0}&entity_code={1}&username={2}&password={3}", true)) as {
    session_id?: string;
  };
  if (!auth.session_id) throw new Error("no session_id");
  return auth.session_id;
}

async function loadCatalog(sessionId: string) {
  const cat = (await corsFetch(
    `getCatalogProductsLite?session_id=${sessionId}&category_code=TRADEIN&view_manufacturer=true&view_references_type=WEB_TAG&cache=true`,
  )) as { products?: Array<{ product_code: string; product_title: string }> };
  return cat.products ?? [];
}

/**
 * Bell Trade-In — SBE GlobalCare API via bell.ca CORS proxy.
 * Returns a single max buyback estimate per device (carrier grade, not condition-tiered).
 *
 * The CORS proxy rate-limits under burst traffic; we pace estimate calls and retry HTML failures.
 */
export function createBellAdapter(opts?: { name?: string }): ProviderAdapter {
  const name = opts?.name ?? "bell";
  return {
    name,
    engine: "cheerio",
    async scrape(devices: ToScrape[]): Promise<ScraperResult> {
      const started = Date.now();
      const rows: ScrapedPrice[] = [];
      const errors: string[] = [];
      let targeted = 0;

      let sessionId: string;
      try {
        sessionId = await login();
      } catch (e) {
        return {
          provider: name,
          engine: "cheerio",
          rows: [],
          errors: [`${name}: auth failed: ${e instanceof Error ? e.message : String(e)}`],
          durationMs: Date.now() - started,
          targeted: devices.length,
          discovered: 0,
        };
      }

      let catalog: Array<{ product_code: string; product_title: string }> = [];
      try {
        catalog = await loadCatalog(sessionId);
        if (!catalog.length) throw new Error("empty catalog");
      } catch (e) {
        try {
          await sleep(800);
          sessionId = await login();
          catalog = await loadCatalog(sessionId);
        } catch (e2) {
          return {
            provider: name,
            engine: "cheerio",
            rows: [],
            errors: [
              `${name}: catalog failed: ${e2 instanceof Error ? e2.message : String(e2)} (after ${e instanceof Error ? e.message : String(e)})`,
            ],
            durationMs: Date.now() - started,
            targeted: devices.length,
            discovered: 0,
          };
        }
      }

      if (!catalog.length) {
        return {
          provider: name,
          engine: "cheerio",
          rows: [],
          errors: [`${name}: empty TRADEIN catalog`],
          durationMs: Date.now() - started,
          targeted: devices.length,
          discovered: 0,
        };
      }

      for (const d of devices) {
        targeted += 1;
        const variant = d.variant || "128GB";
        const hit = pickBestTitleMatch(catalog, {
          getTitle: (p) => p.product_title,
          model: d.model,
          variant,
        });
        if (!hit) {
          errors.push(`${name}: no catalog match for ${d.make} ${d.model} ${variant}`);
          continue;
        }
        try {
          await sleep(350);
          let est = (await corsFetch(
            `getBuyBackProductsEstimate?session_id=${sessionId}&buyer_code=REDEEM&product_code=${hit.product_code}`,
          )) as { products?: Array<{ product_title: string; buyback_value_max?: number }> };

          if (!est?.products?.[0]?.buyback_value_max) {
            await sleep(500);
            sessionId = await login();
            est = (await corsFetch(
              `getBuyBackProductsEstimate?session_id=${sessionId}&buyer_code=REDEEM&product_code=${hit.product_code}`,
            )) as { products?: Array<{ product_title: string; buyback_value_max?: number }> };
          }

          const product = est.products?.[0];
          const price = product?.buyback_value_max;
          if (!price || price < 5) {
            errors.push(`${name}: no buyback_value_max for ${hit.product_code} (${hit.product_title})`);
            continue;
          }
          const scraped = sanitizeScrapedPrice({
            competitor_name: name,
            make: d.make,
            model: d.model,
            product_id: d.productId,
            variant,
            condition: "excellent",
            trade_in_price: price,
            sell_price: null,
            currency: "CAD",
            raw: {
              source: TRADE_IN_URL,
              engine: "bell-sbe",
              payload: {
                product_code: hit.product_code,
                product_title: product?.product_title || hit.product_title,
              },
            },
            scraped_at: new Date().toISOString(),
          });
          if (scraped) rows.push(scraped);
        } catch (e) {
          errors.push(
            `${name}: estimate failed for ${hit.product_title}: ${e instanceof Error ? e.message : String(e)}`,
          );
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
