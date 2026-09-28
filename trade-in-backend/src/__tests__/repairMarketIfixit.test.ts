import { describe, expect, it } from "vitest";
import { isThePart, pickWiki, problemForTag, slugsIn } from "../services/repairMarketIfixit.js";

describe("problemForTag", () => {
  it("maps the shelves that mean one repair", () => {
    expect(problemForTag("Batteries")).toBe("battery");
    expect(problemForTag("Screens")).toBe("screen");
    expect(problemForTag("Charging Ports")).toBe("charging_port");
  });

  it("ignores case and padding, since the tag is theirs to spell", () => {
    expect(problemForTag("  batteries ")).toBe("battery");
  });

  it("maps nothing for a shelf that holds several repairs", () => {
    // "Case Components" is back covers, hinges and feet together — calling it
    // back glass would price a hinge as a cracked back.
    expect(problemForTag("Case Components")).toBeNull();
    expect(problemForTag("Kits")).toBeNull();
    expect(problemForTag("Heat Sinks")).toBeNull();
  });
});

describe("pickWiki", () => {
  const results = [
    { display_title: "Galaxy Tab S8 Ultra", url: "https://www.ifixit.com/Device/Galaxy_Tab_S8_Ultra" },
    { display_title: "Samsung Galaxy Tab S8 plus", url: "https://www.ifixit.com/Device/Samsung_Galaxy_Tab_S8_plus" },
    { display_title: "Samsung Galaxy Tab S8", url: "https://www.ifixit.com/Device/Samsung_Galaxy_Tab_S8" },
  ];

  it("takes the wiki that is our device, not the first hit", () => {
    // Searching "Galaxy Tab S8" ranks the Ultra first.
    expect(pickWiki("Galaxy Tab S8", results)?.url).toContain("Samsung_Galaxy_Tab_S8");
    expect(pickWiki("Galaxy Tab S8", results)?.url).not.toContain("Ultra");
  });

  it("matches across the brand word either side carries", () => {
    expect(pickWiki("Samsung Galaxy Tab S8", results)?.display_title).toBe("Samsung Galaxy Tab S8");
  });

  it("returns nothing rather than a near miss", () => {
    // A wrong wiki would hand us another device's whole parts list.
    expect(pickWiki("Galaxy Tab S9", results)).toBeNull();
    expect(pickWiki("Galaxy Tab S8", [])).toBeNull();
  });
});

describe("isThePart", () => {
  it("accepts the part the shelf is named for", () => {
    expect(isThePart("battery", "Steam Deck OLED Battery")).toBe(true);
    expect(isThePart("screen", "Steam Deck OLED (1TB) Screen")).toBe(true);
  });

  it("rejects a board component filed under Cameras", () => {
    // Surface Pro 9's Cameras shelf holds this; it is not a broken camera.
    expect(isThePart("rear_camera", "Surface Pro 9 Camera and Wi-Fi Deck - Genuine")).toBe(false);
  });

  it("rejects the front camera when the repair is the rear one", () => {
    expect(isThePart("rear_camera", "Surface Pro 9 Front Camera - Genuine")).toBe(false);
    expect(isThePart("rear_camera", "iPhone 15 Rear Camera")).toBe(true);
  });

  it("rejects the trimmings that sit on the same shelf", () => {
    expect(isThePart("battery", "Galaxy S22 Battery Adhesive Strips")).toBe(false);
    expect(isThePart("screen", "iPhone 15 Display Assembly Adhesive")).toBe(false);
  });

  it("rejects a part type it does not know", () => {
    expect(isThePart("water_damage", "Anything")).toBe(false);
  });
});

describe("slugsIn", () => {
  it("reads the product slugs off a shelf page, once each", () => {
    const html = `<a href="/en-ca/products/steam-deck-oled-battery">x</a>
                  <a href="/en-ca/products/steam-deck-oled-battery?variant=1">y</a>
                  <a href="/en-ca/products/steam-deck-oled-1tb-screen">z</a>`;
    expect(slugsIn(html)).toEqual(["steam-deck-oled-battery", "steam-deck-oled-1tb-screen"]);
  });

  it("finds nothing on an empty shelf", () => {
    expect(slugsIn("<p>This collection does not have products</p>")).toEqual([]);
  });
});
