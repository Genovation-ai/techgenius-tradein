/**
 * Live probe: Bell, TELUS, GoRecell step-flow, UniverCell sell/repair
 * Run: node scripts/live_scrape_probe.mjs
 */
import { chromium } from "playwright";
import * as cheerio from "cheerio";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const results = {
  scrapedAt: new Date().toISOString(),
  sources: {},
};

function parsePrice(text) {
  if (!text) return null;
  const m = String(text).replace(/\xa0/g, " ").match(/\$?\s*([\d,]+(?:\.\d{2})?)/);
  return m ? Number(m[1].replace(/,/g, "")) : null;
}

async function probeUniverCellTradeIn() {
  const url = "https://univercell.ai/sell/mobile/apple/iphone-15";
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  const html = await res.text();
  const $ = cheerio.load(html);
  const title = $("title").text();
  const hero = $("h1").text().replace(/\s+/g, " ").trim();
  const m = html.match(/"sydCapacityPrices":(\[[\s\S]*?\]),"image"/);
  const capacities = m ? JSON.parse(m[1]) : [];
  return { url, title, hero, capacities };
}

async function probeUniverCellRepair() {
  const url = "https://univercell.ai/repair/mobile/apple/iphone-15";
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  const html = await res.text();
  const opts = [];
  for (const m of html.matchAll(
    /"name":"([^"]+)","duration":"[^"]*","warranty":"[^"]*","price":"([^"]+)"/g,
  )) {
    opts.push({ name: m[1], price: m[2].replace(/^\$+/, "$") });
  }
  return { url, repairOptions: opts };
}

async function probeGoRecell(page) {
  const apiCalls = [];
  page.on("response", async (resp) => {
    const u = resp.url();
    if (
      u.includes("admin-ajax") ||
      u.includes("wc-ajax") ||
      u.includes("wp-json") ||
      u.includes("variation")
    ) {
      let body = "";
      try {
        body = (await resp.text()).slice(0, 2000);
      } catch {
        /* ignore */
      }
      apiCalls.push({ url: u, status: resp.status(), body: body.slice(0, 500) });
    }
  });

  await page.goto("https://gorecell.ca/step-flow/?category=smartphone", {
    waitUntil: "networkidle",
    timeout: 90_000,
  });

  // Click Apple brand if visible
  const apple = page.locator('text=Apple').first();
  if (await apple.isVisible({ timeout: 5000 }).catch(() => false)) {
    await apple.click();
    await page.waitForTimeout(1500);
  }

  // Search / click iPhone 15
  const iphone15 = page.locator('text=iPhone 15').first();
  if (await iphone15.isVisible({ timeout: 8000 }).catch(() => false)) {
    await iphone15.click();
    await page.waitForTimeout(2000);
  }

  // Select storage if shown
  for (const cap of ["128GB", "128 GB", "256GB"]) {
    const el = page.locator(`text=${cap}`).first();
    if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
      await el.click();
      await page.waitForTimeout(1000);
      break;
    }
  }

  // Select condition tiers
  const conditions = ["Like New", "Good", "Cracked or Minor Issue", "Defective"];
  const prices = {};
  for (const cond of conditions) {
    const btn = page.locator(`text=${cond}`).first();
    if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await btn.click();
      await page.waitForTimeout(1200);
      const priceText = await page
        .locator(".woocommerce-Price-amount, .final_price, [ng-bind-html*='final_price']")
        .first()
        .textContent()
        .catch(() => "");
      const bodyText = await page.locator("body").textContent();
      const re = new RegExp(`${cond.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^$]{0,80}\\$\\s*([\\d,]+)`, "i");
      const match = bodyText?.match(re);
      prices[cond] = parsePrice(priceText) || (match ? parsePrice(match[0]) : null);
    }
  }

  const finalPriceHtml = await page
    .locator("[ng-bind-html='final_price_view'], .final_price_view, .woocommerce-Price-amount")
    .first()
    .innerHTML()
    .catch(() => "");

  return { prices, finalPriceHtml: finalPriceHtml.slice(0, 300), apiCalls: apiCalls.slice(0, 15) };
}

async function probeBell(page) {
  const apiCalls = [];
  page.on("response", async (resp) => {
    const u = resp.url();
    if (u.includes("apigate.bell.ca") || u.includes("tradein") || u.includes("TradeIn")) {
      let body = "";
      try {
        body = (await resp.text()).slice(0, 1500);
      } catch {
        /* ignore */
      }
      apiCalls.push({ url: u, status: resp.status(), body: body.slice(0, 400) });
    }
  });

  await page.goto("https://www.bell.ca/Mobility/Trade-in-program", {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await page.waitForTimeout(3000);

  const inputs = await page.locator("input[type='text'], input.typeahead, .twitter-typeahead input").all();
  let typed = false;
  for (const input of inputs) {
    if (await input.isVisible().catch(() => false)) {
      await input.fill("iPhone 15");
      await page.waitForTimeout(2000);
      typed = true;
      break;
    }
  }

  const suggestion = page.locator(".tt-suggestion, .typeahead-dropdown li, [role='option']").first();
  if (await suggestion.isVisible({ timeout: 5000 }).catch(() => false)) {
    await suggestion.click();
    await page.waitForTimeout(3000);
  }

  const estimateText = await page
    .locator("#tradein_estimate, .tradein-estimate, .estimate-value, .trade-in-value")
    .first()
    .textContent()
    .catch(() => null);

  const bodySnippet = (await page.locator("body").textContent()) || "";
  const dollarMatches = [...bodySnippet.matchAll(/\$[\d,]+(?:\.\d{2})?/g)]
    .map((m) => m[0])
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 10);

  return { typed, estimateText, dollarMatches, apiCalls: apiCalls.slice(0, 20) };
}

async function probeTelus(page) {
  const apiCalls = [];
  page.on("response", async (resp) => {
    const u = resp.url();
    if (
      u.includes("telus.com") &&
      (u.includes("trade") || u.includes("api") || u.includes("estimate") || u.includes("graphql"))
    ) {
      let body = "";
      try {
        body = (await resp.text()).slice(0, 1000);
      } catch {
        /* ignore */
      }
      apiCalls.push({ url: u, status: resp.status(), body: body.slice(0, 300) });
    }
  });

  const url = "https://www.telus.com/en/mobility/trade-in-bring-it-back-returns";
  const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForTimeout(4000);

  const title = await page.title();
  const h1 = await page.locator("h1").first().textContent().catch(() => "");
  const blocked = resp?.status() === 403 || title.toLowerCase().includes("blocked");

  return { url, status: resp?.status(), title, h1: h1?.trim(), blocked, apiCalls: apiCalls.slice(0, 10) };
}

async function main() {
  console.log("=== UniverCell (fetch) ===");
  results.sources.univercell_tradein = await probeUniverCellTradeIn();
  results.sources.univercell_repair = await probeUniverCellRepair();
  console.log(JSON.stringify(results.sources.univercell_tradein, null, 2));
  console.log(JSON.stringify(results.sources.univercell_repair, null, 2));

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: UA, locale: "en-CA" });

  console.log("\n=== GoRecell (Playwright) ===");
  const gPage = await ctx.newPage();
  results.sources.gorecell = await probeGoRecell(gPage);
  console.log(JSON.stringify(results.sources.gorecell, null, 2));
  await gPage.close();

  console.log("\n=== Bell (Playwright) ===");
  const bPage = await ctx.newPage();
  results.sources.bell = await probeBell(bPage);
  console.log(JSON.stringify(results.sources.bell, null, 2));
  await bPage.close();

  console.log("\n=== TELUS (Playwright) ===");
  const tPage = await ctx.newPage();
  results.sources.telus = await probeTelus(tPage);
  console.log(JSON.stringify(results.sources.telus, null, 2));
  await tPage.close();

  await browser.close();

  const out = "/agent/trade-in-backend/data/live_scrape_probe.json";
  await import("node:fs/promises").then((fs) =>
    fs.writeFile(out, JSON.stringify(results, null, 2)),
  );
  console.log(`\nWrote ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
