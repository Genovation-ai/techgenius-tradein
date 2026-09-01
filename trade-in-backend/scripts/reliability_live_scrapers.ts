/**
 * Multi-run live scraper reliability harness.
 * Run: npx tsx scripts/reliability_live_scrapers.ts
 *
 * - Hits UniverCell / Bell / TELUS adapters repeatedly
 * - Independently re-fetches live market sources for spot-checks
 * - Fails (exit 1) if prices are missing, wildly inconsistent, or diverge from live spot-checks
 */
import { migrate } from "../src/db/migrate.js";
import { buildAdapters } from "../src/pricing-engine/orchestrator.js";
import type { ScrapedPrice, ToScrape } from "../src/pricing-engine/types.js";
import { parseSellPage } from "../src/pricing-engine/adapters/univercellAdapter.js";
import { capacitiesMatch, pickBestTitleMatch } from "../src/pricing-engine/deviceMatch.js";

const RUNS = Number(process.env.SCRAPER_RELIABILITY_RUNS || 4);
const TOLERANCE = Number(process.env.SCRAPER_PRICE_TOLERANCE || 0); // CAD; live markets usually static within a day
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const CORE: ToScrape[] = [
  { productId: "iphone-15", make: "Apple", model: "iPhone 15", variant: "128GB", url: "https://univercell.ai/sell/mobile/apple/iphone-15" },
  { productId: "iphone-15", make: "Apple", model: "iPhone 15", variant: "256GB", url: "https://univercell.ai/sell/mobile/apple/iphone-15" },
  { productId: "iphone-15-pro", make: "Apple", model: "iPhone 15 Pro", variant: "128GB", url: "https://univercell.ai/sell/mobile/apple/iphone-15-pro" },
  { productId: "iphone-15-pro-max", make: "Apple", model: "iPhone 15 Pro Max", variant: "256GB", url: "https://univercell.ai/sell/mobile/apple/iphone-15-pro-max" },
  { productId: "iphone-16", make: "Apple", model: "iPhone 16", variant: "128GB", url: "https://univercell.ai/sell/mobile/apple/iphone-16" },
  { productId: "iphone-16-pro", make: "Apple", model: "iPhone 16 Pro", variant: "128GB", url: "https://univercell.ai/sell/mobile/apple/iphone-16-pro" },
  { productId: "iphone-16-pro-max", make: "Apple", model: "iPhone 16 Pro Max", variant: "256GB", url: "https://univercell.ai/sell/mobile/apple/iphone-16-pro-max" },
  { productId: "s24-ultra", make: "Samsung", model: "Galaxy S24 Ultra", variant: "256GB", url: "https://univercell.ai/sell/mobile/samsung/galaxy-s24-ultra" },
  { productId: "s25-ultra", make: "Samsung", model: "Galaxy S25 Ultra", variant: "256GB", url: "https://univercell.ai/sell/mobile/samsung/galaxy-s25-ultra" },
  { productId: "pixel-9", make: "Google", model: "Pixel 9", variant: "128GB", url: "https://univercell.ai/sell/mobile/google/pixel-9" },
  { productId: "pixel-9-pro", make: "Google", model: "Pixel 9 Pro", variant: "128GB", url: "https://univercell.ai/sell/mobile/google/pixel-9-pro" },
];

type Key = string; // competitor|product|variant|condition
type Series = Map<Key, number[]>;

function keyOf(r: Pick<ScrapedPrice, "competitor_name" | "product_id" | "variant" | "condition">): Key {
  return `${r.competitor_name}|${r.product_id}|${r.variant}|${r.condition}`;
}

function money(n: number | null | undefined): string {
  return n == null ? "—" : `$${n}`;
}

function summarize(series: Series) {
  const rows: Array<{
    key: Key;
    n: number;
    min: number;
    max: number;
    mean: number;
    drift: number;
    values: number[];
  }> = [];
  for (const [key, vals] of series) {
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    rows.push({ key, n: vals.length, min, max, mean, drift: max - min, values: vals });
  }
  return rows.sort((a, b) => a.key.localeCompare(b.key));
}

/** Independent UniverCell spot-check — same RSC parser the adapter uses. */
async function spotUnivercell(d: ToScrape): Promise<Record<string, number>> {
  const url = d.url!;
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" } });
  if (!res.ok) throw new Error(`UC spot HTTP ${res.status}`);
  const html = await res.text();
  const capacities = parseSellPage(html);
  if (!capacities.length) throw new Error("UC spot: no sydCapacityPrices");
  const row = capacities.find((c) => capacitiesMatch(c.capacity, d.variant || ""));
  if (!row) throw new Error(`UC spot: no capacity match for ${d.variant}`);
  const out: Record<string, number> = {};
  const map: Record<string, string> = {
    flawlessPrice: "excellent",
    goodPrice: "good",
    fairPrice: "fair",
    defectivePrice: "broken",
  };
  for (const [field, cond] of Object.entries(map)) {
    const p = Number(String((row as Record<string, string | undefined>)[field] || "").replace(/[^0-9.]/g, ""));
    if (p > 0) out[cond] = p;
  }
  return out;
}

/** Independent Bell spot-check for one device. */
async function spotBell(d: ToScrape): Promise<number> {
  const SBE = "https://ws1-bell.sbeglobalcare.com/gc-ws-connect-1.9/rest/gcWsConnect/";
  async function cors(uri: string, auth = false, attempt = 1): Promise<unknown> {
    const params = auth
      ? new URLSearchParams({ key: "TradeIn_SBE", baseAddress: SBE, uri })
      : new URLSearchParams({ baseAddress: SBE, uri });
    const path = auth ? "CorsProxyAuthenticate" : "corsproxy";
    const res = await fetch(`https://www.bell.ca/ajax/toolbox/${path}?${params}`, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
        Referer: "https://www.bell.ca/Mobility/Trade-in-program",
      },
    });
    const raw = await res.text();
    const trimmed = raw.trim();
    if (!res.ok || trimmed.startsWith("<!") || trimmed.startsWith("<html") || trimmed.startsWith("<HTML")) {
      if (attempt < 5) {
        await new Promise((r) => setTimeout(r, 350 * attempt * attempt));
        return cors(uri, auth, attempt + 1);
      }
      throw new Error(`Bell spot bad response HTTP ${res.status}`);
    }
    try {
      return JSON.parse(JSON.parse(raw) as string);
    } catch {
      try {
        return JSON.parse(raw);
      } catch {
        if (attempt < 5) {
          await new Promise((r) => setTimeout(r, 350 * attempt * attempt));
          return cors(uri, auth, attempt + 1);
        }
        throw new Error("Bell spot non-JSON");
      }
    }
  }
  const auth = (await cors("login?org_code={0}&entity_code={1}&username={2}&password={3}", true)) as {
    session_id?: string;
  };
  if (!auth.session_id) throw new Error("Bell spot: no session");
  const cat = (await cors(
    `getCatalogProductsLite?session_id=${auth.session_id}&category_code=TRADEIN&view_manufacturer=true&view_references_type=WEB_TAG&cache=true`,
  )) as { products?: Array<{ product_code: string; product_title: string }> };
  const hit = pickBestTitleMatch(cat.products || [], {
    getTitle: (p) => p.product_title,
    model: d.model,
    variant: d.variant || "128GB",
  });
  if (!hit) throw new Error(`Bell spot: no match for ${d.model} ${d.variant}`);
  const est = (await cors(
    `getBuyBackProductsEstimate?session_id=${auth.session_id}&buyer_code=REDEEM&product_code=${hit.product_code}`,
  )) as { products?: Array<{ buyback_value_max?: number }> };
  const price = est.products?.[0]?.buyback_value_max;
  if (!price) throw new Error("Bell spot: no buyback_value_max");
  return price;
}

/** Independent TELUS spot-check for one device. */
async function spotTelus(d: ToScrape): Promise<number> {
  const BACKEND = "https://www.telus.com/mobility/trade-in/backend";
  const ctxRes = await fetch(`${BACKEND}/context`, {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      lineOfBusiness: "mobility",
      orderType: "activation",
      customerType: "undeclared",
      offerType: "CONSUMER",
    }),
  });
  if (!ctxRes.ok) throw new Error(`TELUS spot context HTTP ${ctxRes.status}`);
  let salesTransactionId = ((await ctxRes.json()) as { salesTransactionId?: string }).salesTransactionId;
  if (!salesTransactionId) {
    // Prefer Playwright fallback like the adapter
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
      await page.goto("https://www.telus.com/mobility/trade-in", {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      await page.waitForTimeout(5000);
      if (!captured) throw new Error("TELUS spot: no salesTransactionId");
      salesTransactionId = captured;
    } finally {
      await browser.close();
    }
  }
  // Match adapter URL shape exactly: ?device=…&salesTransactionId=…&lang=en
  const storage = d.variant!.replace(/gb/i, " GB").replace(/\s+/g, " ").trim();
  const q = `${d.model} ${storage}`.replace(/\s+/g, " ").trim();
  const search = await fetch(
    `${BACKEND}/devices?device=${encodeURIComponent(q)}&salesTransactionId=${encodeURIComponent(salesTransactionId)}&lang=en`,
    { headers: { "User-Agent": UA, Accept: "application/json" } },
  );
  if (!search.ok) throw new Error(`TELUS spot devices HTTP ${search.status}`);
  const body = (await search.json()) as Record<
    string,
    {
      marketValueAmt?: number;
      productDescription?: Array<{ messageTxt?: string; localeCd?: string }>;
      modelCd?: string;
      storageCd?: string;
    }
  >;
  const hit = pickBestTitleMatch(Object.values(body), {
    getTitle: (item) => {
      const title =
        item.productDescription?.find((p) => p.localeCd === "EN")?.messageTxt ||
        item.productDescription?.[0]?.messageTxt ||
        item.modelCd ||
        "";
      return `${title} ${item.modelCd || ""}`;
    },
    getStorage: (item) => item.storageCd || item.productDescription?.[0]?.messageTxt || "",
    model: d.model,
    variant: d.variant || "128GB",
    requireStorage: true,
  });
  if (!hit?.marketValueAmt) throw new Error(`TELUS spot: no match for ${d.model} ${d.variant} (q=${q})`);
  return hit.marketValueAmt;
}

migrate();

async function main() {
  const providers = ["univercell", "bell", "telus"];
  const adapters = buildAdapters(providers);
  const series: Series = new Map();
  const runErrors: string[] = [];
  const failures: string[] = [];

  console.log(`\n=== Live scraper reliability: ${RUNS} runs × ${CORE.length} devices × ${providers.join(",")} ===\n`);

  for (let run = 1; run <= RUNS; run++) {
    console.log(`--- Run ${run}/${RUNS} ---`);
    for (const adapter of adapters) {
      const t0 = Date.now();
      try {
        const result = await adapter.scrape(CORE, { timeoutMs: 120_000 });
        const ms = Date.now() - t0;
        console.log(
          `  ${adapter.name.padEnd(12)} rows=${String(result.rows.length).padStart(3)}  errors=${result.errors.length}  ${ms}ms`,
        );
        for (const e of result.errors) {
          runErrors.push(`run${run}/${adapter.name}: ${e}`);
          console.log(`    ! ${e}`);
        }
        for (const r of result.rows) {
          if (r.trade_in_price == null) continue;
          const k = keyOf(r);
          const arr = series.get(k) || [];
          arr.push(r.trade_in_price);
          series.set(k, arr);
        }
        // Expect at least one row per device for Bell/TELUS; 4 grades for UniverCell
        const byProduct = new Set(result.rows.map((r) => `${r.product_id}|${r.variant}`));
        for (const d of CORE) {
          const pk = `${d.productId}|${d.variant}`;
          if (!byProduct.has(pk)) {
            failures.push(`run${run}/${adapter.name}: missing ${pk}`);
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        failures.push(`run${run}/${adapter.name}: THREW ${msg}`);
        console.log(`  ${adapter.name.padEnd(12)} THREW: ${msg}`);
      }
    }
    // Brief pause between runs to avoid hammering carrier APIs
    if (run < RUNS) await new Promise((r) => setTimeout(r, 1500));
  }

  console.log("\n=== Consistency across runs ===\n");
  const summary = summarize(series);
  let drifted = 0;
  for (const row of summary) {
    const flag = row.drift > TOLERANCE ? " DRIFT" : "";
    if (flag) drifted += 1;
    if (row.n < RUNS && row.key.startsWith("univercell|") && row.key.endsWith("|excellent")) {
      // UniverCell should return all grades every run for every device
      failures.push(`incomplete series ${row.key}: only ${row.n}/${RUNS} observations`);
    }
    console.log(
      `  ${row.key.padEnd(48)} n=${row.n}  ${money(row.min)}→${money(row.max)}  drift=${row.drift}${flag}`,
    );
  }
  if (drifted) failures.push(`${drifted} price keys drifted > $${TOLERANCE} across runs`);

  // Coverage expectations
  const expectedUc = CORE.length * 4; // 4 grades
  const ucKeys = summary.filter((s) => s.key.startsWith("univercell|"));
  const bellKeys = summary.filter((s) => s.key.startsWith("bell|"));
  const telusKeys = summary.filter((s) => s.key.startsWith("telus|"));
  console.log(
    `\nCoverage: univercell=${ucKeys.length} keys (expect ~${expectedUc}), bell=${bellKeys.length}, telus=${telusKeys.length}`,
  );
  if (ucKeys.length < expectedUc) failures.push(`UniverCell coverage low: ${ucKeys.length}/${expectedUc}`);
  if (bellKeys.length < CORE.length) failures.push(`Bell coverage low: ${bellKeys.length}/${CORE.length}`);
  if (telusKeys.length < CORE.length) failures.push(`TELUS coverage low: ${telusKeys.length}/${CORE.length}`);

  console.log("\n=== Independent live spot-checks (iPhone 15 128GB) ===\n");
  const probe = CORE[0];
  try {
    const uc = await spotUnivercell(probe);
    console.log("  UniverCell live:", uc);
    for (const [cond, price] of Object.entries(uc)) {
      const k = keyOf({
        competitor_name: "univercell",
        product_id: probe.productId,
        variant: probe.variant!,
        condition: cond as ScrapedPrice["condition"],
      });
      const scraped = series.get(k)?.[0];
      if (scraped == null) failures.push(`spot UC: adapter missing ${k}`);
      else if (scraped !== price) failures.push(`spot UC mismatch ${k}: adapter=${scraped} live=${price}`);
      else console.log(`    ✓ ${cond} matches adapter ${money(scraped)}`);
    }
  } catch (e) {
    failures.push(`UC spot failed: ${e instanceof Error ? e.message : String(e)}`);
    console.log("  UniverCell spot FAILED", e);
  }

  try {
    const bell = await spotBell(probe);
    console.log("  Bell live max:", money(bell));
    const k = keyOf({
      competitor_name: "bell",
      product_id: probe.productId,
      variant: probe.variant!,
      condition: "excellent",
    });
    const scraped = series.get(k)?.[0];
    if (scraped == null) failures.push("spot Bell: adapter missing excellent");
    else if (scraped !== bell) failures.push(`spot Bell mismatch: adapter=${scraped} live=${bell}`);
    else console.log(`    ✓ excellent matches adapter ${money(scraped)}`);
  } catch (e) {
    failures.push(`Bell spot failed: ${e instanceof Error ? e.message : String(e)}`);
    console.log("  Bell spot FAILED", e);
  }

  try {
    const telus = await spotTelus(probe);
    console.log("  TELUS live marketValueAmt:", money(telus));
    const k = keyOf({
      competitor_name: "telus",
      product_id: probe.productId,
      variant: probe.variant!,
      condition: "excellent",
    });
    const scraped = series.get(k)?.[0];
    if (scraped == null) failures.push("spot TELUS: adapter missing excellent");
    else if (scraped !== telus) failures.push(`spot TELUS mismatch: adapter=${scraped} live=${telus}`);
    else console.log(`    ✓ excellent matches adapter ${money(scraped)}`);
  } catch (e) {
    failures.push(`TELUS spot failed: ${e instanceof Error ? e.message : String(e)}`);
    console.log("  TELUS spot FAILED", e);
  }

  // Sanity: carrier prices should be in a sensible band vs UniverCell excellent
  const ucEx = series.get(keyOf({ competitor_name: "univercell", product_id: "iphone-15", variant: "128GB", condition: "excellent" }))?.[0];
  const bellEx = series.get(keyOf({ competitor_name: "bell", product_id: "iphone-15", variant: "128GB", condition: "excellent" }))?.[0];
  const telusEx = series.get(keyOf({ competitor_name: "telus", product_id: "iphone-15", variant: "128GB", condition: "excellent" }))?.[0];
  if (ucEx && bellEx && (bellEx < ucEx * 0.3 || bellEx > ucEx * 1.5)) {
    failures.push(`Bell $${bellEx} looks out of band vs UniverCell $${ucEx}`);
  }
  if (ucEx && telusEx && (telusEx < ucEx * 0.3 || telusEx > ucEx * 1.5)) {
    failures.push(`TELUS $${telusEx} looks out of band vs UniverCell $${ucEx}`);
  }
  if (ucEx && bellEx && telusEx) {
    console.log(`\nMarket band iPhone 15 128GB excellent: UC ${money(ucEx)} · Bell ${money(bellEx)} · TELUS ${money(telusEx)}`);
  }

  console.log("\n=== Verdict ===\n");
  if (runErrors.length) {
    console.log(`Adapter warnings (${runErrors.length}):`);
    for (const e of runErrors.slice(0, 20)) console.log(`  - ${e}`);
    if (runErrors.length > 20) console.log(`  … +${runErrors.length - 20} more`);
  }
  if (failures.length) {
    console.log(`FAILURES (${failures.length}):`);
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS — ${RUNS} consecutive live runs stable; spot-checks match adapters.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
