/**
 * Price rows that are not trade-in values and must never be quoted.
 *
 * "techapi-import" is a launch/retail figure from a public spec catalogue, and
 * "bootstrap" is a guess made when a model was added by name (copied from a
 * newer sibling, plus 8%). Quoting them paid $215 for a "good" Galaxy S2 and
 * $597 for a Pixel 3a XL — GoRecell pays under $100 for a Pixel 5. They stay
 * in the table as a starting point for staff; once staff save a price it is
 * "manual" and quotes normally.
 */
export const UNTRUSTED_PRICE_SOURCES = ["techapi-import", "bootstrap"] as const;

/** SQL condition on a prices row (optionally aliased) that excludes them. */
export function trustedPriceSql(alias?: string): string {
  const col = alias ? `${alias}.source` : "source";
  return `COALESCE(${col}, '') NOT IN (${UNTRUSTED_PRICE_SOURCES.map((s) => `'${s}'`).join(", ")})`;
}
