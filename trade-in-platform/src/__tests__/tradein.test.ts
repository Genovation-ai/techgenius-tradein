import { describe, expect, it } from "vitest";
import {
  calcOffer,
  applyStoreCreditBoost,
  filterDevices,
  inferGradeFromAnswers,
  PROMO_CODES,
  isGradeLockedToDefective,
  gradeLabels,
  gradeDefinitions,
  type ValuationAnswers,
} from "../data/catalog";
import { checkoutComplete, emptyContact, emptyValuation, displayStorage, joinDetails, specKind, specLabel, specQuestionLabel } from "../lib/tradeInTypes";
import { createOfferId } from "../lib/offers";
import { aggregateFrameScores, analyzeFrame } from "../lib/localVision/analyze";
import { detectIssuesForAngle } from "../lib/localVision/issues";
import { runGeniusAiScan } from "../lib/aiScan";
import { buildPricingContext, getSourcePointsForQuote, quoteDeviceOffer } from "../lib/pricingBackend";
import { mapOfferToTwenty } from "../lib/twenty";
import { deviceImage } from "../data/deviceImages";
import { deviceImageBundles } from "../data/deviceImageBundles";
import { deviceImgSrc, payoutLabel, stageLabel, stageTone } from "../admin/api";
import type { DeviceModel } from "../data/catalog";

function fullValuation(over: Partial<ValuationAnswers> = {}): ValuationAnswers {
  return {
    ...emptyValuation,
    powerOn: true,
    fullyFunctional: true,
    exterior: "none",
    liquidDamage: false,
    batteryHealth: 90,
    activationLockFree: true,
    cleanImei: true,
    canadianModel: true,
    underContract: false,
    chargerIncluded: true,
    ...over,
  };
}

describe("pricing", () => {
  it("pays more for unlocked + higher storage + promo", () => {
    const base = calcOffer({
      basePrice: 1000,
      storage: "128GB",
      grade: "flawless",
      carrier: "Rogers",
      batteryHealth: 95,
    });
    const boosted = calcOffer({
      basePrice: 1000,
      storage: "512GB",
      grade: "flawless",
      carrier: "Unlocked",
      batteryHealth: 95,
      promoCode: "GENIUS5",
    });
    expect(boosted).toBeGreaterThan(base);
    expect(PROMO_CODES.GENIUS5).toBe(0.05);
  });

  it("cuts defective / low battery", () => {
    const good = calcOffer({
      basePrice: 500,
      storage: "128GB",
      grade: "good",
      carrier: "Unlocked",
      batteryHealth: 90,
    });
    const bad = calcOffer({
      basePrice: 500,
      storage: "128GB",
      grade: "defective",
      carrier: "Bell",
      batteryHealth: 70,
    });
    expect(bad).toBeLessThan(good);
  });
});

describe("market pricing backend", () => {
  it("uses weighted source context and returns an offer", () => {
    const points = getSourcePointsForQuote({
      modelId: "iphone-15",
      grade: "good",
      basePrice: 600,
    });
    const context = buildPricingContext(points);
    const offer = quoteDeviceOffer({
      basePrice: 600,
      storage: "256GB",
      grade: "good",
      carrier: "Unlocked",
      batteryHealth: 88,
      pricingContext: context,
    });
    expect(context.marketAverage).toBeTruthy();
    expect(offer).toBeGreaterThan(300);
  });
});

describe("grade inference from the condition answers", () => {
  // The checklist step these once guarded is gone; the answers are now
  // derived from the condition card. Grade inference still runs, so the
  // cases that exercise it stay and the completeness cases go.
  it("infers defective when device will not power on", () => {
    expect(inferGradeFromAnswers(fullValuation({ powerOn: false }))).toBe("defective");
  });
  it("forces As-Is for water damage even when it powers on", () => {
    expect(
      inferGradeFromAnswers(
        fullValuation({ powerOn: true, fullyFunctional: true, liquidDamage: true, exterior: "none" }),
      ),
    ).toBe("defective");
  });
});

describe("store credit boost", () => {
  it("adds 5% for store-credit payout only", () => {
    expect(applyStoreCreditBoost(1000, "store-credit")).toBe(1050);
    expect(applyStoreCreditBoost(1000, "etransfer")).toBe(1000);
    expect(applyStoreCreditBoost(1000, "cash")).toBe(1000);
  });
});

describe("checklist-only scan", () => {
  it("runs without media when skipped", async () => {
    const res = await runGeniusAiScan({
      valuation: fullValuation(),
      media: [],
    });
    expect(res.usedMedia).toBe(false);
    expect(res.suggestedGrade).toBeTruthy();
    expect(res.issues || []).toEqual([]);
  });
});

describe("structured issue grading", () => {
  it("maps front high crack to fair/defective band", async () => {
    const { gradeFromIssues } = await import("../lib/localVision/issues");
    const grade = gradeFromIssues(
      [
        {
          id: "1",
          type: "crack",
          severity: "high",
          angle: "front",
          confidence: 90,
          label: "Crack",
        },
      ],
      38,
      70,
    );
    expect(["fair", "defective"]).toContain(grade);
  });

  it("maps light scratches to good", async () => {
    const { gradeFromIssues } = await import("../lib/localVision/issues");
    const grade = gradeFromIssues(
      [
        {
          id: "1",
          type: "scratch",
          severity: "medium",
          angle: "back",
          confidence: 70,
          label: "Scratch",
        },
      ],
      88,
      80,
    );
    expect(grade).toBe("good");
  });
});

describe("checkout gates", () => {
  it("requires shipping fields for mail-in", () => {
    expect(
      checkoutComplete({
        ...emptyContact,
        firstName: "Alex",
        lastName: "Nguyen",
        email: "a@b.com",
        phone: "2892306067",
        method: "mail-in",
        shipAddress: "1 Main",
        shipCity: "Burlington",
        shipPostal: "L7L1A1",
      }),
    ).toBe(true);
    expect(
      checkoutComplete({
        ...emptyContact,
        firstName: "Alex",
        lastName: "Nguyen",
        email: "a@b.com",
        phone: "2892306067",
        method: "mail-in",
      }),
    ).toBe(false);
  });
});

describe("catalog search", () => {
  it("filters by category brand and query", () => {
    const list = filterDevices({ category: "smartphone", brand: "Apple", query: "15 pro" });
    expect(list.some((d) => d.name.includes("15 Pro"))).toBe(true);
    expect(list.every((d) => d.brand === "Apple")).toBe(true);
  });
});

describe("offers", () => {
  it("creates TG offer ids", () => {
    expect(createOfferId().startsWith("TG-")).toBe(true);
  });

  it("maps saved offer into Twenty CRM payload", () => {
    const payload = mapOfferToTwenty({
      id: "TG-TEST-1",
      createdAt: new Date().toISOString(),
      status: "reserved",
      total: 550,
      devices: [
        {
          id: "1",
          category: "smartphone",
          brand: "Apple",
          deviceName: "iPhone 15",
          storage: "128GB",
          carrier: "Unlocked",
          grade: "good",
          offer: 550,
          batteryHealth: 90,
        },
      ],
      contact: {
        firstName: "Sai",
        lastName: "Y",
        email: "sai@example.com",
        phone: "555",
        payout: "etransfer",
        method: "mail-in",
        storeId: "burlington",
      },
      pricing: {
        sourceCount: 3,
        sourceVersion: "tg-local-v1",
      },
    });
    expect(payload.opportunity.pricingLabel).toBe("Tech Genius Pricing");
    expect(payload.opportunity.stage).toBe("instant-quote");
  });
});

describe("local vision", () => {
  it("scores a clean synthetic frame higher than a noisy one", () => {
    const clean = new ImageData(64, 64);
    for (let i = 0; i < clean.data.length; i += 4) {
      clean.data[i] = 180;
      clean.data[i + 1] = 180;
      clean.data[i + 2] = 180;
      clean.data[i + 3] = 255;
    }
    const noisy = new ImageData(64, 64);
    for (let i = 0; i < noisy.data.length; i += 4) {
      const v = (i * 37) % 255;
      noisy.data[i] = v;
      noisy.data[i + 1] = 255 - v;
      noisy.data[i + 2] = (v * 3) % 255;
      noisy.data[i + 3] = 255;
      if ((i / 4) % 64 < 2) {
        noisy.data[i] = 0;
        noisy.data[i + 1] = 0;
        noisy.data[i + 2] = 0;
      }
    }
    const a = analyzeFrame(clean).analysis;
    const b = analyzeFrame(noisy).analysis;
    const aggClean = aggregateFrameScores([a]);
    const aggNoisy = aggregateFrameScores([b]);
    expect(aggClean.screenScore).toBeGreaterThan(aggNoisy.screenScore);
  });

  /**
   * Measured over 120 photographs of undamaged devices: edge density ran from
   * 0.007 to 0.146 and discoloration sat at a median of 1.0. Against the old
   * thresholds that flagged 113 of the 120 as cracked and knocked a mint phone
   * from flawless to fair, so both ends of the clean range are pinned here.
   */
  const frame = (over: Partial<Parameters<typeof aggregateFrameScores>[0][number]>) => ({
    width: 400,
    height: 800,
    crackDensity: 0.05,
    scratchIndex: 0.04,
    discoloration: 1,
    sharpness: 0.5,
    brightness: 0.6,
    screenLikelihood: 0.7,
    scenario: "lit_screen" as const,
    brightStd: 60,
    edgeAsymmetry: 0.1,
    ...over,
  });

  it("does not charge an undamaged device for its own edges", () => {
    // Top of the measured clean range, and saturated discoloration with it.
    const clean = aggregateFrameScores([frame({ crackDensity: 0.146 })]);
    expect(clean.screenScore).toBeGreaterThan(85);
    expect(detectIssuesForAngle("front", [frame({ crackDensity: 0.146 })])).toEqual([]);
  });

  it("still grades shattered glass down", () => {
    const shattered = frame({ crackDensity: 0.26, scratchIndex: 0.25, scenario: "cracked_lit" });
    expect(aggregateFrameScores([shattered]).screenScore).toBeLessThan(50);
    expect(detectIssuesForAngle("front", [shattered]).some((i) => i.type === "crack")).toBe(true);
  });

  it("does not treat a powered-off black screen as cracked", () => {
    const off = new ImageData(96, 96);
    for (let i = 0; i < off.data.length; i += 4) {
      // near-black with tiny camera noise
      const n = (i * 13) % 7;
      off.data[i] = n;
      off.data[i + 1] = n;
      off.data[i + 2] = n;
      off.data[i + 3] = 255;
    }
    const analysis = analyzeFrame(off).analysis;
    const agg = aggregateFrameScores([analysis]);
    expect(["powered_off", "black_screen", "too_dark"]).toContain(analysis.scenario);
    expect(agg.poweredOffLikely).toBe(true);
    expect(agg.screenScore).toBeGreaterThan(70);
    expect(agg.notes.some((n) => /powered off|black/i.test(n))).toBe(true);
  });
});

describe("device images never stand in for another model", () => {
  it("serves photos from the API rather than inlining them", () => {
    // The 9.5 MB of inlined base64 is aliased out of deviceImages.ts (see
    // vite.config.ts), so deviceImage() no longer has a photo to hand back for
    // any id — photos come from the device's own image_url, pointing at the
    // backend's /devices route. deviceImageBundles is still importable by its
    // full path, which is why the generated file is asserted separately.
    const known = Object.keys(deviceImageBundles)[0];
    expect(known).toBeTruthy();
    expect(deviceImage(known)).toBe("");
  });

  it("returns empty rather than a stock handset for an unknown device", () => {
    // Regression: this used to fall through to categoryImages -> iphone-15, so
    // a Pixel with no bundled photo rendered as an iPhone in the picker.
    expect(deviceImage("totally-unknown-device-9000")).toBe("");
  });

  it("does not substitute a category photo when the category is known", () => {
    expect(deviceImage("totally-unknown-device-9000", { category: "smartphone" } as DeviceModel)).toBe("");
  });

  it("deviceImgSrc returns empty when there is nothing to show", () => {
    expect(deviceImgSrc(null, null)).toBe("");
  });

  it("deviceImgSrc prefers the stored image, then the device's own slug", () => {
    expect(deviceImgSrc("/devices/pixel-9.png", "pixel-9")).toContain("/devices/pixel-9.png");
    expect(deviceImgSrc(null, "pixel-9")).toContain("/devices/pixel-9.png");
  });
});

describe("placeholder storage never reaches the customer", () => {
  it("hides the 'default' pricing tier", () => {
    // ~a quarter of the catalog is priced on a single tier literally named
    // "default"; it is a real key in the price table but not a capacity.
    expect(displayStorage("default")).toBe("");
    expect(displayStorage("Default")).toBe("");
    expect(displayStorage(" default ")).toBe("");
  });

  it("passes real capacities through untouched", () => {
    expect(displayStorage("128GB")).toBe("128GB");
    expect(displayStorage("1TB")).toBe("1TB");
    expect(displayStorage("44mm")).toBe("44mm");
  });

  it("treats missing storage as nothing to show", () => {
    expect(displayStorage(null)).toBe("");
    expect(displayStorage(undefined)).toBe("");
  });

  it("joinDetails drops the gap instead of leaving a dangling separator", () => {
    expect(joinDetails("iPhone 12", "128GB", "Great")).toBe("iPhone 12 \u00b7 128GB \u00b7 Great");
    expect(joinDetails("LG Velvet 5G", displayStorage("default"), "Great")).toBe("LG Velvet 5G \u00b7 Great");
    expect(joinDetails("Watch", "")).toBe("Watch");
  });
});

describe("RAM is not presented as storage", () => {
  it("reads small laptop capacities as memory, large ones as a drive", () => {
    // MacBook Pro 14" M5 arrives as ["4TB","2TB","1TB","32GB","24GB","16GB"] —
    // the last three are memory configs, not drives.
    expect(specKind("32GB", "laptop")).toBe("memory");
    expect(specKind("16GB", "computer")).toBe("memory");
    expect(specKind("1TB", "laptop")).toBe("storage");
    expect(specKind("512GB", "laptop")).toBe("storage");
  });

  it("never calls a phone capacity memory", () => {
    // 128GB on a phone is a drive, and the same number on a laptop is RAM.
    expect(specKind("128GB", "smartphone")).toBe("storage");
    expect(specKind("64GB", "smartphone")).toBe("storage");
    expect(specKind("64GB", "laptop")).toBe("memory");
  });

  it("labels each chip by what it actually is", () => {
    expect(specLabel("32GB", "laptop")).toBe("32GB RAM");
    expect(specLabel("1TB", "laptop")).toBe("1TB SSD");
    expect(specLabel("128GB", "smartphone")).toBe("128GB");
    expect(specLabel("44mm", "smartwatch")).toBe("44mm");
    expect(specLabel("default", "smartphone")).toBe("");
  });

  it("asks a question the shopper can actually answer", () => {
    expect(specQuestionLabel(["128GB", "256GB"], "smartphone")).toBe("Storage capacity");
    expect(specQuestionLabel(["1TB", "512GB"], "laptop")).toBe("Storage capacity");
    // Galaxy Book4 ships as ["16GB","8GB"] — no drive sizes at all.
    expect(specQuestionLabel(["16GB", "8GB"], "laptop")).toBe("Memory (RAM)");
    // Mixed list: neither heading alone is honest.
    expect(specQuestionLabel(["1TB", "32GB", "16GB"], "laptop")).toBe("Configuration");
  });
});

describe("published Tech Genius conditions", () => {
  it("Like New: looks new, fully functional, Canadian, battery 85%+", () => {
    expect(inferGradeFromAnswers(fullValuation({ exterior: "none", batteryHealth: 85 }))).toBe("flawless");
  });

  it("drops to Good at 84% battery — the published cut-off", () => {
    expect(inferGradeFromAnswers(fullValuation({ batteryHealth: 84 }))).toBe("good");
    expect(inferGradeFromAnswers(fullValuation({ batteryHealth: 85 }))).toBe("flawless");
  });

  it("Acceptable once the battery is 83% or below", () => {
    expect(inferGradeFromAnswers(fullValuation({ batteryHealth: 83 }))).toBe("average");
    expect(inferGradeFromAnswers(fullValuation({ batteryHealth: 40 }))).toBe("average");
  });

  it("Good for normal wear, Acceptable for significant wear", () => {
    expect(inferGradeFromAnswers(fullValuation({ exterior: "minor" }))).toBe("good");
    expect(inferGradeFromAnswers(fullValuation({ exterior: "visible" }))).toBe("average");
  });

  it("Unacceptable for a cracked screen that still works", () => {
    expect(inferGradeFromAnswers(fullValuation({ exterior: "cracks" }))).toBe("fair");
    expect(inferGradeFromAnswers(fullValuation({ exterior: "heavy" }))).toBe("fair");
  });

  it("an import cannot reach Like New, but still sells as Good", () => {
    // "Unlocked and is a Canadian model" appears in Like New and Good only.
    expect(inferGradeFromAnswers(fullValuation({ canadianModel: false }))).toBe("good");
  });

  it("liquid damage, iCloud lock and blacklist fall outside every condition", () => {
    // All four published conditions require no liquid damage and no lock.
    expect(inferGradeFromAnswers(fullValuation({ liquidDamage: true }))).toBe("defective");
    expect(inferGradeFromAnswers(fullValuation({ activationLockFree: false }))).toBe("defective");
    expect(inferGradeFromAnswers(fullValuation({ cleanImei: false }))).toBe("defective");
    expect(isGradeLockedToDefective(fullValuation({ activationLockFree: false }))).toBe(true);
    expect(isGradeLockedToDefective(fullValuation({ cleanImei: false }))).toBe(true);
  });

  it("shows the customer the published wording, not a paraphrase", () => {
    expect(gradeLabels.flawless).toBe("Like New");
    expect(gradeLabels.average).toBe("Acceptable");
    expect(gradeLabels.fair).toBe("Unacceptable");
    expect(gradeDefinitions.flawless).toContain("Unlocked and is a Canadian model");
    expect(gradeDefinitions.average).toContain("Compatible on Canadian cellular networks");
  });
});

describe("the admin never shows a customer a raw column value", () => {
  it("names payout methods the way the customer chose them", () => {
    // The sell page offers "Interac e-Transfer"; the staff board printed
    // "etransfer" beside the same offer.
    expect(payoutLabel("etransfer")).toBe("Interac e-Transfer");
    expect(payoutLabel("store-credit")).toBe("Store credit");
    expect(payoutLabel("cash")).toBe("Cash");
  });

  it("tidies a method it has never seen rather than leaking it", () => {
    expect(payoutLabel("wire_transfer")).toBe("Wire transfer");
    expect(payoutLabel(null)).toBe("—");
    expect(payoutLabel("")).toBe("—");
  });

  it("gives each pipeline stage a tone, so a table scans", () => {
    // Three tones across nine stages meant completed and in-transit looked
    // identical; these four must not collapse back into one another.
    const tones = new Set([
      stageTone("completed"),
      stageTone("in_transit"),
      stageTone("general_hold"),
      stageTone("payout_processing"),
    ]);
    expect(tones.size).toBe(4);
  });

  it("falls back to a readable stage name, never the id", () => {
    expect(stageLabel("payout_processing")).toBe("Payout Processing");
    expect(stageLabel("something_new")).toBe("Unknown");
  });
});
