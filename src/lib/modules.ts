/**
 * Paid add-on modules, per workspace.
 *
 * Intelligence modules (SpyMarket, SEO, Ads) sell research data and are
 * bundled in the Growth Bundle. Fulfilment is an OPERATIONAL module — it
 * unlocks the warehouse service (we hold your stock and ship every order) —
 * so it is priced standalone and is never part of that bundle.
 */
export type ModuleKey = "fulfilment";

export const MODULES = {
  fulfilment: {
    key: "fulfilment",
    name: "FlySales Fulfilment",
    priceUsd: 49,
    inBundle: false,
    label:
      "FlySales Fulfilment — hold stock at our fulfilment center and we pick, pack and ship every order.",
    blurb: "Hold stock at our fulfilment center and we pick, pack and ship every order.",
    /** The per-piece rules that apply once the service is active. */
    rules: [
      "Minimum 10 units per variation on every inbound shipment",
      "$0.50 per piece handling on arrival",
      "Optional quality control at +$0.20 per piece",
    ],
    unlocks: [
      "Add your own products for us to stock",
      "Declare inbound shipments to our fulfilment center",
      "Send stock purchases straight to our fulfilment center",
    ],
  },
} as const satisfies Record<ModuleKey, unknown>;

export function moduleLabel(key: string): string {
  return (MODULES as Record<string, { name: string }>)[key]?.name ?? key;
}
