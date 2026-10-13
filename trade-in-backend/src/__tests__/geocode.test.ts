import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolve, suggest } from "../services/geocode.js";

/**
 * The network is stubbed here on purpose. These cover the behaviour that
 * protects both sides: a lookup that fails must never stop someone typing an
 * address by hand, and our traffic to a donated service must stay inside what
 * its operators ask for.
 */

const photonHit = {
  features: [
    {
      properties: {
        housenumber: "796",
        street: "Brant Street",
        city: "Burlington",
        state: "Ontario",
        postcode: "L7R 2J4",
        countrycode: "ca",
      },
      geometry: { coordinates: [-79.81, 43.33] },
    },
  ],
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ok = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response;

describe("address suggestions", () => {
  it("shapes an OSM result into something a carrier can use", async () => {
    fetchMock.mockResolvedValue(ok(photonHit));
    const out = await suggest("796 Brant Street Burlington", "CA");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      street1: "796 Brant Street",
      city: "Burlington",
      zip: "L7R 2J4",
      country: "CA",
    });
  });

  it("does not call out for something too short to mean anything", async () => {
    expect(await suggest("ab")).toEqual([]);
    expect(await suggest("")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("identifies this application to the service it is using", async () => {
    fetchMock.mockResolvedValue(ok(photonHit));
    await suggest("1 Unique Street Somewhere " + Math.random(), "CA");
    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).headers).toMatchObject({
      "User-Agent": expect.stringContaining("Reclaim-TradeIn"),
    });
  });

  it("asks once for a repeated query", async () => {
    fetchMock.mockResolvedValue(ok(photonHit));
    const q = "cache me " + Math.random();
    await suggest(q, "CA");
    await suggest(q, "CA");
    await suggest(q, "CA");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns nothing rather than throwing when the service is down", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(suggest("somewhere " + Math.random(), "CA")).resolves.toEqual([]);
  });

  it("returns nothing rather than throwing on a refusal", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429 } as unknown as Response);
    await expect(suggest("rate limited " + Math.random(), "CA")).resolves.toEqual([]);
  });

  it("drops a result with neither street nor city", async () => {
    fetchMock.mockResolvedValue(ok({ features: [{ properties: { state: "Ontario" } }] }));
    expect(await suggest("vague " + Math.random(), "CA")).toEqual([]);
  });
});

describe("resolving one address", () => {
  it("reads the structured fields Nominatim returns", async () => {
    fetchMock.mockResolvedValue(
      ok([
        {
          display_name: "796, Brant Street, Burlington, Ontario, L7R 2J4, Canada",
          address: {
            house_number: "796",
            road: "Brant Street",
            city: "Burlington",
            state: "Ontario",
            postcode: "L7R 2J4",
            country_code: "ca",
          },
          lat: "43.3336",
          lon: "-79.8101",
        },
      ]),
    );
    const a = await resolve("796 Brant St Burlington ON " + Math.random(), "CA");
    expect(a?.street1).toBe("796 Brant Street");
    expect(a?.zip).toBe("L7R 2J4");
    expect(a?.lat).toBeCloseTo(43.33, 1);
  });

  it("is null when nothing matched, so a label is never bought on a guess", async () => {
    fetchMock.mockResolvedValue(ok([]));
    expect(await resolve("nowhere at all " + Math.random(), "CA")).toBeNull();
  });

  it("will not resolve something too short to be an address", async () => {
    expect(await resolve("abc")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
