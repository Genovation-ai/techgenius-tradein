import { describe, expect, it } from "vitest";
import { applicableProblems, problemApplies } from "../services/repairApplicability.js";

/**
 * Every device used to be offered the same twelve problems, so a PlayStation
 * was asked about its screen and its rear camera. These lock the shape of the
 * fix: what a device physically has, and nothing more.
 */
describe("which repairs a device can have", () => {
  it("offers a phone everything", () => {
    const p = applicableProblems("smartphone", "iphone-15", "iPhone 15");
    expect(p.size).toBe(12);
    expect(p.has("screen")).toBe(true);
    expect(p.has("back_glass")).toBe(true);
  });

  it("does not offer a home console a screen, a battery or a camera", () => {
    const p = applicableProblems("gaming-console", "playstation-5-pro", "PlayStation 5 Pro");
    expect(p.has("screen")).toBe(false);
    expect(p.has("battery")).toBe(false);
    expect(p.has("rear_camera")).toBe(false);
    // but it still plugs in, has buttons, and can be dropped in a drink
    expect(p.has("charging_port")).toBe(true);
    expect(p.has("buttons")).toBe(true);
    expect(p.has("water_damage")).toBe(true);
  });

  it("does offer a handheld console a screen and a battery", () => {
    for (const [id, name] of [
      ["steam-deck", "Steam Deck"],
      ["new-3ds-xl", "New 3DS XL"],
      ["legion-go", "Legion Go"],
    ] as const) {
      const p = applicableProblems("gaming-console", id, name);
      expect(p.has("screen"), `${id} screen`).toBe(true);
      expect(p.has("battery"), `${id} battery`).toBe(true);
    }
  });

  it("does not offer a laptop back glass or a rear camera", () => {
    const p = applicableProblems("laptop", "macbook-air-13-2024", 'MacBook Air 13" (2024)');
    expect(p.has("back_glass")).toBe(false);
    expect(p.has("rear_camera")).toBe(false);
    expect(p.has("front_camera")).toBe(true); // the webcam
    expect(p.has("screen")).toBe(true);
  });

  it("does not offer a watch a camera, but keeps its back", () => {
    const p = applicableProblems("smartwatch", "watch-series-9", "Watch Series 9");
    expect(p.has("rear_camera")).toBe(false);
    expect(p.has("front_camera")).toBe(false);
    expect(p.has("back_glass")).toBe(true);
  });

  it("does not offer a monitor a battery", () => {
    const p = applicableProblems("monitor", "studio-display", "Studio Display");
    expect(p.has("battery")).toBe(false);
    expect(p.has("screen")).toBe(true);
  });

  it("offers everything when the category is unknown, rather than hiding a real repair", () => {
    expect(applicableProblems("", "mystery", "Mystery").size).toBe(12);
    expect(applicableProblems(null, "mystery", "Mystery").size).toBe(12);
  });

  it("always allows liquid damage, software and other", () => {
    for (const cat of ["smartphone", "laptop", "gaming-console", "monitor", "computer", "vr"]) {
      const p = applicableProblems(cat, "x", "X");
      expect(p.has("water_damage"), cat).toBe(true);
      expect(p.has("software"), cat).toBe(true);
      expect(p.has("other"), cat).toBe(true);
    }
  });

  it("problemApplies agrees with the set", () => {
    expect(problemApplies("gaming-console", "playstation-5-pro", "PlayStation 5 Pro", "screen")).toBe(false);
    expect(problemApplies("gaming-console", "steam-deck", "Steam Deck", "screen")).toBe(true);
  });
});
