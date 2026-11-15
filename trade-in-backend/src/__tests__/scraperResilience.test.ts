import { describe, expect, it } from "vitest";
import {
  parseQueryData,
  computeQueryFlowPrice,
} from "../pricing-engine/adapters/gorecellStepFlowAdapter.js";
import { parseSellPage } from "../pricing-engine/adapters/univercellAdapter.js";

/**
 * Site-build resilience.
 *
 * The scrapers break the moment a competitor's front-end rebuilds, because the
 * only thing between a live price and a stale one is a regex that matches
 * exactly one spelling of the current page. These tests pin the spellings
 * we've already had to chase at least once, so the next theme push to GoRecell
 * or app-router upgrade on UniverCell doesn't silently zero the scrape — the
 * scrape gets a visible test failure first.
 */

describe("GoRecell parseQueryData accepts the shapes wc-query-flow has shipped", () => {
  const sample = {
    q1: {
      title: "Storage",
      rules: {
        r1: { title: "128GB", price: "460", price_formate: "fixed" },
      },
    },
    q2: {
      title: "Condition",
      rules: {
        r1: { title: "Like New", price: "0", price_formate: "percent" },
        r2: { title: "Defective", price: "-90", price_formate: "percent" },
      },
    },
  };

  it("parses the historical JSON.parse single-quoted form", () => {
    const encoded = JSON.stringify(sample).replace(/"/g, '\\"');
    const html = `<script>var query_data = JSON.parse('${encoded}');</script>`;
    const got = parseQueryData(html);
    expect(got).not.toBeNull();
    expect(Object.keys(got!)).toHaveLength(2);
  });

  it("parses the JSON.parse double-quoted form", () => {
    const encoded = JSON.stringify(sample).replace(/"/g, '\\"');
    const html = `<script>let query_data = JSON.parse("${encoded}");</script>`;
    const got = parseQueryData(html);
    expect(got).not.toBeNull();
  });

  it("parses an inline object literal, once the theme stops routing through JSON.parse", () => {
    const html = `<script>const query_data = ${JSON.stringify(sample)};</script>`;
    const got = parseQueryData(html);
    expect(got).not.toBeNull();
    expect(got!.q1.rules.r1.title).toBe("128GB");
  });

  it("returns null when the key is gone (the right signal to the adapter)", () => {
    expect(parseQueryData("<html><body>no config here</body></html>")).toBeNull();
  });
});

describe("computeQueryFlowPrice does not invert when the page ships a bad base price", () => {
  const storage = { title: "128GB", price: "460", price_formate: "fixed" };
  const cracked = { title: "Cracked", price: "-40", price_formate: "percent" };

  it("storage fixed + condition percent on a zero base matches wc-query-flow", () => {
    // base rolls into the storage fixed, then -40% comes off: 460 * 0.6 = 276
    expect(computeQueryFlowPrice(storage, cracked, 0)).toBe(276);
  });

  it("a negative page-base is treated as zero, not as a sign flip", () => {
    // Without the clamp, a negative base would send -40% UP instead of DOWN.
    // With the clamp, the percent falls back to the accumulated storage price.
    expect(computeQueryFlowPrice(storage, cracked, -999)).toBe(276);
  });

  it("non-finite page-base is treated as zero", () => {
    expect(computeQueryFlowPrice(storage, cracked, Number.NaN)).toBe(276);
  });

  it("non-finite condition percent is skipped rather than NaN-poisoning the price", () => {
    const bad = { title: "Cracked", price: "not-a-number", price_formate: "percent" };
    expect(computeQueryFlowPrice(storage, bad, 0)).toBe(460);
  });
});

describe("UniverCell parseSellPage keeps up with the Next.js app-router rename", () => {
  const rows = [
    { capacity: "128GB", flawlessPrice: "$460", goodPrice: "$420" },
    { capacity: "256GB", flawlessPrice: "$520", goodPrice: "$480" },
  ];

  it("finds the historical sydCapacityPrices key", () => {
    const html = `<script>self.__next_f.push([1,"sydCapacityPrices\\":${JSON.stringify(rows).replace(/"/g, '\\"')}"]);</script>`;
    const parsed = parseSellPage(html);
    expect(parsed.length).toBe(2);
  });

  it("finds the renamed capacityPrices key", () => {
    const html = `<script>self.__next_f.push([1,"capacityPrices\\":${JSON.stringify(rows).replace(/"/g, '\\"')}"]);</script>`;
    const parsed = parseSellPage(html);
    expect(parsed.length).toBe(2);
  });

  it("skips an earlier empty array of the same key when a populated one follows", () => {
    const empty = "[]";
    const encoded = JSON.stringify(rows).replace(/"/g, '\\"');
    const html = `<span>sydCapacityPrices:${empty}</span><script>self.__next_f.push([1,"sydCapacityPrices\\":${encoded}"]);</script>`;
    const parsed = parseSellPage(html);
    expect(parsed.length).toBe(2);
  });

  it("returns an empty array when the key is gone rather than guessing", () => {
    expect(parseSellPage("<html><body>no sell data</body></html>")).toEqual([]);
  });
});
