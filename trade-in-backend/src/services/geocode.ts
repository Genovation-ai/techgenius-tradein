/**
 * Turning what someone types into an address a carrier will accept.
 *
 * A shipping label is bought against an address. A typo in a postal code does
 * not fail politely — the carrier either refuses the shipment or, worse,
 * prints a label for somewhere nobody lives and the parcel is gone. The cure
 * is to stop asking people to type an address freehand and have them pick a
 * real one.
 *
 * OpenStreetMap, through two of its own services:
 *
 *   Photon     built for type-ahead; answers partial input quickly
 *   Nominatim  the canonical geocoder; better at resolving one exact address
 *
 * Both are free and open, and both are run on donated hardware with usage
 * policies that are a request rather than a quota. Honouring them is not
 * optional politeness — a service that gets itself blocked takes the shop's
 * address lookup down with it. So: a real User-Agent identifying this
 * application, no more than one upstream call a second, and a cache in front,
 * because the same postcodes are typed all day.
 *
 * TG_GEOCODER_URL points at a self-hosted instance when the volume justifies
 * one, which is the honest way to use these at scale.
 */

export interface GeoAddress {
  label: string;
  street1: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  lat: number | null;
  lon: number | null;
}

const PHOTON = (process.env.TG_GEOCODER_URL || "https://photon.komoot.io").replace(/\/+$/, "");
const NOMINATIM = (process.env.TG_NOMINATIM_URL || "https://nominatim.openstreetmap.org").replace(/\/+$/, "");

/**
 * Who we are, for the operators of a free service.
 *
 * Nominatim's policy requires an identifying User-Agent and will refuse
 * requests without one. Anonymous traffic is the kind that gets blocked.
 */
const UA = `Reclaim-TradeIn/1.0 (${process.env.TG_CONTACT_EMAIL || "support@reclaim.app"})`;

/* ───────────────── cache + pacing ───────────────── */

const cache = new Map<string, { at: number; value: GeoAddress[] }>();
const CACHE_TTL = 24 * 60 * 60 * 1000;
const CACHE_MAX = 500;

/** One upstream call per second, queued rather than dropped. */
let lastCall = 0;
async function paced<T>(fn: () => Promise<T>): Promise<T> {
  const wait = Math.max(0, 1000 - (Date.now() - lastCall));
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  return fn();
}

function cached(key: string): GeoAddress[] | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function remember(key: string, value: GeoAddress[]) {
  if (cache.size >= CACHE_MAX) {
    // Oldest out. A map preserves insertion order, so the first key is the
    // one that has been there longest.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), value });
}

/* ───────────────── shaping ───────────────── */

interface PhotonProps {
  name?: string;
  housenumber?: string;
  street?: string;
  city?: string;
  district?: string;
  state?: string;
  postcode?: string;
  countrycode?: string;
  country?: string;
}

function fromPhoton(f: { properties?: PhotonProps; geometry?: { coordinates?: number[] } }): GeoAddress | null {
  const p = f.properties ?? {};
  const street = [p.housenumber, p.street || p.name].filter(Boolean).join(" ").trim();
  const city = p.city || p.district || "";
  if (!street && !city) return null;

  const [lon, lat] = f.geometry?.coordinates ?? [];
  return {
    label: [street, city, p.state, p.postcode].filter(Boolean).join(", "),
    street1: street,
    city,
    state: p.state || "",
    zip: p.postcode || "",
    country: (p.countrycode || "").toUpperCase() || "CA",
    lat: typeof lat === "number" ? lat : null,
    lon: typeof lon === "number" ? lon : null,
  };
}

interface NominatimAddr {
  house_number?: string;
  road?: string;
  city?: string;
  town?: string;
  village?: string;
  state?: string;
  postcode?: string;
  country_code?: string;
}

function fromNominatim(r: { display_name?: string; address?: NominatimAddr; lat?: string; lon?: string }): GeoAddress | null {
  const a = r.address ?? {};
  const street = [a.house_number, a.road].filter(Boolean).join(" ").trim();
  const city = a.city || a.town || a.village || "";
  if (!street && !city) return null;
  return {
    label: r.display_name || [street, city, a.state, a.postcode].filter(Boolean).join(", "),
    street1: street,
    city,
    state: a.state || "",
    zip: a.postcode || "",
    country: (a.country_code || "").toUpperCase() || "CA",
    lat: r.lat ? Number(r.lat) : null,
    lon: r.lon ? Number(r.lon) : null,
  };
}

/* ───────────────── the two calls ───────────────── */

/**
 * Suggestions for something half-typed.
 *
 * Biased to one country, because a shop in Burlington does not want
 * Burlington, Massachusetts offered first for a Canadian postcode.
 */
export async function suggest(query: string, country = "CA", limit = 6): Promise<GeoAddress[]> {
  const q = query.trim();
  if (q.length < 3) return [];

  const key = `s:${country}:${q.toLowerCase()}`;
  const hit = cached(key);
  if (hit) return hit;

  const url =
    `${PHOTON}/api?q=${encodeURIComponent(q)}` +
    `&limit=${Math.min(10, Math.max(1, limit))}` +
    `&lang=en` +
    (country ? `&osm_tag=place&bbox=${bboxFor(country)}` : "");

  try {
    const res = await paced(() =>
      fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(6000) }),
    );
    if (!res.ok) return [];
    const json = (await res.json()) as { features?: Array<Parameters<typeof fromPhoton>[0]> };
    const out = (json.features ?? [])
      .map(fromPhoton)
      .filter((a): a is GeoAddress => a !== null)
      .filter((a) => !country || !a.country || a.country === country);
    remember(key, out);
    return out;
  } catch {
    // A lookup that fails must never stop someone typing an address by hand.
    return [];
  }
}

/** Resolve one address exactly, for validating before buying a label. */
export async function resolve(query: string, country = "CA"): Promise<GeoAddress | null> {
  const q = query.trim();
  if (q.length < 5) return null;

  const key = `r:${country}:${q.toLowerCase()}`;
  const hit = cached(key);
  if (hit) return hit[0] ?? null;

  const url =
    `${NOMINATIM}/search?q=${encodeURIComponent(q)}` +
    `&format=jsonv2&addressdetails=1&limit=1` +
    (country ? `&countrycodes=${country.toLowerCase()}` : "");

  try {
    const res = await paced(() =>
      fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(6000) }),
    );
    if (!res.ok) return null;
    const json = (await res.json()) as Array<Parameters<typeof fromNominatim>[0]>;
    const out = (json ?? []).map(fromNominatim).filter((a): a is GeoAddress => a !== null);
    remember(key, out);
    return out[0] ?? null;
  } catch {
    return null;
  }
}

/** Rough boxes, only to bias results — never to exclude a real address. */
function bboxFor(country: string): string {
  switch (country.toUpperCase()) {
    case "CA":
      return "-141.0,41.6,-52.6,70.0";
    case "US":
      return "-125.0,24.4,-66.9,49.4";
    default:
      return "-180,-90,180,90";
  }
}
