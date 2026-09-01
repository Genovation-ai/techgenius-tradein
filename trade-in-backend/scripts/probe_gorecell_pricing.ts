/**
 * Deep probe of GoRecell pricing sources.
 * Run: npx tsx scripts/probe_gorecell_pricing.ts
 */
import { chromium } from "playwright";
import fs from "node:fs";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

type NetHit = { url: string; status: number; ct: string; body: string };

async function main() {
  const out: {
    network: NetHit[];
    findings: Record<string, unknown>;
  } = { network: [], findings: {} };

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ userAgent: UA, locale: "en-CA" });

  page.on("response", async (r) => {
    const url = r.url();
    const ct = r.headers()["content-type"] || "";
    if (
      /wc-ajax|admin-ajax|wp-json|variation|price|product|api|graphql/i.test(url) ||
      (ct.includes("json") && /gorecell/i.test(url))
    ) {
      let body = "";
      try {
        body = (await r.text()).slice(0, 2000);
      } catch {
        /* ignore */
      }
      out.network.push({ url, status: r.status(), ct, body });
    }
  });

  // 1) Direct WooCommerce product page
  const productUrl = "https://gorecell.ca/product/apple-iphone-15/";
  console.log("GOTO", productUrl);
  await page.goto(productUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForTimeout(2500);

  const productProbe = await page.evaluate(() => {
    const html = document.documentElement.innerHTML;
    const form = document.querySelector("form.variations_form");
    const variationsData = form?.getAttribute("data-product_variations") || "";
    let parsed: unknown = null;
    try {
      parsed = variationsData ? JSON.parse(variationsData) : null;
    } catch {
      parsed = null;
    }
    const priceEls = [...document.querySelectorAll(".price, .woocommerce-Price-amount, .amount")]
      .slice(0, 20)
      .map((el) => ({ cls: String(el.className), text: (el.textContent || "").trim().slice(0, 120) }));
    return {
      title: document.title,
      formExists: !!form,
      variationsLen: Array.isArray(parsed) ? parsed.length : variationsData.length,
      variation0: Array.isArray(parsed) && parsed[0] ? parsed[0] : variationsData.slice(0, 600),
      priceEls,
      dollarSamples: (html.match(/\$\s?[\d,]+(?:\.\d{2})?/g) || []).slice(0, 40),
      bodyTextSample: (document.body?.innerText || "").slice(0, 1500),
    };
  });
  out.findings.productPage = productProbe;
  console.log("product variations:", productProbe.variationsLen);
  console.log("product dollars:", productProbe.dollarSamples?.slice(0, 15));
  console.log("product prices:", productProbe.priceEls);

  const selects = page.locator("form.variations_form select");
  const selectCount = await selects.count();
  console.log("variation selects", selectCount);
  for (let i = 0; i < selectCount; i++) {
    const sel = selects.nth(i);
    const name = await sel.getAttribute("name");
    const options = await sel.locator("option").allTextContents();
    console.log(" select", name, options);
    // pick first non-empty option
    const vals = await sel.locator("option").evaluateAll((opts) =>
      opts.map((o) => (o as HTMLOptionElement).value).filter(Boolean),
    );
    if (vals[0]) {
      await sel.selectOption(vals[0]).catch(() => {});
      await page.waitForTimeout(600);
    }
  }
  if (selectCount) {
    await page.waitForTimeout(1000);
    const afterSelect = await page.evaluate(() => {
      const single = document.querySelector(".single_variation, .woocommerce-variation-price, .price");
      return {
        text: (single?.textContent || "").trim().slice(0, 300),
        dollars: (document.body.innerText.match(/\$\s?[\d,]+(?:\.\d{2})?/g) || []).slice(0, 20),
      };
    });
    out.findings.afterVariationSelect = afterSelect;
    console.log("after variation select", afterSelect);
  }

  // 2) Step-flow with known product id
  const stepUrl = "https://gorecell.ca/step-flow/?product_id=9982";
  console.log("\nGOTO", stepUrl);
  await page.goto(stepUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForTimeout(3500);

  const stepProbe = await page.evaluate(() => {
    const el = document.querySelector("[ng-controller]");
    let scopeDump: Record<string, unknown> | null = null;
    try {
      const angular = (window as unknown as { angular?: { element: (e: Element) => { scope: () => Record<string, unknown> } } })
        .angular;
      if (angular && el) {
        const scope = angular.element(el).scope() as Record<string, unknown> & {
          selected_product?: Record<string, unknown> & { _variations?: unknown[] };
        };
        const sp = scope?.selected_product;
        scopeDump = {
          hasScope: !!scope,
          selected_product_id: sp?._id || sp?.id,
          selected_name: sp?.name || sp?.post_title,
          variations: sp?._variations?.length ?? null,
          variationSample: sp?._variations?.[0] ? JSON.stringify(sp._variations[0]).slice(0, 800) : null,
          keys: sp ? Object.keys(sp).slice(0, 60) : [],
          final_price_view: scope?.final_price_view,
          selected_condition: scope?.selected_condition,
          allScopeKeys: scope ? Object.keys(scope).slice(0, 80) : [],
        };
      }
    } catch (e) {
      scopeDump = { error: String(e) };
    }

    let productsSample: Record<string, unknown> | null = null;
    try {
      const products = (window as unknown as { products?: Array<Record<string, unknown>> }).products;
      if (Array.isArray(products)) {
        const p = products.find((x) => String(x._id) === "9982") || products[0];
        const priceish = p
          ? Object.fromEntries(
              Object.entries(p).filter(
                ([k, v]) => /price|amount|value|buy|offer|quote/i.test(k) || typeof v === "number",
              ),
            )
          : null;
        productsSample = {
          count: products.length,
          sampleId: p?._id,
          sampleName: p?.name || p?.post_title,
          sampleKeys: p ? Object.keys(p).slice(0, 80) : [],
          variations: Array.isArray(p?._variations) ? (p!._variations as unknown[]).length : null,
          variation0: Array.isArray(p?._variations) && (p!._variations as unknown[])[0]
            ? JSON.stringify((p!._variations as unknown[])[0]).slice(0, 800)
            : null,
          priceish,
        };
      }
    } catch {
      /* ignore */
    }

    // Scan inline scripts for price maps
    const scriptSnips = [...document.querySelectorAll("script")]
      .map((s) => s.textContent || "")
      .filter((t) => /_variations|final_price|buyback|trade.?in|price_table/i.test(t))
      .map((t) => t.slice(0, 400));

    return {
      title: document.title,
      scopeDump,
      productsSample,
      scriptSnips: scriptSnips.slice(0, 8),
      priceViewHtml:
        document.querySelector('[ng-bind-html="final_price_view"]')?.innerHTML?.slice(0, 400) || null,
      dollarSamples: (document.documentElement.innerHTML.match(/\$\s?[\d,]+(?:\.\d{2})?/g) || []).slice(0, 40),
      visibleText: (document.body?.innerText || "").slice(0, 2000),
    };
  });
  out.findings.stepFlow = stepProbe;
  console.log("step scope:", JSON.stringify(stepProbe.scopeDump, null, 2));
  console.log("products sample:", JSON.stringify(stepProbe.productsSample, null, 2));
  console.log("step dollars:", stepProbe.dollarSamples);

  for (const label of ["Like New", "Good", "Cracked or Minor Issue", "Defective"]) {
    const loc = page.locator(`text=${label}`).first();
    if ((await loc.count()) > 0) {
      await loc.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(900);
      const price = await page.evaluate(() => {
        const el = document.querySelector('[ng-bind-html="final_price_view"]');
        return {
          html: el?.innerHTML || "",
          text: el?.textContent || "",
          bodyDollars: (document.body.innerText.match(/\$\s?[\d,]+(?:\.\d{2})?/g) || []).slice(0, 10),
        };
      });
      console.log("after click", label, "=>", price);
      out.findings[`after_${label}`] = price;
    } else {
      console.log("no button for", label);
    }
  }

  // 3) REST / AJAX probes
  const ajaxUrls = [
    "https://gorecell.ca/wp-json/wc/store/v1/products?search=iphone%2015&per_page=5",
    "https://gorecell.ca/wp-json/wp/v2/product?search=iphone%2015&per_page=5",
    "https://gorecell.ca/wp-json/wc/v3/products?search=iphone%2015&per_page=3",
    "https://gorecell.ca/product/apple-iphone-15/?wc-ajax=get_variation",
  ];
  for (const u of ajaxUrls) {
    try {
      const res = await page.request.get(u, { headers: { "User-Agent": UA, Accept: "application/json" } });
      const text = await res.text();
      out.findings[`ajax_${u}`] = { status: res.status(), body: text.slice(0, 1200) };
      console.log("AJAX", res.status(), u.slice(0, 80), text.slice(0, 140).replace(/\n/g, " "));
    } catch (e) {
      console.log("AJAX fail", u, e instanceof Error ? e.message : e);
    }
  }

  // 4) Try posting get_variation like WooCommerce does
  try {
    const productId = await page.evaluate(() => {
      const form = document.querySelector("form.variations_form");
      return form?.getAttribute("data-product_id") || "";
    });
    // go back to product page for form data
    await page.goto(productUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(1500);
    const formMeta = await page.evaluate(() => {
      const form = document.querySelector("form.variations_form");
      return {
        productId: form?.getAttribute("data-product_id"),
        variationsRaw: form?.getAttribute("data-product_variations")?.slice(0, 2000) || "",
        action: (form as HTMLFormElement | null)?.action,
      };
    });
    out.findings.formMeta = formMeta;
    console.log("formMeta productId", formMeta.productId, "variationsRawLen", formMeta.variationsRaw.length);

    if (formMeta.productId) {
      // Parse attributes from page
      const attrs = await page.evaluate(() => {
        const result: Record<string, string> = {};
        document.querySelectorAll("form.variations_form select").forEach((sel) => {
          const s = sel as HTMLSelectElement;
          const val = [...s.options].map((o) => o.value).find((v) => v);
          if (s.name && val) result[s.name] = val;
        });
        return result;
      });
      console.log("attrs", attrs);
      const params = new URLSearchParams();
      params.set("product_id", formMeta.productId);
      for (const [k, v] of Object.entries(attrs)) params.set(k, v);
      const res = await page.request.post("https://gorecell.ca/?wc-ajax=get_variation", {
        headers: {
          "User-Agent": UA,
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Accept: "*/*",
        },
        data: params.toString(),
      });
      const text = await res.text();
      out.findings.get_variation = { status: res.status(), body: text.slice(0, 2000), attrs };
      console.log("get_variation", res.status(), text.slice(0, 400));
    }
    void productId;
  } catch (e) {
    console.log("get_variation probe fail", e);
  }

  console.log("\nNETWORK interesting:", out.network.length);
  for (const n of out.network.slice(0, 40)) {
    console.log(n.status, n.url.slice(0, 140));
    if (/price|variation|product/i.test(n.body)) console.log("  ", n.body.slice(0, 180).replace(/\n/g, " "));
  }

  fs.writeFileSync("/tmp/gorecell_probe.json", JSON.stringify(out, null, 2));
  console.log("wrote /tmp/gorecell_probe.json");
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
