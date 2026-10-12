import type { Database } from "better-sqlite3";

/**
 * Buying a real shipping label.
 *
 * Until now "shipping" meant printing an HTML page and inventing a reference
 * that looked like a tracking number — "TG" and a timestamp — stored next to
 * the word "Canada Post". The customer was shown both together, took it to
 * canadapost.ca, found nothing, and concluded their parcel was lost.
 *
 * This buys a label that exists. Same shape as billing: one interface, one
 * implementation, no vendor SDK. EasyPost is the implementation because it
 * carries Canada Post, UPS, FedEx and Purolator behind one account, which is
 * the set a Canadian repair shop actually needs.
 *
 * It stays optional. A shop with no carrier account keeps the printable label
 * and its own reference, and the customer is told it is a reference rather
 * than tracking. Nothing here is required to take a trade-in.
 */

export interface Address {
  name: string;
  street1: string;
  street2?: string | null;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone?: string | null;
  email?: string | null;
}

export interface Parcel {
  /** Centimetres and kilograms; converted at the boundary. */
  length_cm: number;
  width_cm: number;
  height_cm: number;
  weight_kg: number;
}

export interface LabelRequest {
  to: Address;
  from: Address;
  parcel: Parcel;
  /** Shown on the label so a received parcel can be matched to its offer. */
  reference?: string | null;
}

export interface Label {
  carrier: string;
  service: string;
  tracking_number: string;
  tracking_url: string | null;
  label_url: string;
  cost: number;
  currency: string;
}

export interface ShippingProvider {
  readonly name: string;
  configured(): boolean;
  /** What it would cost, before committing to anything. */
  rates(req: LabelRequest): Promise<Array<{ carrier: string; service: string; cost: number; currency: string; days: number | null }>>;
  /** Buy the cheapest rate, or a named one. */
  buy(req: LabelRequest, opts?: { carrier?: string; service?: string }): Promise<Label>;
}

const EASYPOST_API = "https://api.easypost.com/v2";

const CM_PER_INCH = 2.54;
const KG_PER_OZ = 0.0283495;

export class EasyPostProvider implements ShippingProvider {
  readonly name = "easypost";

  configured(): boolean {
    return Boolean((process.env.TG_EASYPOST_API_KEY || "").trim());
  }

  private auth(): string {
    const k = (process.env.TG_EASYPOST_API_KEY || "").trim();
    if (!k) throw new Error("TG_EASYPOST_API_KEY is not set");
    // EasyPost takes the key as HTTP basic username with an empty password.
    return `Basic ${Buffer.from(`${k}:`).toString("base64")}`;
  }

  /** EasyPost speaks inches and ounces whatever the country. */
  private toImperial(p: Parcel) {
    return {
      length: +(p.length_cm / CM_PER_INCH).toFixed(2),
      width: +(p.width_cm / CM_PER_INCH).toFixed(2),
      height: +(p.height_cm / CM_PER_INCH).toFixed(2),
      weight: +(p.weight_kg / KG_PER_OZ).toFixed(2),
    };
  }

  private async shipment(req: LabelRequest): Promise<Record<string, unknown>> {
    const body = {
      shipment: {
        to_address: req.to,
        from_address: req.from,
        parcel: this.toImperial(req.parcel),
        reference: req.reference ?? undefined,
      },
    };
    const res = await fetch(`${EASYPOST_API}/shipments`, {
      method: "POST",
      headers: { Authorization: this.auth(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as Record<string, unknown> & {
      error?: { message?: string };
    };
    if (!res.ok) throw new Error(json.error?.message || `EasyPost refused the shipment (${res.status})`);
    return json;
  }

  async rates(req: LabelRequest) {
    const s = await this.shipment(req);
    const rates = (s.rates as Array<Record<string, string>>) ?? [];
    return rates.map((r) => ({
      carrier: String(r.carrier),
      service: String(r.service),
      cost: Number(r.rate),
      currency: String(r.currency ?? "CAD"),
      days: r.delivery_days ? Number(r.delivery_days) : null,
    }));
  }

  async buy(req: LabelRequest, opts: { carrier?: string; service?: string } = {}): Promise<Label> {
    const s = await this.shipment(req);
    const rates = (s.rates as Array<Record<string, string>>) ?? [];
    if (!rates.length) throw new Error("No carrier offered a rate for that parcel and address");

    const wanted = rates.filter(
      (r) =>
        (!opts.carrier || r.carrier === opts.carrier) &&
        (!opts.service || r.service === opts.service),
    );
    const pool = wanted.length ? wanted : rates;
    // Cheapest by default. A shop paying for this wants the price, and the
    // delivery estimate is on the rate if they want to choose otherwise.
    const chosen = pool.reduce((a, b) => (Number(a.rate) <= Number(b.rate) ? a : b));

    const res = await fetch(`${EASYPOST_API}/shipments/${String(s.id)}/buy`, {
      method: "POST",
      headers: { Authorization: this.auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ rate: { id: chosen.id } }),
    });
    const bought = (await res.json()) as Record<string, unknown> & { error?: { message?: string } };
    if (!res.ok) {
      throw new Error(bought.error?.message || `EasyPost refused to buy the label (${res.status})`);
    }

    const label = (bought.postage_label as Record<string, string>) ?? {};
    const tracker = (bought.tracker as Record<string, string>) ?? {};
    return {
      carrier: String(chosen.carrier),
      service: String(chosen.service),
      tracking_number: String(bought.tracking_code ?? ""),
      tracking_url: tracker.public_url ? String(tracker.public_url) : null,
      label_url: String(label.label_url ?? ""),
      cost: Number(chosen.rate),
      currency: String(chosen.currency ?? "CAD"),
    };
  }
}

export function activeShippingProvider(): ShippingProvider {
  return new EasyPostProvider();
}

/** What is missing before a real label can be bought. */
export function shippingReadiness(): { ready: boolean; provider: string; missing: string[] } {
  const needed = ["TG_EASYPOST_API_KEY"];
  const missing = needed.filter((k) => !(process.env[k] || "").trim());
  return { ready: missing.length === 0, provider: "easypost", missing };
}

/**
 * The shop's own address, which every label needs as the destination.
 *
 * Kept with the rest of the shop's settings rather than in environment
 * variables, because on a multi-tenant platform it differs per shop and a
 * shop must be able to correct its own address without anyone being asked.
 */
export function shopAddress(db: Database, orgId: string): Address | null {
  try {
    const r = db
      .prepare(
        `SELECT company_name, company_phone, company_email,
                ship_street1, ship_street2, ship_city, ship_state, ship_zip, ship_country
           FROM org_settings WHERE org_id = ?`,
      )
      .get(orgId) as Record<string, string | null> | undefined;
    if (!r?.ship_street1 || !r.ship_city || !r.ship_zip) return null;
    return {
      name: r.company_name || "Trade-In Returns",
      street1: r.ship_street1,
      street2: r.ship_street2,
      city: r.ship_city,
      state: r.ship_state || "",
      zip: r.ship_zip,
      country: r.ship_country || "CA",
      phone: r.company_phone,
      email: r.company_email,
    };
  } catch {
    return null;
  }
}
