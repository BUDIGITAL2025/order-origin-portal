/**
 * Item reference shown to the client.
 *
 * The reference a client quotes on a call is the SKU we carry on each variant
 * line. A quote can hold several variants, so the quote-level reference is the
 * shared one when every variant agrees, and a short summary otherwise.
 */
export function quoteRefFromSkus(skus: readonly (string | null | undefined)[]): string | null {
  const distinct = [...new Set(skus.map((s) => (s ?? "").trim()).filter((s) => s.length > 0))];
  if (distinct.length === 0) return null;
  if (distinct.length === 1) return distinct[0] ?? null;
  const [first, second] = distinct;
  const head = second ? `${first}, ${second}` : `${first}`;
  const rest = distinct.length - (second ? 2 : 1);
  return rest > 0 ? `${head} +${rest}` : head;
}

export const DELIVERY_LABELS = {
  exw: "EXW — I collect at the supplier",
  warehouse: "To my warehouse",
  fulfilment: "To FlySales fulfilment",
} as const;

export const DELIVERY_HINTS = {
  exw: "I collect at the supplier / my own forwarder (no shipping quoted)",
  warehouse: "Ship to my address (freight quoted)",
  fulfilment: "Store at your warehouse and fulfil my orders (China-to-China freight quoted)",
} as const;

export type DeliveryMode = keyof typeof DELIVERY_LABELS;

export function deliveryLabel(mode: string | null | undefined): string {
  return DELIVERY_LABELS[(mode ?? "") as DeliveryMode] ?? "—";
}
