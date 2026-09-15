/**
 * Orders can be flagged for review with an internal reason written by the
 * operations side ("Unknown SKU NOPE-1", "No price for SKU FS000025 in US").
 * That text is internal: the client only ever sees the plain-language message
 * this map produces.
 */
export function clientReviewMessage(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = raw.toLowerCase();
  if (text.includes("address") || text.includes("shipping address")) {
    return "This order needs an address check";
  }
  if (text.includes("no price") || text.includes("price") || text.includes("pricing")) {
    return "We need to confirm the price for an item in this order";
  }
  if (
    text.includes("unknown sku") ||
    text.includes("mapping") ||
    text.includes("missing") ||
    text.includes("sku") ||
    text.includes("stock")
  ) {
    return "We need to confirm stock for this item";
  }
  return "We are reviewing this order and will update you shortly";
}
