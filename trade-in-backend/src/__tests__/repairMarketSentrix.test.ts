import { describe, expect, it } from "vitest";
import {
  assignExclusively,
  brandWords,
  findListings,
  gradeTier,
  isPlausiblePrice,
  modelTokens,
  norm,
  rankListings,
} from "../services/repairMarketSentrix.js";

/**
 * Every case here is a mis-match this matcher actually made while it was being
 * built. A wrong part price becomes a quote and a quote becomes a promise the
 * bench has to keep, so each one is pinned rather than remembered.
 */
describe("norm", () => {
  it("keeps '+' as a model word", () => {
    // Dropping it made Galaxy S21+ share a key with Galaxy S21 and inherit the
    // plain model's screen.
    expect(norm("Galaxy S21+")).toBe("galaxy-s21-plus");
    expect(norm("Galaxy S21")).toBe("galaxy-s21");
    expect(norm("Galaxy S21+")).not.toBe(norm("Galaxy S21"));
  });

  it("folds quotes and punctuation but not digits", () => {
    expect(norm('MacBook Air 13" (2022)')).toBe("macbook-air-13-2022");
  });
});

describe("brandWords", () => {
  it("strips the category suffix our brand ids carry", () => {
    expect(brandWords("motorola-smartphone")).toContain("motorola");
  });
  it("knows the store also writes Motorola as 'moto'", () => {
    expect(brandWords("motorola-smartphone")).toContain("moto");
  });
  it("is empty for no brand", () => {
    expect(brandWords(null)).toEqual([]);
  });
});

describe("modelTokens", () => {
  it("spells out the Apple Watch line the way the store files it", () => {
    const alts = modelTokens("Watch SE 3").map((t) => t.join("-"));
    expect(alts).toContain("watch-series-se-3");
  });
  it("drops the radio words that are ours and never theirs", () => {
    const alts = modelTokens("Apple iPad mini Wi-Fi + Cellular").map((t) => t.join("-"));
    expect(alts.some((a) => a.startsWith("ipad-mini"))).toBe(true);
  });
});

const SLUGS = [
  "oled-assembly-for-iphone-15-aftermarket-pro-xo7-soft",
  "oled-assembly-for-iphone-15-pro-aftermarket-pro-xo7-soft-120hz",
  "oled-assembly-with-frame-for-samsung-galaxy-s21-5g-refurbished-phantom-gray",
  "oled-assembly-with-frame-for-samsung-galaxy-s21-plus-5g-aftermarket-plus-phantom-black",
  "inner-oled-assembly-with-frame-for-samsung-galaxy-z-flip-4g-f700-service-pack-mirror-purple",
  "inner-oled-assembly-with-frame-for-samsung-galaxy-z-flip-6-f741-refurbished-black",
  "oled-assembly-for-watch-series-9-45mm-premium",
  "oled-assembly-for-watch-series-10-11-46mm-premium",
  "replacement-battery-for-samsung-watch-ultra-lte-47mm-eb-bl705aby",
  "oled-assembly-for-google-pixel-watch-series-1-41mm-premium",
  "replacement-battery-for-google-pixel-3a-5-6",
  "oled-assembly-with-frame-for-motorola-moto-edge-xt2205-1-2022-refurbished-gray",
  "screen-protector-for-iphone-15-clear",
  "lcd-panel-only-for-macbook-air-13-retina-a2337-panel-only-aftermarket-plus",
];

describe("findListings", () => {
  it("matches the exact model", () => {
    expect(findListings(SLUGS, "iPhone 15", "apple-smartphone", "screen")).toEqual([
      "oled-assembly-for-iphone-15-aftermarket-pro-xo7-soft",
    ]);
  });

  it("does not let a base model take its Pro sibling's part", () => {
    const got = findListings(SLUGS, "iPhone 15", "apple-smartphone", "screen");
    expect(got.some((s) => s.includes("iphone-15-pro"))).toBe(false);
  });

  it("does not let a bare model take the next generation's part", () => {
    // "Galaxy Z Flip" must not swallow "…z-flip-6…": skipping a bare number
    // was how it did.
    const got = findListings(SLUGS, "Galaxy Z Flip", "samsung-smartphone", "screen");
    expect(got.some((s) => s.includes("z-flip-6"))).toBe(false);
    expect(got).toContain("inner-oled-assembly-with-frame-for-samsung-galaxy-z-flip-4g-f700-service-pack-mirror-purple");
  });

  it("keeps a co-listing when our own model ends in a number", () => {
    // "watch-series-10-11-46mm" fits Series 10 and Series 11 alike.
    expect(findListings(SLUGS, "Watch Series 10", "apple-smartwatch", "screen")).toContain(
      "oled-assembly-for-watch-series-10-11-46mm-premium",
    );
  });

  it("treats a size as a size, not a model designator", () => {
    // "45mm" was being read the way "3a" is, which lost every Apple Watch.
    expect(findListings(SLUGS, "Watch Series 9", "apple-smartwatch", "screen")).toContain(
      "oled-assembly-for-watch-series-9-45mm-premium",
    );
  });

  it("does not cross brands", () => {
    // Apple's "Watch Ultra" must not take a Samsung watch battery.
    expect(findListings(SLUGS, "Watch Ultra", "apple-smartwatch", "battery")).toEqual([]);
  });

  it("does not let a family word swallow the whole family", () => {
    // "Google Pixel" -> "pixel" matched Pixel Watch and Pixel 3a parts.
    const got = findListings(SLUGS, "Google Pixel", "google-smartphone", "battery");
    expect(got).toEqual([]);
  });

  it("steps over a manufacturer code between our tokens", () => {
    expect(findListings(SLUGS, "Edge (2022)", "motorola-smartphone", "screen")).toContain(
      "oled-assembly-with-frame-for-motorola-moto-edge-xt2205-1-2022-refurbished-gray",
    );
  });

  it("rejects accessories and part-of-a-part listings", () => {
    const got = findListings(SLUGS, "iPhone 15", "apple-smartphone", "screen");
    expect(got.some((s) => s.includes("protector"))).toBe(false);
    const mac = findListings(SLUGS, 'MacBook Air 13" (2020)', "apple-laptop", "screen");
    expect(mac.some((s) => s.includes("panel-only"))).toBe(false);
  });

  it("returns nothing for a part type it does not know", () => {
    expect(findListings(SLUGS, "iPhone 15", "apple-smartphone", "water_damage")).toEqual([]);
  });
});

describe("assignExclusively", () => {
  it("gives a shared listing to the most specific model", () => {
    const out = assignExclusively([
      { deviceId: "s21", deviceKey: "galaxy-s21", problem: "screen", slug: "x" },
      { deviceId: "s21p", deviceKey: "galaxy-s21-plus", problem: "screen", slug: "x" },
    ]);
    expect(out.has("s21")).toBe(false);
    expect(out.get("s21p")?.get("screen")).toEqual(["x"]);
  });

  it("keeps a listing that only one model claims", () => {
    const out = assignExclusively([{ deviceId: "a", deviceKey: "iphone-15", problem: "screen", slug: "y" }]);
    expect(out.get("a")?.get("screen")).toEqual(["y"]);
  });

  it("keeps both when neither is more specific", () => {
    const out = assignExclusively([
      { deviceId: "a", deviceKey: "iphone-15", problem: "screen", slug: "z" },
      { deviceId: "b", deviceKey: "iphone-16", problem: "screen", slug: "z" },
    ]);
    expect(out.get("a")?.get("screen")).toEqual(["z"]);
    expect(out.get("b")?.get("screen")).toEqual(["z"]);
  });
});

describe("grade ranking", () => {
  it("prefers the grades a shop actually fits", () => {
    expect(gradeTier("x-aftermarket-pro")).toBeLessThan(gradeTier("x-service-pack"));
    expect(gradeTier("x-premium")).toBeLessThan(gradeTier("x-used-oem-pull"));
  });
  it("puts an unknown grade last", () => {
    expect(gradeTier("x-something-else")).toBe(9);
  });
  it("ranks and de-duplicates", () => {
    expect(rankListings(["a-service-pack", "b-premium", "b-premium"])).toEqual(["b-premium", "a-service-pack"]);
  });
});

describe("trimmings are not parts", () => {
  // Each of these was picked as a part price by an earlier version: a $0.01
  // battery, a camera made of shielding tape, a charging port that is a lid.
  const TRIM_SLUGS = [
    "battery-bottom-foam-for-oneplus-8t-genuine-oem",
    "battery-buffer-foam-for-motorola-edge-2024-xt2405-genuine-oem",
    "back-camera-wide-copper-foil-shielding-tape-for-motorola-moto-edge-plus-xt2301",
    "charging-port-board-protective-cover-for-motorola-moto-edge-xt2305-2023-genuine-oem",
    "battery-bottom-cushioning-cotton-for-motorola-moto-edge-plus-xt2301-2023",
  ];

  it("rejects a battery spacer offered as a battery", () => {
    expect(findListings(TRIM_SLUGS, "OnePlus 8T", "oneplus-smartphone", "battery")).toEqual([]);
  });

  it("rejects shielding tape offered as a camera", () => {
    expect(findListings(TRIM_SLUGS, "Edge+ (2023)", "motorola-smartphone", "rear_camera")).toEqual([]);
  });

  it("rejects a protective cover offered as a charging port", () => {
    expect(findListings(TRIM_SLUGS, "Edge (2023)", "motorola-smartphone", "charging_port")).toEqual([]);
  });
});

describe("isPlausiblePrice", () => {
  it("refuses a screen that costs less than any screen has", () => {
    expect(isPlausiblePrice("screen", 0.01)).toBe(false);
    expect(isPlausiblePrice("screen", 14.55)).toBe(true);
  });

  it("refuses a one-cent battery", () => {
    expect(isPlausiblePrice("battery", 0.01)).toBe(false);
    expect(isPlausiblePrice("battery", 13.41)).toBe(true);
  });

  it("allows a genuinely cheap charging-port flex", () => {
    expect(isPlausiblePrice("charging_port", 0.59)).toBe(true);
  });

  it("refuses a part type it does not know", () => {
    expect(isPlausiblePrice("water_damage", 50)).toBe(false);
  });

  it("refuses a price that is not a number", () => {
    expect(isPlausiblePrice("screen", Number.NaN)).toBe(false);
  });
});
